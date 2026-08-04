const mongoose = require('mongoose');
const dotenv = require('dotenv');
const crypto = require('crypto');

// Load environment variables
dotenv.config({ path: 'C:/Users/Manish gowda/OneDrive/Desktop/algo-trading/Angel-one-trading/backend/.env' });
process.env.LOCAL_DEV_MASTER_KEY = crypto.randomBytes(32).toString('hex');

const strategyEngine = require('../services/strategyEngine');
const marketDataService = require('../services/marketDataService');
const orderUpdateService = require('../services/orderUpdateService');
const smartStream = require('../services/smartStream');
const BrokerConnection = require('../models/BrokerConnection');
const vaultService = require('../services/vaultService');

const userA_Id = '6666a7f56895931cf0c10c7a';
const userB_Id = '6666a7f56895931cf0c10c7b';

async function runStrategyMultiUserTest() {
    console.log('=== STARTING STRATEGY ENGINE MULTI-USER ISOLATION TEST ===');

    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
        console.error('❌ MONGO_URI missing.');
        return;
    }
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB.');

    // Pre-populate dummy active connection records in DB to pass verification
    await BrokerConnection.deleteMany({ userId: { $in: [userA_Id, userB_Id] } });
    
    // Save valid connection profiles through vault service to bypass mongoose schema validations
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

    // Mock REST api calls so strategy initialization succeeds
    // We override global fetch or callAngelApi helper to return mock contracts
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
        console.log(`[Mock Fetch] Intercepted REST call to: ${url} (User: ${options.headers['X-User-Id']})`);
        
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
        if (url.includes('/market/candles')) {
            const dummyCandles = Array.from({ length: 35 }, (_, idx) => ({
                ts: new Date(Date.now() - (35 - idx) * 5 * 60 * 1000).toISOString(),
                open: 150 + idx,
                high: 152 + idx,
                low: 148 + idx,
                close: 151 + idx,
                volume: 1000
            }));
            return {
                ok: true,
                status: 200,
                text: async () => '',
                json: async () => ({ items: dummyCandles })
            };
        }
        if (url.includes('/market/ltp')) {
            return {
                ok: true,
                status: 200,
                text: async () => '',
                json: async () => ({ ltp: 150.0 })
            };
        }
        if (url.includes('/market/index-ltp')) {
            return {
                ok: true,
                status: 200,
                text: async () => '',
                json: async () => ({ ltp: 44100.0 })
            };
        }
        return { ok: false, status: 404, text: async () => 'Not Found' };
    };

    // Override smartStream connect to prevent hitting python local port in the test
    const originalConnect = smartStream.connect;
    smartStream.connect = () => {};

    try {
        // --- STEP 1: Initialize 4 runners for User A & User B ---
        console.log('\n--- Step 1: Initializing strategies ---');
        // Strategy A1: HeikenAshi for User A
        const runnerA1 = strategyEngine.getRunner(`${userA_Id}_HeikenAshi`);
        // Strategy A2: 5minBreakout for User A
        const runnerA2 = strategyEngine.getRunner(`${userA_Id}_5minBreakout`);
        // Strategy B1: ModifiedHeikenAshi for User B
        const runnerB1 = strategyEngine.getRunner(`${userB_Id}_ModifiedHeikenAshi`);
        // Strategy B2: TwoCandleTrend for User B
        const runnerB2 = strategyEngine.getRunner(`${userB_Id}_TwoCandleTrend`);

        const baseConfig = { underlying: 'BANKNIFTY', liveTradingConsent: false, quantity: 15 };

        await runnerA1.start(baseConfig, userA_Id);
        await runnerA2.start(baseConfig, userA_Id);
        await runnerB1.start(baseConfig, userB_Id);
        await runnerB2.start(baseConfig, userB_Id);

        console.log('✅ Started 4 strategy runners concurrently.');

        // Verify strategy name mapping
        console.log(` - Runner A1 Name: ${runnerA1.strategyName} (User: ${runnerA1.userId})`);
        console.log(` - Runner A2 Name: ${runnerA2.strategyName} (User: ${runnerA2.userId})`);
        console.log(` - Runner B1 Name: ${runnerB1.strategyName} (User: ${runnerB1.userId})`);
        console.log(` - Runner B2 Name: ${runnerB2.strategyName} (User: ${runnerB2.userId})`);

        // --- STEP 2: Stream Ticks for User A ---
        console.log('\n--- Step 2: Streaming ticks for User A ---');
        // We trigger tick events inside marketDataService. Since we scoped builders and caches,
        // we feed a tick for UserA's CE contract (token: 99901)
        runnerA1.ceContract = { exchange: 'NFO', symboltoken: '99901', tradingsymbol: 'BANKNIFTY-CE-44100' };
        runnerB1.ceContract = { exchange: 'NFO', symboltoken: '99901', tradingsymbol: 'BANKNIFTY-CE-44100' };

        // Feed tick specifically under User A's stream
        smartStream.emit('tick', { token: '99901', ltp: 155.50, timestamp: Date.now() }, userA_Id);

        // Check cache contents
        const ltpA = marketDataService.getLtp(userA_Id, 'NFO', '99901');
        const ltpB = marketDataService.getLtp(userB_Id, 'NFO', '99901');

        console.log(`LTP Cache for User A (token 99901): ${ltpA}`);
        console.log(`LTP Cache for User B (token 99901): ${ltpB}`);

        if (ltpA === 155.50 && ltpB === null) {
            console.log('✅ LTP Cache Isolation Verified: Ticks for User A did not pollute User B!');
        } else {
            throw new Error('LTP Cache isolation failed!');
        }

        // --- STEP 3: Stream Candle Closed Event for User B ---
        console.log('\n--- Step 3: Triggering isolated candle closed event for User B ---');
        // Emit candle:closed under User B
        marketDataService.emit('candle:closed', {
            userId: userB_Id,
            exchange: 'NFO',
            symboltoken: '99901',
            interval: 'FIVE_MINUTE',
            candle: { open: 150, high: 160, low: 145, close: 155 }
        });

        // Small wait for async scans to complete
        await new Promise(resolve => setTimeout(resolve, 500));

        console.log(`Runner A1 (User A) state: ${runnerA1.state}`);
        console.log(`Runner A2 (User A) state: ${runnerA2.state}`);
        console.log(`Runner B1 (User B) state: ${runnerB1.state}`);
        console.log(`Runner B2 (User B) state: ${runnerB2.state}`);

        if (runnerB2.state === 'IN_POSITION' && runnerA1.state === 'SCANNING' && runnerA2.state === 'WAITING') {
            console.log('✅ Candle Event Isolation Verified: User B\'s candle event only triggered entry state on User B\'s strategy!');
        } else {
            throw new Error('Candle Closed event isolation check failed!');
        }

    } finally {
        // Stop all runners
        strategyEngine.getRunner(`${userA_Id}_HeikenAshi`).clearAllIntervals();
        strategyEngine.getRunner(`${userA_Id}_5minBreakout`).clearAllIntervals();
        strategyEngine.getRunner(`${userB_Id}_ModifiedHeikenAshi`).clearAllIntervals();
        strategyEngine.getRunner(`${userB_Id}_TwoCandleTrend`).clearAllIntervals();

        await BrokerConnection.deleteMany({ userId: { $in: [userA_Id, userB_Id] } });
        globalThis.fetch = originalFetch;
        smartStream.connect = originalConnect;
        await mongoose.disconnect();
        console.log('Database disconnected.');
        console.log('=== STRATEGY ENGINE MULTI-USER ISOLATION TEST COMPLETED SUCCESSFULLY ===');
    }
}

runStrategyMultiUserTest().catch(err => {
    console.error('❌ E2E STRATEGY TEST FAILED:', err);
    process.exit(1);
});
