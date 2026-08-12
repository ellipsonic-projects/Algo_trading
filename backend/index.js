const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const dotenv = require('dotenv');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

dotenv.config();

const authRoutes = require('./routes/authRoutes');
const tradeRoutes = require('./routes/tradeRoutes');
const strategyRoutes = require('./routes/strategyRoutes');
const chartRoutes = require('./routes/chartRoutes');
const brokerRoutes = require('./routes/brokerRoutes');

const csrfProtection = require('./middleware/csrfMiddleware');

const app = express();

// Security HTTP headers
app.use(helmet());

// Explicit body-size cap to prevent large-payload DoS
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

const corsOrigins = (process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:3000')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

app.use(cors({
    origin: corsOrigins,
    credentials: true
}));

// Rate limiters for auth flows
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === 'test' ? 1000 : 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'fail', message: 'Too many attempts. Please try again in 15 minutes.' }
});
app.use('/api/v1/users/login', authLimiter);
app.use('/api/v1/users/register', authLimiter);

// CSRF & Origin validation on mutating requests
app.use(csrfProtection);

// Route Middlewares
app.use('/api/v1/users', authRoutes);
app.use('/api/v1/trades', tradeRoutes);
app.use('/api/v1/strategies', strategyRoutes);
app.use('/api/v1/chart', chartRoutes);
app.use('/api/v1/broker/angel', brokerRoutes);

// Root Route
app.get('/', (req, res) => {
    res.send('Option-Algo Backend API is running...');
});

// Issue #17 FIX: Liveness probe — always returns 200 if the process is alive.
app.get('/healthz', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// Issue #17 FIX: Readiness probe — returns 200 only when MongoDB is connected.
app.get('/readyz', (req, res) => {
    const dbState = mongoose.connection.readyState;
    // 1 = connected
    if (dbState === 1) {
        res.status(200).json({ status: 'ready', db: 'connected' });
    } else {
        res.status(503).json({ status: 'not ready', db: 'disconnected' });
    }
});

// JSON Body Parser Error Handler
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({ status: 'fail', message: 'Malformed JSON payload' });
    }
    next(err);
});

// Centralized Global Error Handler
const errorMiddleware = require('./middleware/errorMiddleware');
app.use(errorMiddleware);

const marketDataService = require('./services/marketDataService');

const port = process.env.PORT || 5000;

// Issue #17 FIX: Do not start the HTTP server until MongoDB is connected.
// Previously app.listen() was called synchronously while mongoose.connect() was
// still pending, meaning early requests hit an unconnected database.
const vaultService = require('./services/vaultService');

async function startServer() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('DB connection successful!');

        // Validate secret vault provider readiness before accepting traffic
        await vaultService.validateVaultReady();
        console.log('[VaultService] Master encryption key verified and ready.');
    } catch (err) {
        console.error('Fatal startup error — cannot start server:', err.message);
        process.exit(1);
    }

    const server = app.listen(port, () => {
        console.log(`App running on port ${port}...`);
    });

    // Issue #17 FIX: Graceful shutdown on SIGTERM (sent by process managers,
    // Docker, Kubernetes) and SIGINT (Ctrl+C in dev). Closes the HTTP server
    // (stops accepting new connections) then closes the Mongoose connection.
    const gracefulShutdown = (signal) => {
        console.log(`[${signal}] Graceful shutdown initiated...`);
        server.close(async () => {
            console.log('HTTP server closed. Closing MongoDB connection...');
            try {
                await mongoose.connection.close();
                console.log('MongoDB connection closed. Exiting.');
                process.exit(0);
            } catch (closeErr) {
                console.error('Error closing MongoDB connection:', closeErr);
                process.exit(1);
            }
        });

        // Force-exit if graceful shutdown takes longer than 10s
        setTimeout(() => {
            console.error('Graceful shutdown timed out. Forcing exit.');
            process.exit(1);
        }, 10_000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

if (require.main === module) {
    startServer();
}

module.exports = app;
