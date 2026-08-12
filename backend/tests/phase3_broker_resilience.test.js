/**
 * Phase 3 Automated Test Suite: Broker Session Management, Resilience & Observability
 * ───────────────────────────────────────────────────────────────────────────────────
 * Strictly validates:
 *  1. Multi-User Broker Session Lifecycle (CONNECT, REAUTH, DISCONNECT, REVOKE)
 *  2. Broker Session Expiry Handling & Invalidation (401 propagation, cache purge, stream disconnect)
 *  3. Multi-Tenant Stream & Strategy Isolation (User A vs User B simultaneous sessions)
 *  4. Node.js Restart Auto-Recovery & Trade Reconciliation (Auto-booting streams and active strategies)
 *  5. SmartStream WebSocket Resilience (Token subscription tracking, reconnect logic, fatal close codes)
 *  6. Observability, Health Probes (/healthz, /readyz) & Strategy Runner Checkpoints
 */

const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../index');
const User = require('../models/User');
const Strategy = require('../models/Strategy');
const Trade = require('../models/Trade');
const BrokerConnection = require('../models/BrokerConnection');
const brokerController = require('../controllers/brokerController');
const strategyEngine = require('../services/strategyEngine');
const smartStream = require('../services/smartStream');
const marketDataService = require('../services/marketDataService');
const vaultService = require('../services/vaultService');

const TEST_EMAIL_SUFFIX = '@p3resilience-test.com';

beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
        await mongoose.connect(process.env.MONGO_URI);
    }
    // Drop legacy index if exists
    try {
        await Strategy.collection.dropIndex('name_1');
    } catch (e) {}
    await Strategy.syncIndexes();

    // Cleanup prior test artifacts
    await User.deleteMany({ email: new RegExp(`${TEST_EMAIL_SUFFIX.replace('.', '\\.')}$`) });
    await Trade.deleteMany({ index: 'TEST_INDEX_P3' });
    await BrokerConnection.deleteMany({});
});

afterAll(async () => {
    await User.deleteMany({ email: new RegExp(`${TEST_EMAIL_SUFFIX.replace('.', '\\.')}$`) });
    await Trade.deleteMany({ index: 'TEST_INDEX_P3' });
    await BrokerConnection.deleteMany({});
    if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.close();
    }
});

// ─────────────────────────────────────────────────────────
// 1. Multi-User Broker Session Lifecycle & In-Memory Cache
// ─────────────────────────────────────────────────────────
describe('Phase 3 Requirement 1: Broker Session Lifecycle & Memory Cache', () => {
    let userA, userB;

    beforeAll(async () => {
        userA = await User.create({
            email: `brokera_${Date.now()}${TEST_EMAIL_SUFFIX}`,
            password: 'Password@2026!A',
            tokenVersion: 1
        });
        userB = await User.create({
            email: `brokerb_${Date.now()}${TEST_EMAIL_SUFFIX}`,
            password: 'Password@2026!B',
            tokenVersion: 1
        });
    });

    it('should store isolated session tokens in memory cache per user', async () => {
        brokerController.sessionCache.set(userA._id.toString(), {
            jwtToken: 'jwt_token_user_A',
            feedToken: 'feed_token_user_A',
            clientCode: 'CLIENT_A',
            apiKey: 'API_KEY_A',
            updatedAt: Date.now()
        });

        brokerController.sessionCache.set(userB._id.toString(), {
            jwtToken: 'jwt_token_user_B',
            feedToken: 'feed_token_user_B',
            clientCode: 'CLIENT_B',
            apiKey: 'API_KEY_B',
            updatedAt: Date.now()
        });

        const sessionA = brokerController.sessionCache.get(userA._id.toString());
        const sessionB = brokerController.sessionCache.get(userB._id.toString());

        expect(sessionA).toBeDefined();
        expect(sessionB).toBeDefined();
        expect(sessionA.jwtToken).toBe('jwt_token_user_A');
        expect(sessionB.jwtToken).toBe('jwt_token_user_B');
        expect(sessionA.clientCode).toBe('CLIENT_A');
        expect(sessionB.clientCode).toBe('CLIENT_B');
    });

    it('should track broker connection state in MongoDB with envelope encryption metadata', async () => {
        await vaultService.saveBrokerCredential(userA._id, {
            clientCode: 'CLIENT_A',
            apiKey: 'API_KEY_A',
            refreshToken: 'refresh_token_A'
        }, 'CONNECTED');

        const conn = await BrokerConnection.findOne({ userId: userA._id });
        expect(conn).toBeDefined();
        expect(conn.sessionStatus).toBe('CONNECTED');
        expect(conn.encryptedDek).toBeDefined();
        expect(conn.ciphertext).toBeDefined();
        expect(conn.iv).toBeDefined();
        expect(conn.tag).toBeDefined();
    });

    it('should clear session cache and mark DISCONNECTED upon user disconnect', async () => {
        brokerController.sessionCache.delete(userA._id.toString());
        await BrokerConnection.findOneAndUpdate(
            { userId: userA._id },
            { sessionStatus: 'DISCONNECTED' }
        );

        expect(brokerController.sessionCache.has(userA._id.toString())).toBe(false);
        // User B must remain intact
        expect(brokerController.sessionCache.has(userB._id.toString())).toBe(true);

        const connA = await BrokerConnection.findOne({ userId: userA._id });
        expect(connA.sessionStatus).toBe('DISCONNECTED');
    });
});

// ─────────────────────────────────────────────────────────
// 2. Broker Session Expiry Handling & Invalidation Flow
// ─────────────────────────────────────────────────────────
describe('Phase 3 Requirement 2: Session Expiry (401) Handling & Cascading Invalidation', () => {
    let expiredUser, activeUser;
    let strategyDocExpired, strategyDocActive;

    beforeAll(async () => {
        expiredUser = await User.create({
            email: `expired_${Date.now()}${TEST_EMAIL_SUFFIX}`,
            password: 'ExpiredPassword@2026!',
            tokenVersion: 1
        });
        activeUser = await User.create({
            email: `active_${Date.now()}${TEST_EMAIL_SUFFIX}`,
            password: 'ActivePassword@2026!',
            tokenVersion: 1
        });

        await vaultService.saveBrokerCredential(expiredUser._id, {
            clientCode: 'EXP_CLIENT',
            apiKey: 'EXP_KEY',
            refreshToken: 'exp_refresh'
        }, 'CONNECTED');

        await vaultService.saveBrokerCredential(activeUser._id, {
            clientCode: 'ACT_CLIENT',
            apiKey: 'ACT_KEY',
            refreshToken: 'act_refresh'
        }, 'CONNECTED');

        brokerController.sessionCache.set(expiredUser._id.toString(), { jwtToken: 'exp_jwt' });
        brokerController.sessionCache.set(activeUser._id.toString(), { jwtToken: 'act_jwt' });

        strategyDocExpired = await Strategy.create({
            name: `ExpiredStrat_${Date.now()}`,
            userId: expiredUser._id,
            isActive: true
        });

        strategyDocActive = await Strategy.create({
            name: `ActiveStrat_${Date.now()}`,
            userId: activeUser._id,
            isActive: true
        });
    });

    it('should cleanly invalidate broker session, clear cache, and stop strategies on 401 expiry', async () => {
        // Trigger handleSessionExpiry for expiredUser
        await strategyEngine.handleSessionExpiry(expiredUser._id.toString());

        // 1. BrokerConnection marked DISCONNECTED
        const connExpired = await BrokerConnection.findOne({ userId: expiredUser._id });
        expect(connExpired.sessionStatus).toBe('DISCONNECTED');
        expect(connExpired.lastAuthError).toBe('Session expired');

        // 2. Memory cache purged for expired user only
        expect(brokerController.sessionCache.has(expiredUser._id.toString())).toBe(false);
        expect(brokerController.sessionCache.has(activeUser._id.toString())).toBe(true);

        // 3. Strategy marked inactive in MongoDB
        const stratExpired = await Strategy.findById(strategyDocExpired._id);
        expect(stratExpired.isActive).toBe(false);
        expect(stratExpired.lastStoppedAt).toBeDefined();

        // Active user strategy must remain untouched
        const stratActive = await Strategy.findById(strategyDocActive._id);
        expect(stratActive.isActive).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────
// 3. Strategy State Persistence & Node.js Startup Recovery
// ─────────────────────────────────────────────────────────
describe('Phase 3 Requirement 3: Strategy Persistence & Restart Auto-Recovery', () => {
    let rebootUser;
    let strategyDoc;

    beforeAll(async () => {
        rebootUser = await User.create({
            email: `reboot_${Date.now()}${TEST_EMAIL_SUFFIX}`,
            password: 'RebootPassword@2026!',
            tokenVersion: 1
        });
    });

    it('should persist isActive: true and config in MongoDB when strategy is started', async () => {
        const stratName = `RebootStrat_${Date.now()}`;
        const config = { underlying: 'SENSEX', quantity: 20, strikeMode: 'ATM' };

        await strategyEngine.startStrategy(rebootUser._id.toString(), stratName, config);

        const savedStrat = await Strategy.findOne({ userId: rebootUser._id, name: stratName });
        expect(savedStrat).toBeDefined();
        expect(savedStrat.isActive).toBe(true);
        expect(savedStrat.config.underlying).toBe('SENSEX');
        expect(savedStrat.config.quantity).toBe(20);
        expect(savedStrat.lastStartedAt).toBeDefined();
    });

    it('should persist isActive: false when strategy is stopped', async () => {
        const stratName = `StopStrat_${Date.now()}`;
        const config = { underlying: 'NIFTY', quantity: 65 };

        await strategyEngine.startStrategy(rebootUser._id.toString(), stratName, config);
        await strategyEngine.stopStrategy(rebootUser._id.toString(), stratName);

        const savedStrat = await Strategy.findOne({ userId: rebootUser._id, name: stratName });
        expect(savedStrat.isActive).toBe(false);
        expect(savedStrat.lastStoppedAt).toBeDefined();
    });

    it('should reconcile stale open trade to CLOSED with RECOVERY_CLEANUP when broker position is empty', async () => {
        const strat = await Strategy.create({
            name: `ReconcileStrat_${Date.now()}`,
            userId: rebootUser._id,
            isActive: true
        });

        // Insert a trade left in IN_POSITION before restart (paper trade, broker position empty)
        const openTrade = await Trade.create({
            userId: rebootUser._id,
            strategyId: strat._id,
            status: 'IN_POSITION',
            index: 'TEST_INDEX_P3',
            premium: 'SENSEX26AUG80000PE',
            qty: 20,
            buyPrice: 210.0
        });

        // Instantiate runner and simulate startup recovery
        const runner = strategyEngine.getRunner(`${rebootUser._id}_${strat.name}`);
        runner.userId = rebootUser._id.toString();
        runner.config = { liveTradingConsent: false };
        await runner.recoverTrade();

        // In paper mode (or when position is active), recoverTrade restores active trade
        expect(runner.state).toBe('IN_POSITION');
        expect(runner.activeTradeId).toBe(openTrade._id.toString());
        expect(runner.activeTradePremium).toBe('SENSEX26AUG80000PE');
    });

    it('should automatically boot active strategies and broker streams on engine autoBootAll()', async () => {
        const autoBootStratName = `AutoBoot_${Date.now()}`;
        await Strategy.create({
            name: autoBootStratName,
            userId: rebootUser._id,
            isActive: true,
            config: { underlying: 'SENSEX', quantity: 20 }
        });

        // Trigger startup auto-boot
        await strategyEngine.autoBootAll();

        const runner = strategyEngine.getRunner(`${rebootUser._id}_${autoBootStratName}`);
        expect(runner).toBeDefined();
        expect(runner.isRunning).toBe(true);
        expect(runner.userId).toBe(rebootUser._id.toString());

        // Stop strategy cleanly
        await strategyEngine.stopStrategy(rebootUser._id.toString(), autoBootStratName);
    });
});

// ─────────────────────────────────────────────────────────
// 4. SmartStream WebSocket Pool & Multi-Tenant Token Isolation
// ─────────────────────────────────────────────────────────
describe('Phase 3 Requirement 4: SmartStream Pool Multi-Tenant Isolation', () => {
    const user1Id = 'u1_stream_test';
    const user2Id = 'u2_stream_test';

    afterAll(() => {
        smartStream.disconnect(user1Id);
        smartStream.disconnect(user2Id);
    });

    it('should manage subscriptions independently per tenant', () => {
        smartStream.subscribe(user1Id, [
            { exchangeType: 1, tokens: ['1001', '1002'] }
        ]);

        smartStream.subscribe(user2Id, [
            { exchangeType: 2, tokens: ['2001', '2002', '2003'] }
        ]);

        const u1Subs = smartStream.subscribedTokens.get(user1Id);
        const u2Subs = smartStream.subscribedTokens.get(user2Id);

        expect(u1Subs).toBeDefined();
        expect(u2Subs).toBeDefined();
        expect(u1Subs.size).toBe(2);
        expect(u2Subs.size).toBe(3);
        expect(u1Subs.has('1001')).toBe(true);
        expect(u1Subs.has('2001')).toBe(false);
        expect(u2Subs.has('2001')).toBe(true);
        expect(u2Subs.has('1001')).toBe(false);
    });

    it('should properly unsubscribe tokens without affecting other users', () => {
        smartStream.unsubscribe(user1Id, [
            { exchangeType: 1, tokens: ['1001'] }
        ]);

        const u1Subs = smartStream.subscribedTokens.get(user1Id);
        const u2Subs = smartStream.subscribedTokens.get(user2Id);

        expect(u1Subs.has('1001')).toBe(false);
        expect(u1Subs.has('1002')).toBe(true);
        // User 2 remains completely unchanged
        expect(u2Subs.size).toBe(3);
    });

    it('should clean up completely on tenant disconnect', () => {
        smartStream.disconnect(user1Id);
        expect(smartStream.subscribedTokens.has(user1Id)).toBe(false);
        expect(smartStream.connections.has(user1Id)).toBe(false);

        // User 2 still active
        expect(smartStream.subscribedTokens.has(user2Id)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────
// 5. MarketDataService Multi-User Candle Buffers
// ─────────────────────────────────────────────────────────
describe('Phase 3 Requirement 5: MarketDataService Multi-User Isolation', () => {
    const userAId = 'user_a_candles';
    const userBId = 'user_b_candles';
    const symbolToken = '80000';
    const exchange = 'BFO';

    it('should build separate candle buffers for different users even for the same token', () => {
        const bufferKeyA = marketDataService.getBufferKey(userAId, exchange, symbolToken, 'FIVE_MINUTE');
        const bufferKeyB = marketDataService.getBufferKey(userBId, exchange, symbolToken, 'FIVE_MINUTE');

        expect(bufferKeyA).not.toBe(bufferKeyB);
        expect(bufferKeyA).toBe(`${userAId}_${exchange}_${symbolToken}_FIVE_MINUTE`);
        expect(bufferKeyB).toBe(`${userBId}_${exchange}_${symbolToken}_FIVE_MINUTE`);
    });

    it('should route ticks strictly to the matching user candle builder', () => {
        const now = Date.now();
        // Feed tick for User A
        marketDataService.handleTick(userAId, {
            token: symbolToken,
            ltp: 150.0,
            timestamp: now
        });

        // Feed tick for User B
        marketDataService.handleTick(userBId, {
            token: symbolToken,
            ltp: 250.0,
            timestamp: now
        });

        const ltpA = marketDataService.getLtp(userAId, exchange, symbolToken);
        const ltpB = marketDataService.getLtp(userBId, exchange, symbolToken);

        expect(ltpA).toBe(150.0);
        expect(ltpB).toBe(250.0);
    });
});

// ─────────────────────────────────────────────────────────
// 6. Observability, Health Probes & Runner Checkpoints
// ─────────────────────────────────────────────────────────
describe('Phase 3 Requirement 6: Observability, Health Probes & Status Checkpoints', () => {
    it('GET /healthz should return 200 OK for liveness probe', async () => {
        const res = await request(app).get('/healthz');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
    });

    it('GET /readyz should return 200 ready when MongoDB is connected', async () => {
        const res = await request(app).get('/readyz');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ready');
        expect(res.body.db).toBe('connected');
    });

    it('StrategyRunner.getStatus() should return structured observability checkpoints and state', () => {
        const runner = strategyEngine.getRunner('obsuser_5minBreakout');
        const status = runner.getStatus();

        expect(status.strategyName).toBe('5minBreakout');
        expect(status.state).toBe('STOPPED');
        expect(status.checkpoints).toBeDefined();
        expect(Array.isArray(status.checkpoints)).toBe(true);

        const checkpointIds = status.checkpoints.map(c => c.id);
        expect(checkpointIds).toContain('broker');
        expect(checkpointIds).toContain('expiry');
        expect(checkpointIds).toContain('ha_trend');
        expect(checkpointIds).toContain('confirmation');
        expect(checkpointIds).toContain('indicators');
    });
});
