/**
 * csrfMiddleware.js
 * 
 * Strict CSRF and Origin Protection for mutating API requests (POST, PUT, DELETE, PATCH).
 * Works across cross-origin deployments (e.g. Vercel frontend -> Render backend) and local dev.
 */

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

const csrfProtection = (req, res, next) => {
    // Safe HTTP methods do not require CSRF validation
    const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
    if (safeMethods.includes(req.method)) {
        return next();
    }

    // Public authentication endpoints establish or replace session and issue fresh CSRF tokens
    const publicAuthPaths = ['/api/v1/users/login', '/api/v1/users/register'];
    if (publicAuthPaths.some(p => req.originalUrl?.startsWith(p) || req.path?.startsWith(p))) {
        return next();
    }

    // Skip CSRF for internal server-to-server calls authenticated via X-Internal-Token
    const internalToken = req.headers['x-internal-token'] || req.headers['x-internal-secret'];
    const configuredSecret = process.env.INTERNAL_SERVICE_SECRET || process.env.ANGEL_ONE_INTERNAL_SECRET;
    if (internalToken && configuredSecret && internalToken === configuredSecret) {
        return next();
    }

    // 1. Origin / Referer validation for browser requests in production
    const origin = req.headers.origin;
    const referer = req.headers.referer;

    if (origin) {
        const isAllowedOrigin = ALLOWED_ORIGINS.some(allowed => origin === allowed || origin.startsWith(allowed));
        if (!isAllowedOrigin && process.env.NODE_ENV === 'production') {
            return res.status(403).json({
                status: 'fail',
                message: 'Forbidden: Invalid request origin'
            });
        }
    } else if (referer) {
        const isAllowedReferer = ALLOWED_ORIGINS.some(allowed => referer.startsWith(allowed));
        if (!isAllowedReferer && process.env.NODE_ENV === 'production') {
            return res.status(403).json({
                status: 'fail',
                message: 'Forbidden: Invalid request referer'
            });
        }
    }

    // 2. Token-based CSRF validation if cookie-authenticated (JWT cookie present)
    if (req.cookies && req.cookies.jwt) {
        const headerToken = req.headers['x-xsrf-token'] || req.headers['x-csrf-token'];
        const cookieToken = req.cookies['XSRF-TOKEN'];

        if (!headerToken || !cookieToken || headerToken !== cookieToken) {
            return res.status(403).json({
                status: 'fail',
                message: 'Forbidden: Invalid or missing CSRF token'
            });
        }
    }

    next();
};

module.exports = csrfProtection;
