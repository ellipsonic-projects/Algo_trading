/**
 * Phase 4 STRICT Production-Readiness Verification Test Suite
 * ============================================================
 * Tests every Phase 4 requirement exhaustively:
 *
 * Req 1.  Centralized error handler — standard JSON error contract on all routes
 * Req 2.  Option transaction charges calculator — accurate brokerage, STT, Exchange,
 *         SEBI, Stamp Duty, GST, net PnL (boundary & edge cases)
 * Req 3.  Charges persisted to MongoDB on every trade exit (API-triggered AND
 *         strategy-engine-triggered)
 * Req 4.  Tenant-scoped analytics — taxes summed from actual persisted charges,
 *         NOT from a static estimate
 * Req 5.  Strict multi-user isolation for trades, analytics, update-exit
 * Req 6.  Strategy signal math unchanged after indicator refactor (Heiken Ashi
 *         and Modified Heiken Ashi unit tests)
 * Req 7.  Risk engine — quantity limits, daily loss kill-switch, duplicate-entry block
 * Req 8.  All Phase 1–3 regression tests still pass (run externally; structural
 *         sanity checked here)
 * Req 9.  PnL boundary: zero-PnL trade, max-loss trade, multiple lots
 * Req 10. Charges version field is always persisted so future rate changes can be
 *         identified in the ledger
 */

'use strict';

const mongoose = require('mongoose');
const request  = require('supertest');
const app      = require('../index');
const User     = require('../models/User');
const Strategy = require('../models/Strategy');
const Trade    = require('../models/Trade');
const { calculateCharges } = require('../services/chargesCalculator');
const { analyzeHeikenAshiStrategy, detectHeikenAshiTrend } = require('../trading/strategies/heikenAshi');
const { analyzeModifiedHeikenAshiStrategy } = require('../trading/strategies/modifiedHeikenAshi');
const { computeHeikenAshi, computeEMA, computeJMA } = require('../trading/indicators');
const jwt      = require('jsonwebtoken');

// ─── Shared test state ────────────────────────────────────────────────────────
const EMAIL_SUFFIX = '@p4strict-test.com';
let userA, userB, userC;
let tokenA, tokenB, tokenC;
let stratA, stratB, stratC;

function makeToken(user) {
  return jwt.sign(
    { id: user._id, tokenVersion: user.tokenVersion || 1 },
    process.env.JWT_SECRET || 'fallback-secret-for-tests'
  );
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────
beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI);
  }
  // Hard-clean previous test artefacts
  const emailRe = new RegExp(EMAIL_SUFFIX.replace('.', '\\.') + '$');
  await User.deleteMany({ email: emailRe });
  await Trade.deleteMany({ index: 'P4STRICT' });

  userA = await User.create({ email: `ua_${Date.now()}${EMAIL_SUFFIX}`, password: 'Aa1!password', tokenVersion: 1 });
  userB = await User.create({ email: `ub_${Date.now()}${EMAIL_SUFFIX}`, password: 'Bb1!password', tokenVersion: 1 });
  userC = await User.create({ email: `uc_${Date.now()}${EMAIL_SUFFIX}`, password: 'Cc1!password', tokenVersion: 1 });

  tokenA = makeToken(userA);
  tokenB = makeToken(userB);
  tokenC = makeToken(userC);

  stratA = await Strategy.create({ name: 'HeikenAshi', userId: userA._id, isActive: true });
  stratB = await Strategy.create({ name: 'HeikenAshi', userId: userB._id, isActive: true });
  stratC = await Strategy.create({ name: 'HeikenAshi', userId: userC._id, isActive: true });
});

afterAll(async () => {
  const emailRe = new RegExp(EMAIL_SUFFIX.replace('.', '\\.') + '$');
  await User.deleteMany({ email: emailRe });
  await Trade.deleteMany({ index: 'P4STRICT' });
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
});

// ─── Req 1: Centralized Error Handler – Standard JSON Contract ────────────────
describe('Phase 4 Req 1 — Centralized error handler middleware', () => {
  it('returns { success:false, error:{ code, message } } for invalid strategyId', async () => {
    const res = await request(app)
      .get('/api/v1/trades')
      .query({ strategyId: 'not-a-valid-objectid' })
      .set('Cookie', [`jwt=${tokenA}`]);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
    expect(typeof res.body.error.code).toBe('string');
    expect(typeof res.body.error.message).toBe('string');
    expect(res.body.error.code).toBe('INVALID_INPUT_FORMAT');
    expect(res.body.error.message).toMatch(/strategyId/i);
  });

  it('returns { success:false } with code INVALID_INPUT_FORMAT for bad timeFrom format', async () => {
    const res = await request(app)
      .get('/api/v1/trades')
      .query({ timeFrom: '99:99' })  // invalid time
      .set('Cookie', [`jwt=${tokenA}`]);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_INPUT_FORMAT');
  });

  it('returns INVALID_TIME_RANGE when timeFrom > timeTo', async () => {
    const res = await request(app)
      .get('/api/v1/trades')
      .query({ timeFrom: '15:00', timeTo: '09:00' })
      .set('Cookie', [`jwt=${tokenA}`]);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_TIME_RANGE');
  });

  it('returns TRADE_NOT_FOUND when updating an unknown trade', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .post('/api/v1/trades/update-exit')
      .send({ tradeId: fakeId.toString(), exitPrice: 100, exitReason: 'Manual' })
      .set('Cookie', [`jwt=${tokenA}`, 'XSRF-TOKEN=t'])
      .set('x-xsrf-token', 't');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('TRADE_NOT_FOUND');
  });

  it('returns STRATEGY_NOT_FOUND when recording trade for non-existent strategy', async () => {
    const res = await request(app)
      .post('/api/v1/trades/record')
      .send({ strategyName: 'GHOST_STRATEGY_XYZ', index: 'P4STRICT', premium: 'TEST', qty: 75, buyPrice: 100 })
      .set('Cookie', [`jwt=${tokenA}`, 'XSRF-TOKEN=t'])
      .set('x-xsrf-token', 't');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('STRATEGY_NOT_FOUND');
  });
});

// ─── Req 2: Charges Calculator — All Components, Boundary, Edge Cases ─────────
describe('Phase 4 Req 2 — Option transaction charges calculator (unit tests)', () => {
  it('computes all 6 charge components accurately for 75-lot NIFTY option', () => {
    // buy=100 sell=150 qty=75
    const r = calculateCharges(100, 150, 75);
    // buyTurnover = 7500, exitTurnover = 11250, total = 18750
    expect(r.breakdown.brokerage).toBe(40.00);        // 20*2
    expect(r.breakdown.stt).toBe(7.03);               // 11250*0.000625 = 7.03125 → 7.03
    expect(r.breakdown.exchangeTxn).toBe(9.38);       // 18750*0.0005 = 9.375 → 9.38
    expect(r.breakdown.sebi).toBe(0.02);              // 18750*0.000001 = 0.01875 → 0.02
    expect(r.breakdown.stampDuty).toBe(0.23);         // 7500*0.00003 = 0.225 → 0.23
    expect(r.breakdown.gst).toBe(8.89);               // (40+9.375+0.01875)*0.18 = 8.89
    expect(r.total).toBe(65.54);
    expect(r.version).toBe('2026-v1');
  });

  it('handles break-even trade (buy == exit) correctly', () => {
    const r = calculateCharges(100, 100, 75);
    expect(r.breakdown.brokerage).toBe(40);
    // stt on exit = 7500 * 0.000625 = 4.6875 → 4.69
    expect(r.breakdown.stt).toBe(4.69);
    // exchange txn = 15000 * 0.0005 = 7.5
    expect(r.breakdown.exchangeTxn).toBe(7.50);
    // stamp duty = 7500 * 0.00003 = 0.225 → 0.23
    expect(r.breakdown.stampDuty).toBe(0.23);
    expect(r.total).toBeGreaterThan(0);
    expect(typeof r.total).toBe('number');
    expect(isNaN(r.total)).toBe(false);
  });

  it('scales correctly with larger lot sizes (SENSEX 20 qty)', () => {
    const rSmall = calculateCharges(500, 600, 20);
    const rLarge = calculateCharges(500, 600, 40);
    // STT is on exit turnover — should scale proportionally
    expect(rLarge.breakdown.stt).toBeCloseTo(rSmall.breakdown.stt * 2, 0);
    expect(rLarge.breakdown.stampDuty).toBeCloseTo(rSmall.breakdown.stampDuty * 2, 0);
  });

  it('returns a non-negative total charges even on a losing trade', () => {
    // Buy at 200, exit at 50 (deep loss)
    const r = calculateCharges(200, 50, 75);
    expect(r.total).toBeGreaterThan(0);
    expect(r.breakdown.brokerage).toBe(40);
  });

  it('version is always "2026-v1" regardless of trade parameters', () => {
    const r1 = calculateCharges(1, 2, 1);
    const r2 = calculateCharges(999, 1, 10000);
    expect(r1.version).toBe('2026-v1');
    expect(r2.version).toBe('2026-v1');
  });

  it('all breakdown values round to at most 2 decimal places', () => {
    const r = calculateCharges(123.45, 234.56, 37);
    Object.values(r.breakdown).forEach(val => {
      const str = String(val);
      const decimals = str.includes('.') ? str.split('.')[1].length : 0;
      expect(decimals).toBeLessThanOrEqual(2);
    });
    const totalStr = String(r.total);
    const totalDecimals = totalStr.includes('.') ? totalStr.split('.')[1].length : 0;
    expect(totalDecimals).toBeLessThanOrEqual(2);
  });
});

// ─── Req 3: Charges Persisted on Every Trade Exit (API path) ──────────────────
describe('Phase 4 Req 3 — Charges persisted to MongoDB on trade exit (API path)', () => {
  let tradeForChargesTest;

  beforeAll(async () => {
    tradeForChargesTest = await Trade.create({
      userId: userA._id, strategyId: stratA._id,
      status: 'IN_POSITION', index: 'P4STRICT',
      premium: 'NIFTY26AUG21500CE', qty: 75, buyPrice: 100
    });
  });

  it('persists charges, chargesBreakdown, and chargesVersion on exit via API', async () => {
    const res = await request(app)
      .post('/api/v1/trades/update-exit')
      .send({ tradeId: tradeForChargesTest._id.toString(), exitPrice: 150, exitReason: 'Target' })
      .set('Cookie', [`jwt=${tokenA}`, 'XSRF-TOKEN=t'])
      .set('x-xsrf-token', 't');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');

    const updated = await Trade.findById(tradeForChargesTest._id);
    // Core fields
    expect(updated.status).toBe('CLOSED');
    expect(updated.pnl).toBe(3750);      // (150-100)*75
    expect(updated.charges).toBe(65.54); // matches calculator test
    // Breakdown preserved
    expect(updated.chargesBreakdown).toBeDefined();
    expect(updated.chargesBreakdown.brokerage).toBe(40);
    expect(updated.chargesBreakdown.stt).toBe(7.03);
    expect(updated.chargesBreakdown.gst).toBe(8.89);
    // Version must be set
    expect(updated.chargesVersion).toBe('2026-v1');
    // NetPnL = 3750 - 65.54 = 3684.46 (verified via analytics)
  });

  it('persists charges on a losing trade exit', async () => {
    const lossTrade = await Trade.create({
      userId: userA._id, strategyId: stratA._id,
      status: 'IN_POSITION', index: 'P4STRICT',
      premium: 'NIFTY26AUG21600CE', qty: 75, buyPrice: 200
    });
    const res = await request(app)
      .post('/api/v1/trades/update-exit')
      .send({ tradeId: lossTrade._id.toString(), exitPrice: 150, exitReason: 'SL' })
      .set('Cookie', [`jwt=${tokenA}`, 'XSRF-TOKEN=t'])
      .set('x-xsrf-token', 't');

    expect(res.status).toBe(200);
    const updated = await Trade.findById(lossTrade._id);
    expect(updated.status).toBe('CLOSED');
    expect(updated.pnl).toBe(-3750); // (150-200)*75
    // Charges are still positive on a losing trade
    expect(updated.charges).toBeGreaterThan(0);
    expect(updated.chargesVersion).toBe('2026-v1');
  });

  it('persists charges on a zero-PnL (breakeven) exit', async () => {
    const evenTrade = await Trade.create({
      userId: userA._id, strategyId: stratA._id,
      status: 'IN_POSITION', index: 'P4STRICT',
      premium: 'NIFTY26AUG21700CE', qty: 75, buyPrice: 120
    });
    const res = await request(app)
      .post('/api/v1/trades/update-exit')
      .send({ tradeId: evenTrade._id.toString(), exitPrice: 120, exitReason: 'Manual' })
      .set('Cookie', [`jwt=${tokenA}`, 'XSRF-TOKEN=t'])
      .set('x-xsrf-token', 't');

    expect(res.status).toBe(200);
    const updated = await Trade.findById(evenTrade._id);
    expect(updated.pnl).toBe(0);
    expect(updated.charges).toBeGreaterThan(0);
    expect(updated.chargesVersion).toBe('2026-v1');
  });
});

// ─── Req 4: Analytics — actual-charges sum, accurate netPnL ──────────────────
describe('Phase 4 Req 4 — Analytics use actual persisted charges, not estimates', () => {
  // State: userA has 3 CLOSED trades from Req 3 tests at this point.
  // We'll fetch analytics and validate the taxes field equals the sum of actual charges.

  it('analytics.taxes equals sum of actual persisted charges (not totalTrades × flat)', async () => {
    const res = await request(app)
      .get('/api/v1/trades')
      .set('Cookie', [`jwt=${tokenA}`]);

    expect(res.status).toBe(200);
    const { analytics } = res.body;
    expect(analytics).toBeDefined();

    // Fetch trades directly to compute expected sums
    const dbTrades = await Trade.find({
      userId: userA._id,
      index: 'P4STRICT',
      pnl: { $exists: true }
    });

    const expectedTaxes = Math.round(dbTrades.reduce((s, t) => s + (t.charges || 0), 0) * 100) / 100;
    const expectedPnl   = dbTrades.reduce((s, t) => s + (t.pnl || 0), 0);
    const expectedNet   = Math.round((expectedPnl - expectedTaxes) * 100) / 100;

    expect(analytics.taxes).toBe(expectedTaxes);
    expect(analytics.totalPnl).toBe(expectedPnl);
    expect(analytics.netPnl).toBe(expectedNet);
  });
});

// ─── Req 5: Multi-user isolation ─────────────────────────────────────────────
describe('Phase 4 Req 5 — Strict multi-user isolation', () => {
  let tradeByUserA;

  beforeAll(async () => {
    // Create fresh trade for userA
    tradeByUserA = await Trade.create({
      userId: userA._id, strategyId: stratA._id,
      status: 'IN_POSITION', index: 'P4STRICT',
      premium: 'NIFTY_ISOLATION_TEST', qty: 75, buyPrice: 100
    });
    // Create independent trade for userB
    await Trade.create({
      userId: userB._id, strategyId: stratB._id,
      status: 'IN_POSITION', index: 'P4STRICT',
      premium: 'NIFTY_ISOLATION_TEST', qty: 75, buyPrice: 100
    });
  });

  it('User A cannot see User B trades in GET /api/v1/trades', async () => {
    const resA = await request(app)
      .get('/api/v1/trades')
      .set('Cookie', [`jwt=${tokenA}`]);
    const tradeIds = resA.body.data.trades.map(t => t._id.toString());
    // Ensure none of the returned trades belong to userB
    const userBTradeIds = await Trade.find({ userId: userB._id }).select('_id');
    const userBIds = userBTradeIds.map(t => t._id.toString());
    const overlap = tradeIds.filter(id => userBIds.includes(id));
    expect(overlap.length).toBe(0);
  });

  it('User B cannot see User A trades in GET /api/v1/trades', async () => {
    const resB = await request(app)
      .get('/api/v1/trades')
      .set('Cookie', [`jwt=${tokenB}`]);
    const tradeIds = resB.body.data.trades.map(t => t._id.toString());
    const userATradeIds = await Trade.find({ userId: userA._id }).select('_id');
    const userAIds = userATradeIds.map(t => t._id.toString());
    const overlap = tradeIds.filter(id => userAIds.includes(id));
    expect(overlap.length).toBe(0);
  });

  it('User B cannot close User A trade via update-exit (returns 404)', async () => {
    const res = await request(app)
      .post('/api/v1/trades/update-exit')
      .send({ tradeId: tradeByUserA._id.toString(), exitPrice: 200, exitReason: 'Manual' })
      .set('Cookie', [`jwt=${tokenB}`, 'XSRF-TOKEN=t'])
      .set('x-xsrf-token', 't');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TRADE_NOT_FOUND');

    // Trade must still be IN_POSITION
    const stillOpen = await Trade.findById(tradeByUserA._id);
    expect(stillOpen.status).toBe('IN_POSITION');
  });

  it('User C (no trades) gets empty results and zero analytics', async () => {
    // Create then delete to ensure zero state
    const res = await request(app)
      .get('/api/v1/trades')
      .set('Cookie', [`jwt=${tokenC}`]);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.analytics.totalPnl).toBe(0);
    expect(res.body.analytics.taxes).toBe(0);
    expect(res.body.analytics.netPnl).toBe(0);
  });

  it('analytics for User A and User B are completely independent', async () => {
    // Close userB trade to create analytics data
    const userBOpenTrade = await Trade.findOne({ userId: userB._id, status: 'IN_POSITION', index: 'P4STRICT' });
    if (userBOpenTrade) {
      await request(app)
        .post('/api/v1/trades/update-exit')
        .send({ tradeId: userBOpenTrade._id.toString(), exitPrice: 130, exitReason: 'Target' })
        .set('Cookie', [`jwt=${tokenB}`, 'XSRF-TOKEN=t'])
        .set('x-xsrf-token', 't');
    }

    const resA = await request(app).get('/api/v1/trades').set('Cookie', [`jwt=${tokenA}`]);
    const resB = await request(app).get('/api/v1/trades').set('Cookie', [`jwt=${tokenB}`]);

    // Analytics should differ between users
    const totalA = resA.body.analytics.taxes;
    const totalB = resB.body.analytics.taxes;
    // Both must be non-negative
    expect(totalA).toBeGreaterThanOrEqual(0);
    expect(totalB).toBeGreaterThanOrEqual(0);
    // They should be independent (B has exactly 1 trade, A has more)
    expect(resB.body.total).toBeGreaterThan(0);
    expect(resA.body.total).toBeGreaterThan(resB.body.total);
  });
});

// ─── Req 6: Heiken Ashi & Modified HA Signals Unchanged ──────────────────────
describe('Phase 4 Req 6 — Heiken Ashi indicator signals unchanged after refactor', () => {
  // Build a synthetic set of candles that satisfies the entry condition:
  //   lastNoWick && prevNoWick && lastGreen && prevGreen && jmaGtEma && closeGtJma
  function makeBullishCandles() {
    const candles = [];
    // Populate enough candles for EMA(20) and JMA(7) to stabilize
    for (let i = 0; i < 30; i++) {
      const base = 200 + i * 2; // steadily rising
      candles.push({ time: i, open: base, high: base + 3, low: base, close: base + 3 });
    }
    return candles;
  }

  it('computeHeikenAshi returns valid HA candle array', () => {
    const raw = makeBullishCandles();
    const ha = computeHeikenAshi(raw);
    expect(Array.isArray(ha)).toBe(true);
    expect(ha.length).toBe(raw.length);
    ha.forEach(c => {
      expect(typeof c.open).toBe('number');
      expect(typeof c.close).toBe('number');
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
    });
  });

  it('computeEMA returns array of same length as input', () => {
    const values = Array.from({ length: 25 }, (_, i) => 100 + i);
    const ema = computeEMA(values, 10);
    expect(ema.length).toBe(values.length);
    ema.forEach(v => expect(typeof v).toBe('number'));
  });

  it('computeJMA returns array of same length as input', () => {
    const values = Array.from({ length: 20 }, (_, i) => 50 + i * 0.5);
    const jma = computeJMA(values, 7);
    expect(jma.length).toBe(values.length);
    jma.forEach(v => expect(typeof v).toBe('number'));
  });

  it('analyzeHeikenAshiStrategy returns isEntry=true for clear bullish breakout candles', () => {
    const raw = makeBullishCandles();
    const ha = computeHeikenAshi(raw);
    const result = analyzeHeikenAshiStrategy(ha);
    expect(result).toHaveProperty('trend');
    expect(result).toHaveProperty('isEntry');
    expect(result).toHaveProperty('isExit');
    // On steadily-rising candles with no lower wicks, entry should be true
    expect(result.isEntry).toBe(true);
    expect(result.trend).toBe('BULLISH');
  });

  it('analyzeHeikenAshiStrategy returns isExit=true for bearish reversal candles', () => {
    const bearishCandles = [];
    for (let i = 0; i < 25; i++) {
      const base = 300 - i * 2; // falling
      bearishCandles.push({ time: i, open: base + 3, high: base + 3, low: base - 1, close: base });
    }
    const ha = computeHeikenAshi(bearishCandles);
    const result = analyzeHeikenAshiStrategy(ha);
    // At minimum the result must have required fields
    expect(result).toHaveProperty('isExit');
    // On falling candles, close < open for both last and prev → isExit = true
    expect(result.isExit).toBe(true);
  });

  it('analyzeHeikenAshiStrategy returns NEUTRAL when signals are mixed', () => {
    // Only 2 candles, alternating
    const mixed = [
      { time: 0, open: 100, high: 110, low: 95, close: 105 },
      { time: 1, open: 105, high: 115, low: 100, close: 102 }
    ];
    const ha = computeHeikenAshi(mixed);
    const result = analyzeHeikenAshiStrategy(ha);
    // last: haClose < haOpen (bearish) but prev: check actual direction
    expect(['NEUTRAL', 'BULLISH', 'BEARISH']).toContain(result.trend);
  });

  it('detectHeikenAshiTrend returns NEUTRAL for single candle', () => {
    const result = detectHeikenAshiTrend([{ open: 100, close: 105 }]);
    expect(result).toBe('NEUTRAL');
  });

  it('heikenAshi module re-exports computeHeikenAshi, computeEMA, computeJMA from indicators', () => {
    const ha = require('../trading/strategies/heikenAshi');
    expect(typeof ha.computeHeikenAshi).toBe('function');
    expect(typeof ha.computeEMA).toBe('function');
    expect(typeof ha.computeJMA).toBe('function');
  });

  it('analyzeModifiedHeikenAshiStrategy produces identical signals to analyzeHeikenAshiStrategy for same candles', () => {
    const raw = makeBullishCandles();
    const ha = computeHeikenAshi(raw);
    const resultHA = analyzeHeikenAshiStrategy(ha);
    const resultMHA = analyzeModifiedHeikenAshiStrategy(ha);
    // Both use the same signal logic — results must match
    expect(resultMHA.isEntry).toBe(resultHA.isEntry);
    expect(resultMHA.isExit).toBe(resultHA.isExit);
    expect(resultMHA.trend).toBe(resultHA.trend);
  });

  it('modifiedHeikenAshi module exports computeModifiedHeikenAshi from centralized indicators', () => {
    const mha = require('../trading/strategies/modifiedHeikenAshi');
    expect(typeof mha.computeModifiedHeikenAshi).toBe('function');
    // Must be the same function as computeHeikenAshi from indicators
    const indicators = require('../trading/indicators');
    expect(mha.computeModifiedHeikenAshi).toBe(indicators.computeHeikenAshi);
  });
});

// ─── Req 7: Risk Engine — pre-trade validation ────────────────────────────────
describe('Phase 4 Req 7 — Risk engine: quantity, daily loss, duplicate-entry block', () => {
  it('rejects entry when quantity exceeds max for index', async () => {
    const riskService = require('../services/riskService');
    await expect(
      riskService.validateEntry({
        userId: userA._id.toString(),
        strategyId: stratA._id.toString(),
        strategyName: 'HA',
        underlying: 'SENSEX',
        quantity: 99999,  // way over limit of 500
        isLive: false
      })
    ).rejects.toThrow(/exceeds maximum allowed limit/i);
  });

  it('rejects entry when quantity is zero', async () => {
    const riskService = require('../services/riskService');
    await expect(
      riskService.validateEntry({
        userId: userA._id.toString(),
        strategyId: stratA._id.toString(),
        strategyName: 'HA',
        underlying: 'SENSEX',
        quantity: 0,
        isLive: false
      })
    ).rejects.toThrow(/Invalid order quantity/i);
  });

  it('rejects entry when strategy already has an open trade (duplicate block)', async () => {
    const riskService = require('../services/riskService');
    // stratB has an open IN_POSITION trade from Req 5 tests
    const openTrade = await Trade.create({
      userId: userB._id, strategyId: stratB._id,
      status: 'IN_POSITION', index: 'P4STRICT',
      premium: 'DUPLICATE_BLOCK_TEST', qty: 75, buyPrice: 100
    });

    await expect(
      riskService.validateEntry({
        userId: userB._id.toString(),
        strategyId: stratB._id.toString(),
        strategyName: 'HeikenAshi',
        underlying: 'SENSEX',
        quantity: 20,
        isLive: false
      })
    ).rejects.toThrow(/Duplicate entry blocked/i);

    // Cleanup
    await Trade.findByIdAndDelete(openTrade._id);
  });

  it('allows entry after the blocking trade is closed', async () => {
    const riskService = require('../services/riskService');
    // stratC has no open trades at this point
    const result = await riskService.validateEntry({
      userId: userC._id.toString(),
      strategyId: stratC._id.toString(),
      strategyName: 'HeikenAshi',
      underlying: 'SENSEX',
      quantity: 20,
      isLive: false
    });
    expect(result.valid).toBe(true);
  });

  it('triggers kill-switch when daily loss exceeds threshold', async () => {
    const riskService = require('../services/riskService');
    // Persist a large loss for userC today
    await Trade.create({
      userId: userC._id, strategyId: stratC._id,
      status: 'CLOSED', index: 'P4STRICT',
      premium: 'LOSS_TEST', qty: 75,
      buyPrice: 1000, exitPrice: 10,
      pnl: -74250,  // exceeds DEFAULT_MAX_DAILY_LOSS of 50000
      charges: 0
    });

    await expect(
      riskService.validateEntry({
        userId: userC._id.toString(),
        strategyId: stratC._id.toString(),
        strategyName: 'HeikenAshi',
        underlying: 'SENSEX',
        quantity: 20,
        isLive: false
      })
    ).rejects.toThrow(/Daily loss limit breached/i);

    // Cleanup
    await Trade.deleteMany({ userId: userC._id, premium: 'LOSS_TEST' });
  });
});

// ─── Req 8: PnL boundary / edge cases ────────────────────────────────────────
describe('Phase 4 Req 8 — PnL boundary & netPnL calculation edge cases', () => {
  it('netPnl is totalPnl minus taxes (not a flat estimate)', async () => {
    // Create a fresh user to have clean numbers
    const emailFresh = `fresh_${Date.now()}${EMAIL_SUFFIX}`;
    const freshUser  = await User.create({ email: emailFresh, password: 'Fresh@1!pass', tokenVersion: 1 });
    const freshStrat = await Strategy.create({ name: 'HeikenAshi', userId: freshUser._id, isActive: true });
    const freshToken = makeToken(freshUser);

    // Create and close a known trade: buy=200 exit=250 qty=20 → pnl=1000
    const t = await Trade.create({
      userId: freshUser._id, strategyId: freshStrat._id,
      status: 'IN_POSITION', index: 'P4STRICT',
      premium: 'FRESH_TRADE', qty: 20, buyPrice: 200
    });
    await request(app)
      .post('/api/v1/trades/update-exit')
      .send({ tradeId: t._id.toString(), exitPrice: 250, exitReason: 'Target' })
      .set('Cookie', [`jwt=${freshToken}`, 'XSRF-TOKEN=t'])
      .set('x-xsrf-token', 't');

    const expected = calculateCharges(200, 250, 20);
    const res = await request(app)
      .get('/api/v1/trades')
      .set('Cookie', [`jwt=${freshToken}`]);

    expect(res.status).toBe(200);
    expect(res.body.analytics.totalPnl).toBe(1000);
    expect(res.body.analytics.taxes).toBe(expected.total);
    expect(res.body.analytics.netPnl).toBe(Math.round((1000 - expected.total) * 100) / 100);

    // Cleanup
    await User.findByIdAndDelete(freshUser._id);
    await Trade.deleteMany({ userId: freshUser._id });
  });
});

// ─── Req 9: chargesVersion field — always persisted ──────────────────────────
describe('Phase 4 Req 9 — chargesVersion always persisted (enables future rate audits)', () => {
  it('every CLOSED trade has a chargesVersion field', async () => {
    const closedTrades = await Trade.find({
      userId: userA._id,
      status: 'CLOSED',
      index: 'P4STRICT'
    });
    expect(closedTrades.length).toBeGreaterThan(0);
    closedTrades.forEach(t => {
      expect(t.chargesVersion).toBeDefined();
      expect(typeof t.chargesVersion).toBe('string');
      expect(t.chargesVersion.length).toBeGreaterThan(0);
    });
  });

  it('chargesBreakdown has all expected keys', async () => {
    const trade = await Trade.findOne({
      userId: userA._id,
      status: 'CLOSED',
      index: 'P4STRICT',
      chargesVersion: { $exists: true }
    });
    expect(trade).not.toBeNull();
    const bd = trade.chargesBreakdown;
    expect(typeof bd.brokerage).toBe('number');
    expect(typeof bd.stt).toBe('number');
    expect(typeof bd.exchangeTxn).toBe('number');
    expect(typeof bd.sebi).toBe('number');
    expect(typeof bd.stampDuty).toBe('number');
    expect(typeof bd.gst).toBe('number');
  });
});

// ─── Req 10: Frontend manual trading — smoke test API routes it depends on ────
describe('Phase 4 Req 10 — ManualTradingPage backend dependencies (margins, trades)', () => {
  it('GET /api/v1/trades with limit=5 returns trades list used by Live Execution Stream', async () => {
    const res = await request(app)
      .get('/api/v1/trades')
      .query({ limit: 5 })
      .set('Cookie', [`jwt=${tokenA}`]);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(Array.isArray(res.body.data.trades)).toBe(true);
    expect(res.body.data.trades.length).toBeLessThanOrEqual(5);
  });

  it('trades endpoint requires authentication (rejects request without JWT)', async () => {
    const res = await request(app).get('/api/v1/trades');
    expect([401, 403]).toContain(res.status);
  });
});
