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

const app = express();

// Issue #18 FIX: helmet sets secure HTTP headers (X-Content-Type-Options,
// X-Frame-Options, Strict-Transport-Security, etc.) out of the box.
app.use(helmet());

// Issue #18 FIX: explicit body-size cap prevents large-payload DoS.
// Express 5 has a different internal default; be explicit to avoid surprises.
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : 'http://localhost:3000',
    credentials: true
}));

// Issue #18 FIX: rate-limit on the login route — max 10 login attempts per
// 15-minute window per IP. Prevents brute-force credential attacks.
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'fail', message: 'Too many login attempts. Please try again in 15 minutes.' }
});
app.use('/api/v1/users/login', loginLimiter);

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

const marketDataService = require('./services/marketDataService');

const port = process.env.PORT || 5000;

// Issue #17 FIX: Do not start the HTTP server until MongoDB is connected.
// Previously app.listen() was called synchronously while mongoose.connect() was
// still pending, meaning early requests hit an unconnected database.
async function startServer() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('DB connection successful!');
    } catch (err) {
        console.error('DB connection error — cannot start server:', err);
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
            await mongoose.connection.close();
            console.log('MongoDB connection closed. Exiting.');
            process.exit(0);
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

startServer();
