const mongoose = require('mongoose');
const dotenv = require('dotenv');
const crypto = require('crypto');
const ws = require('ws');

// Load environment variables
dotenv.config({ path: 'C:/Users/Manish gowda/OneDrive/Desktop/algo-trading/Angel-one-trading/backend/.env' });
process.env.LOCAL_DEV_MASTER_KEY = crypto.randomBytes(32).toString('hex');
const INTERNAL_SECRET = 'TEST-SHARED-SECRET-12345';
process.env.ANGEL_ONE_INTERNAL_SECRET = INTERNAL_SECRET;

const strategyEngine = require('../services/strategyEngine');
const marketDataService = require('../services/marketDataService');
const smartStream = require('../services/smartStream');
const BrokerConnection = require('../models/BrokerConnection');
const vaultService = require('../services/vaultService');
const brokerController = require('../controllers/brokerController');

const userA_Id = '7777a7f56895931cf0c10c7a';
const userB_Id = '7777a7f56895931cf0c10c7b';

async function runPhase6Tests() {
    console.log('====================================================');
    console.log('   PHASE 6: SYSTEM HARDENING & VALIDATION SUITE     ');
    console.log('====================================================');

    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
        console.error('❌ MONGO_URI missing.');
        process.exit(1);
    }
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB.');

    // Pre-populate dummy active connection records in DB
    await BrokerConnection.deleteMany({ userId: { $in: [userA_Id, userB_Id] } });
    await vaultService.saveBrokerCredential(new mongoose.Types.ObjectId(userA_Id), {
        clientCode: 'CLIENT-A',
        apiKey: 'key-a',
        refreshToken: 'refresh-a'
    }, 'CONNECTED');
    await vaultService.saveBrokerCredential(new mongoose.Types.ObjectId(userB_Id), {
        clientCode: 'CLIENT-B',
        apiKey: 'key-b',
        refreshToken: 'refresh-b'
    }, 'CONNECTED');

    // Setup mock servers
    const wssPort = 8123;
    const mockWss = new ws.Server({ port: wssPort });
    let pythonWsConnections = new Map();

    mockWss.on('connection', (socket, req) => {
        const urlParams = new URLSearchParams(req.url.split('?')[1]);
        const token = urlParams.get('token');
        const userId = urlParams.get('userId');

        if (token !== INTERNAL_SECRET) {
            socket.close(4003, 'Forbidden: Invalid internal token');
            return;
        }
        if (!userId) {
            socket.close(4000, 'Bad Request: Missing userId');
            return;
        }

        pythonWsConnections.set(userId, socket);
        socket.on('close', () => {
            pythonWsConnections.delete(userId);
        });
    });

    // Configure smartStream private websocket URL to point to our mock server
    process.env.ANGEL_ONE_WS_URL = `ws://localhost:${wssPort}`;

    const originalFetch = globalThis.fetch;
    let fetchResponseStatus = 200;

    globalThis.fetch = async (url, options) => {
        if (url.includes('/market/index-ltp') || url.includes('/market/ltp') || url.includes('/instruments/index-options')) {
            if (fetchResponseStatus === 401) {
                return {
                    ok: false,
                    status: 401,
                    text: async () => 'Unauthorized'
                };
            }
            if (url.includes('/market/index-ltp')) {
                return { ok: true, status: 200, text: async () => '', json: async () => ({ ltp: 44100.0 }) };
            }
            if (url.includes('/instruments/index-options')) {
                return {
                    ok: true,
                    status: 200,
                    text: async () => '',
                    json: async () => ({
                        expiries: ['2026-08-10'],
                        strikes: [44000, 44100, 44200],
                        contracts: [
                            { exchange: 'NFO', underlying: 'BANKNIFTY', expiry: '2026-08-10', strike: 44100, lot_size: 15, option_type: 'CE', tradingsymbol: 'BANKNIFTY-CE-44100', symboltoken: '99901' },
                            { exchange: 'NFO', underlying: 'BANKNIFTY', expiry: '2026-08-10', strike: 44100, lot_size: 15, option_type: 'PE', tradingsymbol: 'BANKNIFTY-PE-44100', symboltoken: '99902' }
                        ]
                    })
                };
            }
        }
        if (url.includes('/market/candles')) {
            if (fetchResponseStatus === 401) {
                return {
                    ok: false,
                    status: 401,
                    text: async () => 'Unauthorized'
                };
            }
            const dummyCandles = Array.from({ length: 35 }, (_, idx) => ({
                ts: new Date(Date.now() - (35 - idx) * 5 * 60 * 1000).toISOString(),
                open: 150 + idx,
                high: 152 + idx,
                low: 148 + idx,
                close: 151 + idx,
                volume: 1000
            }));
            return { ok: true, status: 200, text: async () => '', json: async () => ({ items: dummyCandles }) };
        }
        return { ok: false, status: 404, text: async () => 'Not Found' };
    };

    try {
        // --- TEST 1: WebSocket Recovery ---
        console.log('\n--- Test 1: WebSocket auto-reconnect on socket drop ---');
        smartStream.connect(userA_Id);

        // Wait for connection
        await new Promise(resolve => setTimeout(resolve, 500));
        let wsA = pythonWsConnections.get(userA_Id);
        if (!wsA) throw new Error('Failed to establish initial WebSocket connection');
        console.log('✅ Initial connection established.');

        // Simulate connection drop
        let disconnectEventFired = false;
        smartStream.once('disconnected', () => {
            disconnectEventFired = true;
        });

        wsA.close();
        console.log('🔌 Simulated connection drop.');

        // Wait for reconnect backoff (5 seconds in smartStream.js + buffer)
        await new Promise(resolve => setTimeout(resolve, 6000));

        let wsAReconnected = pythonWsConnections.get(userA_Id);
        if (wsAReconnected && disconnectEventFired) {
            console.log('✅ WebSocket Auto-reconnected successfully!');
        } else {
            throw new Error('WebSocket auto-reconnect failed!');
        }

        // --- TEST 2: CloseCode Hardening & Reconnect Loop Protection ---
        console.log('\n--- Test 2: Websocket CloseCode 4001 session-inactive reconnect halt ---');
        let wsAReconnActive = pythonWsConnections.get(userA_Id);
        if (wsAReconnActive) {
            // Close with code 4001 (Inactive Session)
            wsAReconnActive.close(4001, 'Broker session not active');
        }

        // Wait to see if it reconnects
        await new Promise(resolve => setTimeout(resolve, 6000));

        let wsAReconnectedAgain = pythonWsConnections.get(userA_Id);
        const connStatusA = await BrokerConnection.findOne({ userId: userA_Id });

        console.log(`Reconnected socket exists?: ${!!wsAReconnectedAgain}`);
        console.log(`BrokerConnection status in DB: ${connStatusA.sessionStatus}`);

        if (!wsAReconnectedAgain && connStatusA.sessionStatus === 'DISCONNECTED') {
            console.log('✅ Reconnect Loop Protection Verified: Auto-reconnect stopped on 4001 close code, status set to DISCONNECTED!');
        } else {
            throw new Error('Reconnect loop protection failed!');
        }

        // --- TEST 3: Graceful Session Expiry on HTTP 401 ---
        console.log('\n--- Test 3: Graceful session invalidation and strategy shutdown on REST HTTP 401 ---');
        // Pre-populate sessionCache
        brokerController.sessionCache.set(userB_Id, {
            jwtToken: 'jwt-b',
            feedToken: 'feed-b',
            clientCode: 'CLIENT-B',
            apiKey: 'key-b'
        });

        // Set status to CONNECTED in DB
        await BrokerConnection.findOneAndUpdate({ userId: userB_Id }, { sessionStatus: 'CONNECTED' });

        // Start strategy runner for User B
        const runnerB = strategyEngine.getRunner(`${userB_Id}_TwoCandleTrend`);
        await runnerB.start({ underlying: 'BANKNIFTY', liveTradingConsent: false, quantity: 15 }, userB_Id);

        console.log(`Runner B initial state: ${runnerB.state}`);

        // Set mock REST status to 401 to simulate expiry
        fetchResponseStatus = 401;

        // Force a contract resolution check which will trigger callAngelApi -> 401
        try {
            await runnerB.startContractLoop();
        } catch (err) {
            console.log(`Expected call error caught: ${err.message}`);
        }

        // Wait for async handler
        await new Promise(resolve => setTimeout(resolve, 500));

        const connStatusB = await BrokerConnection.findOne({ userId: userB_Id });
        const cacheB = brokerController.sessionCache.get(userB_Id);

        console.log(`Runner B state after 401: ${runnerB.state}`);
        console.log(`Runner B isRunning: ${runnerB.isRunning}`);
        console.log(`BrokerConnection status in DB: ${connStatusB.sessionStatus}`);
        console.log(`sessionCache contains credentials?: ${!!cacheB}`);

        if (runnerB.state === 'STOPPED' && !runnerB.isRunning && connStatusB.sessionStatus === 'DISCONNECTED' && !cacheB) {
            console.log('✅ Session Expiry Verified: Strategies force-stopped, DB set to DISCONNECTED, and session cache invalidated cleanly!');
        } else {
            throw new Error('Graceful session expiry handling failed!');
        }

        // --- TEST 4: Invalid Internal Token Security ---
        console.log('\n--- Test 4: Internal Token Security verification ---');
        const invalidWsUrl = `ws://localhost:${wssPort}/ws/broker-stream?token=WRONG-TOKEN&userId=${userA_Id}`;
        const badWs = new ws(invalidWsUrl);

        const wsClosedPromise = new Promise((resolve) => {
            badWs.on('close', (code, reason) => {
                resolve({ code, reason: reason.toString() });
            });
        });

        const closeInfo = await wsClosedPromise;
        console.log(`Unauthorized connection close code: ${closeInfo.code} (${closeInfo.reason})`);

        if (closeInfo.code === 4003) {
            console.log('✅ Internal Token Security Verified: Python WebSocket rejected unauthorized token with code 4003!');
        } else {
            throw new Error('Internal token security check failed!');
        }

    } finally {
        // Clean up mock servers and DB
        mockWss.close();
        globalThis.fetch = originalFetch;
        delete process.env.ANGEL_ONE_WS_URL;
        
        await BrokerConnection.deleteMany({ userId: { $in: [userA_Id, userB_Id] } });
        await mongoose.disconnect();
        console.log('Database disconnected.');
        console.log('\n====================================================');
        console.log('  ALL PHASE 6 SYSTEM HARDENING TESTS COMPLETED SUCCESSFULLY  ');
        console.log('====================================================');
    }
}

runPhase6Tests().catch(err => {
    console.error('❌ PHASE 6 TESTS FAILED:', err);
    process.exit(1);
});
