const express = require('express');
const rateLimit = require('express-rate-limit');
const brokerController = require('../controllers/brokerController');
const authController = require('../controllers/authController');

const router = express.Router();

// Strict rate limit on connection-related broker endpoints (10 attempts per 15 mins)
const brokerConnectionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'fail', message: 'Too many connection attempts. Please try again in 15 minutes.' }
});

// Protect all broker routes with application user authentication
router.use(authController.protect);

router.get('/status', brokerController.getStatus);
router.post('/connect', brokerConnectionLimiter, brokerController.connect);
router.post('/reauthenticate', brokerConnectionLimiter, brokerController.reauthenticate);
router.post('/test-connection', brokerConnectionLimiter, brokerController.testConnection);
router.post('/disconnect', brokerController.disconnect);
router.post('/revoke', brokerController.revoke);

// Block raw order placement via proxy FIRST (before any wildcard catches it)
// This must be declared before the generic GET wildcard to intercept all methods.
router.all('/orders/{*path}', (req, res) => {
    res.status(403).json({ status: 'fail', message: 'Direct raw order placement is disabled. Use validated trading endpoints.' });
});

// Explicitly authorized safe proxy routes (Market data, instruments, profile, orderbook)
const ALLOWED_GET_PATHS = [
    '/angel/profile',
    '/angel/orderbook',
    '/angel/trades',
    '/angel/positions',
    '/angel/margins',
    '/market/index-ltp',
    '/market/quote',
    '/market/candle',
    '/instruments/search'
];

router.get('/{*path}', async (req, res) => {
    try {
        const userId = req.user._id.toString();
        const rawPath = req.params[0] || req.path;
        const normalizedPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;

        // Ensure only allowed GET paths can be accessed
        const isAllowed = ALLOWED_GET_PATHS.some(allowed => 
            normalizedPath === allowed || normalizedPath.startsWith(allowed + '?') || normalizedPath.startsWith(allowed + '/')
        );

        if (!isAllowed) {
            return res.status(403).json({ status: 'fail', message: 'Forbidden: Endpoint not accessible via broker proxy' });
        }

        const query = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
        const apiBase = process.env.ANGEL_ONE_API_BASE || 'http://localhost:8000';
        const url = `${apiBase}${normalizedPath}${query}`;

        const internalSecret = process.env.INTERNAL_SERVICE_SECRET || process.env.ANGEL_ONE_INTERNAL_SECRET || '';
        const options = {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-Internal-Token': internalSecret,
                'X-User-Id': userId
            }
        };

        const fetchRes = await fetch(url, options);
        res.status(fetchRes.status);
        
        const contentType = fetchRes.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            const json = await fetchRes.json();
            return res.json(json);
        } else {
            const text = await fetchRes.text();
            return res.send(text);
        }
    } catch (err) {
        console.error('[BrokerRouter] Proxy error:', err.message);
        res.status(502).json({ status: 'error', message: 'Failed to proxy request to broker service' });
    }
});

module.exports = router;
