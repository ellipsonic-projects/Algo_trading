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

// Secure wildcard proxy to Python Angel One Wrapper service (Express 5 named wildcard)
router.all('/{*path}', async (req, res) => {
    try {
        const userId = req.user._id.toString();
        // Extract original request path relative to /api/v1/broker/angel
        const path = req.params[0] || req.path;
        const query = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
        const apiBase = process.env.ANGEL_ONE_API_BASE || 'http://localhost:8000';
        const url = `${apiBase}${path}${query}`;

        const internalSecret = process.env.ANGEL_ONE_INTERNAL_SECRET || '';
        const options = {
            method: req.method,
            headers: {
                'Content-Type': 'application/json',
                'X-Internal-Token': internalSecret,
                'X-User-Id': userId
            }
        };

        if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
            options.body = JSON.stringify(req.body);
        }

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
