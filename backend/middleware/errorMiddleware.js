/**
 * Centralized Global Error Middleware
 * Enforces uniform standard JSON error format:
 * { success: false, error: { code: string, message: string, details?: any } }
 */
module.exports = (err, req, res, next) => {
    // Log the error for internal diagnostics
    console.error('[Global Error Handler]', {
        message: err.message,
        stack: err.stack,
        code: err.code,
        statusCode: err.statusCode
    });

    const statusCode = err.statusCode || 500;
    const errorCode = err.code || 'INTERNAL_SERVER_ERROR';
    const message = err.message || 'An unexpected error occurred on the server.';
    
    res.status(statusCode).json({
        success: false,
        error: {
            code: errorCode,
            message: message,
            details: err.details || undefined
        }
    });
};
