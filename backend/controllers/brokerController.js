const BrokerConnection = require('../models/BrokerConnection');
const vaultService = require('../services/vaultService');
const config = require('../config');

const ANGEL_API_BASE = config.API.ANGEL_ONE_API_BASE;
const ANGEL_ONE_INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || process.env.ANGEL_ONE_INTERNAL_SECRET || '';

// Secure in-memory cache for short-lived session tokens (never persisted to DB)
// userId -> { jwtToken, feedToken, clientCode, apiKey, updatedAt }
const sessionCache = new Map();

// Helper: Secure FastAPI calls with internal token and user isolation headers
async function callFastApi(endpoint, method, userId, body = null) {
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'X-Internal-Token': ANGEL_ONE_INTERNAL_SECRET,
            'X-User-Id': String(userId)
        }
    };
    if (body) {
        options.body = JSON.stringify(body);
    }
    const url = `${ANGEL_API_BASE}${endpoint}`;
    const res = await fetch(url, options);
    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `FastAPI Error [${res.status}]`);
    }
    return await res.json();
}

// Input validator
function validateConnectInput({ clientCode, apiKey, mpin, totp }) {
    if (!clientCode || typeof clientCode !== 'string' || !clientCode.trim()) {
        return 'Invalid Client Code';
    }
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
        return 'Invalid API Key';
    }
    if (!mpin || typeof mpin !== 'string' || !/^\d{4}$/.test(mpin)) {
        return 'MPIN must be exactly 4 digits';
    }
    if (totp !== undefined && totp !== null && (typeof totp !== 'string' || !/^\d{6}$/.test(totp))) {
        return 'TOTP must be exactly 6 digits';
    }
    return null;
}

exports.getStatus = async (req, res) => {
    try {
        const userId = req.user._id;
        const conn = await BrokerConnection.findOne({ userId });
        if (!conn) {
            return res.status(200).json({
                status: 'success',
                data: {
                    sessionStatus: 'DISCONNECTED',
                    hasProfile: false,
                    lastLoginTime: null,
                    sessionExpiryEstimate: null
                }
            });
        }
        res.status(200).json({
            status: 'success',
            data: {
                sessionStatus: conn.sessionStatus,
                hasProfile: true,
                lastLoginTime: conn.lastLoginTime,
                sessionExpiryEstimate: conn.sessionExpiryEstimate,
                lastRestHeartbeat: conn.lastRestHeartbeat,
                lastWsHeartbeat: conn.lastWsHeartbeat,
                lastAuthError: conn.lastAuthError ? 'Authentication error occurred' : null // redact raw error details
            }
        });
    } catch (err) {
        console.error('[BrokerController] Status check failed:', err.message);
        res.status(500).json({ status: 'error', message: 'Failed to retrieve connection status' });
    }
};

exports.connect = async (req, res) => {
    try {
        const userId = req.user._id;
        const { clientCode, apiKey, mpin, totp } = req.body || {};

        // 1. Strict Input Validation
        const validationError = validateConnectInput({ clientCode, apiKey, mpin, totp });
        if (validationError) {
            return res.status(400).json({ status: 'fail', message: validationError });
        }

        // 2. Call Python wrapper for Angel One login authentication
        // Note: Python app refactoring happens in Phase 3. 
        // We pass the credentials to the Python endpoint.
        console.log(`[BrokerController] Initiating onboarding authentication for user: ${userId}`);
        
        let loginRes;
        try {
            // Forward connection requests securely to FastAPI
            // Discard mpin and totp from any logs
            loginRes = await callFastApi('/angel/login', 'POST', userId, {
                client_code: clientCode,
                api_key: apiKey,
                mpin,
                totp
            });
        } catch (err) {
            console.error('[BrokerController] Onboarding FastAPI call failed:', err.message);
            return res.status(401).json({ status: 'fail', message: `Broker authentication failed: ${err.message}` });
        }

        if (!loginRes || !loginRes.status || !loginRes.jwt_token) {
            return res.status(401).json({ status: 'fail', message: loginRes?.message || 'Broker login rejected' });
        }

        // 3. Envelope Encrypt persistent values and save to DB
        console.log('[BrokerController] Saving encrypted credentials to vault...');
        await vaultService.saveBrokerCredential(userId, {
            clientCode,
            apiKey,
            refreshToken: loginRes.refresh_token || ''
        }, 'CONNECTED');

        // 4. Save short-lived tokens in memory cache only
        sessionCache.set(userId.toString(), {
            jwtToken: loginRes.jwt_token,
            feedToken: loginRes.feed_token || '',
            clientCode,
            apiKey,
            updatedAt: Date.now()
        });

        // Connect the broker websocket stream immediately upon login
        try {
            const smartStream = require('../services/smartStream');
            smartStream.connect(userId.toString());
        } catch (streamErr) {
            console.error('[BrokerController] Failed to auto-connect smartStream after login:', streamErr.message);
        }

        // Update expiry estimate (approx 24h)
        await BrokerConnection.findOneAndUpdate(
            { userId },
            { 
                sessionExpiryEstimate: new Date(Date.now() + 24 * 60 * 60 * 1000),
                lastAuthError: null
            }
        );

        res.status(200).json({
            status: 'success',
            data: {
                sessionStatus: 'CONNECTED',
                lastLoginTime: new Date()
            }
        });

    } catch (err) {
        console.error('[BrokerController] Onboarding flow crashed:', err.message);
        res.status(500).json({ status: 'error', message: 'Internal onboarding error' });
    }
};

exports.reauthenticate = async (req, res) => {
    try {
        const userId = req.user._id;
        const { mpin, totp } = req.body || {};

        if (!mpin || !/^\d{4}$/.test(mpin)) {
            return res.status(400).json({ status: 'fail', message: 'MPIN must be exactly 4 digits' });
        }
        if (totp && !/^\d{6}$/.test(totp)) {
            return res.status(400).json({ status: 'fail', message: 'TOTP must be exactly 6 digits' });
        }

        // 1. Retrieve connection credentials from the vault
        // ignoreStatus: true allows reading even when DISCONNECTED (which is the normal state when reauthenticating)
        const creds = await vaultService.getBrokerCredential(userId, { ignoreStatus: true });
        if (!creds) {
            return res.status(404).json({ status: 'fail', message: 'No broker connection found. Connect first.' });
        }

        // 2. Call FastAPI login to refresh the session
        console.log(`[BrokerController] Reauthenticating user: ${userId}`);
        let loginRes;
        try {
            loginRes = await callFastApi('/angel/login', 'POST', userId, {
                client_code: creds.clientCode,
                api_key: creds.apiKey,
                mpin,
                totp
            });
        } catch (err) {
            console.error('[BrokerController] Reauthentication FastAPI call failed:', err.message);
            return res.status(401).json({ status: 'fail', message: `Broker reauthentication failed: ${err.message}` });
        }

        if (!loginRes || !loginRes.status || !loginRes.jwt_token) {
            return res.status(401).json({ status: 'fail', message: loginRes?.message || 'Broker login rejected' });
        }

        // 3. Save new refresh token (if changed) back to the vault
        await vaultService.saveBrokerCredential(userId, {
            clientCode: creds.clientCode,
            apiKey: creds.apiKey,
            refreshToken: loginRes.refresh_token || creds.refreshToken
        }, 'CONNECTED');

        // 4. Cache new short-lived tokens in memory
        sessionCache.set(userId.toString(), {
            jwtToken: loginRes.jwt_token,
            feedToken: loginRes.feed_token || '',
            clientCode: creds.clientCode,
            apiKey: creds.apiKey,
            updatedAt: Date.now()
        });

        // Connect the broker websocket stream immediately upon reauthentication
        try {
            const smartStream = require('../services/smartStream');
            smartStream.connect(userId.toString());
        } catch (streamErr) {
            console.error('[BrokerController] Failed to auto-connect smartStream after reauth:', streamErr.message);
        }

        await BrokerConnection.findOneAndUpdate(
            { userId },
            { 
                sessionExpiryEstimate: new Date(Date.now() + 24 * 60 * 60 * 1000),
                lastAuthError: null
            }
        );

        res.status(200).json({
            status: 'success',
            data: {
                sessionStatus: 'CONNECTED',
                lastLoginTime: new Date()
            }
        });

    } catch (err) {
        console.error('[BrokerController] Reauthentication crashed:', err.message);
        res.status(500).json({ status: 'error', message: 'Internal reauthentication error' });
    }
};

exports.testConnection = async (req, res) => {
    try {
        const userId = req.user._id;
        const { clientCode, apiKey, mpin, totp } = req.body || {};

        const validationError = validateConnectInput({ clientCode, apiKey, mpin, totp });
        if (validationError) {
            return res.status(400).json({ status: 'fail', message: validationError });
        }

        console.log(`[BrokerController] Testing connection for user: ${userId}`);
        let loginRes;
        try {
            loginRes = await callFastApi('/angel/login', 'POST', userId, {
                client_code: clientCode,
                api_key: apiKey,
                mpin,
                totp
            });
        } catch (err) {
            return res.status(401).json({ status: 'fail', message: `Connection test failed: ${err.message}` });
        }

        if (loginRes && loginRes.status) {
            res.status(200).json({
                status: 'success',
                message: 'Connection credentials are valid'
            });
        } else {
            res.status(401).json({
                status: 'fail',
                message: loginRes?.message || 'Connection test rejected'
            });
        }

    } catch (err) {
        console.error('[BrokerController] Test connection crashed:', err.message);
        res.status(500).json({ status: 'error', message: 'Internal test connection error' });
    }
};

exports.disconnect = async (req, res) => {
    try {
        const userId = req.user._id;
        console.log(`[BrokerController] Disconnecting session for user: ${userId}`);

        // 1. Call FastAPI logout
        try {
            await callFastApi('/angel/logout', 'POST', userId);
        } catch (err) {
            // Suppress errors during logout so we still clean up locally
            console.warn('[BrokerController] FastAPI logout reported an error during disconnect');
        }

        // 2. Clear from memory cache
        sessionCache.delete(userId.toString());

        // 3. Update DB session status
        await BrokerConnection.findOneAndUpdate(
            { userId },
            { sessionStatus: 'DISCONNECTED' }
        );

        res.status(200).json({
            status: 'success',
            message: 'Successfully disconnected from broker session'
        });

    } catch (err) {
        console.error('[BrokerController] Disconnect flow crashed:', err.message);
        res.status(500).json({ status: 'error', message: 'Internal disconnect error' });
    }
};

exports.revoke = async (req, res) => {
    try {
        const userId = req.user._id;
        console.log(`[BrokerController] Revoking credentials for user: ${userId}`);

        // 1. Logout session if active
        try {
            await callFastApi('/angel/logout', 'POST', userId);
        } catch (err) {
            // ignore
        }

        // 2. Remove from memory cache
        sessionCache.delete(userId.toString());

        // 3. Permanently delete from MongoDB & Vault
        await vaultService.deleteBrokerCredential(userId);

        res.status(200).json({
            status: 'success',
            message: 'Broker connection successfully revoked and credentials deleted'
        });

    } catch (err) {
        console.error('[BrokerController] Revoke flow crashed:', err.message);
        res.status(500).json({ status: 'error', message: 'Internal revoke error' });
    }
};

// Export raw session cache reference for other local services (e.g. strategyEngine, marketDataService)
exports.sessionCache = sessionCache;
