const Trade = require('../models/Trade');
const Strategy = require('../models/Strategy');
const contractManager = require('./contractManager');
const marketDataService = require('./marketDataService');
const orderUpdateService = require('./orderUpdateService');
const marketSessionManager = require('./marketSessionManager');
const distributedLock = require('./distributedLock');
const riskService = require('./riskService');
const { randomUUID } = require('crypto');
marketSessionManager.startMonitoring();

/**
 * Unique identifier for this process instance.
 * Used as part of distributed lock ownerIds so that two server replicas
 * running for the same user cannot accidentally share a re-entrant lock.
 */
const PROCESS_INSTANCE_ID = randomUUID();


const strategyRegistry = require('./strategyRegistry');
const indicators = require('../trading/indicators');
strategyRegistry.init().catch(err => console.error('[StrategyEngine] Registry init error:', err.message));

const ANGEL_API_BASE = process.env.ANGEL_ONE_API_BASE || 'http://localhost:8000';
const INDEX_CONFIG = {
  SENSEX: { qty: 20, step: 20, exchange: 'BFO' },
  NIFTY: { qty: 65, step: 65, exchange: 'NFO' },
  BANKNIFTY: { qty: 30, step: 30, exchange: 'NFO' },
  CRUDEOILM: { qty: 1, step: 1, exchange: 'MCX' }
};
// Shared secret sent as X-Internal-Token header on every call to the Python service.
// Must match INTERNAL_API_SECRET in angel-one/.env.
const ANGEL_ONE_INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || process.env.ANGEL_ONE_INTERNAL_SECRET || '';


// Helper: HTTP request to Python Angel One Wrapper
async function callAngelApi(endpoint, userId, method = 'GET', body = null) {
  const url = `${ANGEL_API_BASE}${endpoint}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      // Issue #1 FIX: authenticate every backend→Python service call with the shared secret.
      'X-Internal-Token': ANGEL_ONE_INTERNAL_SECRET,
    }
  };
  if (userId) {
    options.headers['X-User-Id'] = String(userId);
  }
  if (body !== null) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401 && userId) {
      module.exports.handleSessionExpiry(userId).catch(() => {});
    }
    throw new Error(`Angel API Error [${res.status}]: ${text}`);
  }
  return await res.json();
}

function formatPrecisionTime(d = new Date()) {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

function asIsoDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function pickNearestExpiry(expiries) {
  if (!Array.isArray(expiries)) return null;
  const todayIso = asIsoDate();
  const valid = [...expiries].filter(Boolean).sort();
  return valid.find(e => e >= todayIso) || (valid.length ? valid[valid.length - 1] : null);
}

function pickNearestStrike(strikes, spot) {
  if (!Array.isArray(strikes) || strikes.length === 0) return null;
  return strikes.reduce((prev, curr) =>
    Math.abs(curr - spot) < Math.abs(prev - spot) ? curr : prev
  );
}

function resolveStrikeForSide(params) {
  const { strikes, atmStrike, mode, depth, side } = params;
  if (!Array.isArray(strikes) || atmStrike === null) return null;
  const sorted = [...strikes].filter(Number.isFinite).sort((a, b) => a - b);
  const idx = sorted.findIndex(s => Math.abs(s - atmStrike) < 1e-6);
  if (idx < 0) return null;

  if (mode === 'ATM') return sorted[idx];

  const steps = Math.max(0, Math.floor(depth || 1));
  if (side === 'CE') {
    const next = mode === 'ITM' ? idx - steps : idx + steps;
    return next >= 0 && next < sorted.length ? sorted[next] : null;
  }
  const next = mode === 'ITM' ? idx + steps : idx - steps;
  return next >= 0 && next < sorted.length ? sorted[next] : null;
}

function parseCandleTsMs(ts) {
  const raw = String(ts || '').trim();
  if (!raw) return null;
  const direct = Date.parse(raw);
  if (Number.isFinite(direct)) return direct;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), m[6] ? Number(m[6]) : 0, 0).getTime();
}

function getLastCompletedCandleWindow(candles, lookback) {
  if (!Array.isArray(candles) || candles.length < lookback + 1) return null;
  const now = new Date();
  now.setSeconds(0, 0);
  const currentMinuteStartMs = now.getTime();

  const completed = candles.filter(c => {
    const ms = parseCandleTsMs(c.ts);
    return ms !== null && ms < currentMinuteStartMs;
  });

  if (completed.length < lookback + 1) return null;

  const breakoutCandle = completed[completed.length - 1];
  const rangeCandles = completed.slice(completed.length - (lookback + 1), completed.length - 1);
  if (rangeCandles.length !== lookback) return null;
  return { rangeCandles, breakoutCandle };
}

class SingleStrategyRunner {
  constructor(strategyName) {
    this.strategyName = strategyName;
    this.userId = null;
    this.isRunning = false;
    this.state = 'STOPPED';
    this.message = 'Initialized';
    this.trend = 'NEUTRAL';

    this.config = {};
    this.selectedExpiry = null;
    this.atmStrike = null;
    this.ceContract = null;
    this.peContract = null;

    this.monitoredPremiums = { ce: '---', pe: '---' };
    this.checkpoints = [];

    this.activeTradeId = null;
    this.activeOrderId = null;
    this.activeTradePremium = null;
    this.entryPrice = null;
    this.activeTradeContract = null;
    this.currentLtp = null;
    this.activeTrailingSl = null;
    this.stopLoss = null;
    this.target = null;
    this.rangeSide = null;
    this.cooldownUntil = null;
    this.lastCompletedTrade = null;

    this.logs = [];
    this.lastEntryTime = null;
    this.lastProcessedCandleTs = null;
    this.isExiting = false;
    this.exitInProgress = false;
    this.exitTriggered = false;
    this.exitReasonStored = null;
    this.lastExitError = null;
    this.exitRetryCount = 0;
    this.lastExitAttemptTime = 0;

    this.contractInterval = null;
    this.scanInterval = null;
    this.monitorInterval = null;
  }

  log(msg) {
    const timestamp = new Date().toLocaleTimeString('en-IN');
    const logLine = `[${timestamp}] [${this.strategyName}] ${msg}`;
    console.log(logLine);
    this.message = msg;
    this.logs.unshift(logLine);
    if (this.logs.length > 100) this.logs.pop();
  }

  async start(config, userId) {
    if (this.isRunning) {
      this.log('Strategy is already running. Ignoring duplicate start request.');
      return;
    }
    this.config = config || {};
    this.userId = userId;
    this.isRunning = true;
    this.state = this.strategyName === '5minBreakout' ? 'WAITING' : 'SCANNING';
    this.log('Strategy execution started on Node.js');

    // Attempt trade recovery
    await this.recoverTrade();

    // Start background tasks
    this.startContractLoop();
    this.startScanLoop();
    this.startHeartbeatLoop();
  }

  startHeartbeatLoop() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);

    const emitHeartbeat = () => {
      if (!this.isRunning || (this.state !== 'SCANNING' && this.state !== 'WAITING')) return;
      if (!this.ceContract || !this.peContract) return;

      const ceLtp = marketDataService.getLtp(this.ceContract.exchange, this.ceContract.symboltoken);
      const peLtp = marketDataService.getLtp(this.peContract.exchange, this.peContract.symboltoken);

      const now = new Date();
      const intervalMs = 5 * 60 * 1000;
      const nextCandleMs = Math.ceil(now.getTime() / intervalMs) * intervalMs;
      const secondsLeft = Math.max(0, Math.round((nextCandleMs - now.getTime()) / 1000));

      const ceStr = ceLtp !== null ? `₹${ceLtp.toFixed(2)}` : 'Awaiting Ticks';
      const peStr = peLtp !== null ? `₹${peLtp.toFixed(2)}` : 'Awaiting Ticks';

      this.log(`[SCANNER HEARTBEAT] Active | CE: ${this.ceContract.tradingsymbol} (${ceStr}) | PE: ${this.peContract.tradingsymbol} (${peStr}) | Next Candle Close: ${secondsLeft}s`);
    };

    emitHeartbeat();
    this.heartbeatInterval = setInterval(emitHeartbeat, 10_000);
  }

  getBaseTimeframe() {
    const pluginClass = strategyRegistry.getPlugin(this.strategyName);
    if (pluginClass && pluginClass.manifest && pluginClass.manifest.requires && pluginClass.manifest.requires.timeframe) {
      return pluginClass.manifest.requires.timeframe;
    }
    return this.config.baseTimeframe || 'FIVE_MINUTE';
  }

  stop() {
    // Issue #9 FIX: refuse to stop while a real position is open.
    // Stopping mid-position would leave an unmanaged broker position.
    // The caller must first execute a manual exit before calling stop.
    if (this.state === 'IN_POSITION') {
      const msg = 'Cannot stop strategy while a position is open. Use manual exit first.';
      this.log(`STOP BLOCKED: ${msg}`);
      throw new Error(msg);
    }

    this.isRunning = false;
    this.state = 'STOPPED';
    this.log('Strategy execution halted.');
    this.clearAllIntervals();

    const baseTimeframe = this.getBaseTimeframe();
    if (this.candleListener) {
      marketDataService.removeListener('candle:closed', this.candleListener);
      this.candleListener = null;
    }
    if (this.ceContract) {
      marketDataService.unsubscribe(this.userId, this.ceContract.exchange, this.subscribedCeToken || this.ceContract.symboltoken, baseTimeframe);
    }
    if (this.peContract) {
      marketDataService.unsubscribe(this.userId, this.peContract.exchange, this.subscribedPeToken || this.peContract.symboltoken, baseTimeframe);
    }

    this.ceContract = null;
    this.peContract = null;
    this.atmStrike = null;
    this.selectedExpiry = null;
    this.activeTradeId = null;
    this.activeTradePremium = null;
    this.entryPrice = null;
    this.activeTradeContract = null;
    this.currentLtp = null;
    this.activeTrailingSl = null;
    this.stopLoss = null;
    this.target = null;
    this.rangeSide = null;
    this.monitoredPremiums = { ce: '---', pe: '---' };
  }

  forceStop() {
    this.isRunning = false;
    this.state = 'STOPPED';
    this.log('Strategy execution force-halted due to session expiry.');
    this.clearAllIntervals();

    const baseTimeframe = this.getBaseTimeframe();
    if (this.candleListener) {
      marketDataService.removeListener('candle:closed', this.candleListener);
      this.candleListener = null;
    }
    try {
      if (this.ceContract) {
        marketDataService.unsubscribe(this.userId, this.ceContract.exchange, this.subscribedCeToken || this.ceContract.symboltoken, baseTimeframe);
      }
      if (this.peContract) {
        marketDataService.unsubscribe(this.userId, this.peContract.exchange, this.subscribedPeToken || this.peContract.symboltoken, baseTimeframe);
      }
    } catch (e) {
      // ignore
    }

    this.ceContract = null;
    this.peContract = null;
    this.subscribedCeToken = null;
    this.subscribedPeToken = null;
    this.atmStrike = null;
    this.selectedExpiry = null;
    this.activeTradeId = null;
    this.activeTradePremium = null;
    this.entryPrice = null;
    this.activeTradeContract = null;
    this.currentLtp = null;
    this.activeTrailingSl = null;
    this.stopLoss = null;
    this.target = null;
    this.rangeSide = null;
    this.monitoredPremiums = { ce: '---', pe: '---' };
  }

  clearAllIntervals() {
    if (this.contractInterval) clearInterval(this.contractInterval);
    if (this.scanInterval) clearInterval(this.scanInterval);
    if (this.monitorInterval) clearInterval(this.monitorInterval);
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.contractInterval = null;
    this.scanInterval = null;
    this.monitorInterval = null;
    this.heartbeatInterval = null;
  }

  async recoverTrade() {
    try {
      // Scope strategy lookup strictly to this.userId for tenant isolation
      const strategyDoc = await Strategy.findOne({ name: this.strategyName, userId: this.userId });
      if (!strategyDoc) return;

      const trade = await Trade.findOne({
        userId: this.userId,
        strategyId: strategyDoc._id,
        $or: [
          { status: { $in: ['ENTRY_PENDING', 'IN_POSITION', 'EXIT_PENDING'] } },
          { exitPrice: { $exists: false } }
        ]
      }).sort({ createdAt: -1 });

      if (trade) {
        let isStillOpenOnBroker = true;

        if (trade.status === 'ENTRY_PENDING' && trade.orderId && this.config.liveTradingConsent) {
          try {
            const ob = await callAngelApi('/angel/orderbook', this.userId);
            const order = (ob?.data || []).find(o => String(o.orderid) === String(trade.orderId));
            if (order && (order.status === 'rejected' || order.status === 'cancelled' || order.orderstatus === 'rejected')) {
              trade.status = 'REJECTED';
              await trade.save();
              return;
            }
          } catch (e) {
            // Ignore orderbook read error during startup recovery
          }
        }

        if (this.config.liveTradingConsent) {
          try {
            const posRes = await callAngelApi('/angel/positions', this.userId);
            const posList = Array.isArray(posRes?.data) ? posRes.data : [];
            const held = posList.find(p => (trade.symbolToken && String(p.symboltoken) === String(trade.symbolToken)) || p.tradingsymbol === trade.premium);
            const netQty = held ? parseInt(held.netqty || '0', 10) : 0;
            if (netQty <= 0) {
              isStillOpenOnBroker = false;
            }
          } catch (err) {
            this.log(`Warning: Failed to check active positions on broker during recovery: ${err.message}`);
          }
        }

        if (isStillOpenOnBroker) {
          trade.status = 'IN_POSITION';
          await trade.save();

          this.activeTradeId = trade._id.toString();
          this.activeTradePremium = trade.premium;
          this.entryPrice = trade.buyPrice;
          this.state = 'IN_POSITION';
          if (trade.premium.endsWith('CE')) this.rangeSide = 'CE';
          if (trade.premium.endsWith('PE')) this.rangeSide = 'PE';

          try {
            const underlyingIndex = trade.index || 'SENSEX';
            const exchange = trade.exchange || ((underlyingIndex === 'SENSEX') ? 'BFO' : 'NFO');
            const optRes = await callAngelApi(`/instruments/index-options?exchange=${exchange}&underlying=${underlyingIndex}`, this.userId);
            const todayIso = new Date().toISOString().split('T')[0];
            const validExpiries = (optRes.expiries || []).filter(Boolean).sort();
            const expiry = validExpiries.find(e => e >= todayIso) || (validExpiries.length ? validExpiries[validExpiries.length - 1] : null);
            if (expiry) {
              const optChain = await callAngelApi(`/instruments/index-options?exchange=${exchange}&underlying=${underlyingIndex}&expiry=${expiry}`, this.userId);
              const contract = optChain.contracts.find(c => (trade.symbolToken && String(c.symboltoken) === String(trade.symbolToken)) || c.tradingsymbol === trade.premium);
              if (contract) {
                this.activeTradeContract = contract;
                this.log(`Successfully recovered option contract details for ${trade.premium} (Token: ${contract.symboltoken})`);
              }
            }
          } catch (e) {
            this.log(`Warning: Failed to fetch contract details for active trade: ${e.message}`);
          }

          this.log(`Recovered active open trade for ${trade.premium} @ ₹${trade.buyPrice}`);
          this.startMonitorLoop();
        } else {
          this.log(`Stale MongoDB trade ${trade.premium} found closed on broker. Reconciling to CLOSED in DB...`);
          trade.status = 'CLOSED';
          trade.exitPrice = trade.buyPrice;
          trade.exitReason = 'RECOVERY_CLEANUP';
          trade.pnl = 0;
          trade.charges = 60;
          trade.reconciled = true;
          await trade.save();
        }
      }
    } catch (err) {
      console.error(`[${this.strategyName}] Recovery error:`, err);
    }
  }

  async startContractLoop() {
    const resolveContracts = async () => {
      if (!this.isRunning) return;
      try {
        const underlying = this.config.underlying || 'SENSEX';
        const strikeMode = this.config.strikeMode || 'ATM';
        const strikeDepth = this.config.strikeDepth || 1;

        const resolved = await contractManager.resolveContracts(this.userId, underlying, strikeMode, strikeDepth);

        if (!this.selectedExpiry) {
          this.selectedExpiry = resolved.selectedExpiry;
        }
        if (!this.activeTradeId) {
          this.atmStrike = resolved.atmStrike;
        }

        this.ceContract = resolved.ceContract;
        this.peContract = resolved.peContract;

        if (this.ceContract && this.peContract) {
          this.monitoredPremiums = { ce: this.ceContract.tradingsymbol, pe: this.peContract.tradingsymbol };

          // Subscribe contracts to MarketDataService only when changed or initial
          const baseTimeframe = this.getBaseTimeframe();
          if (!this.subscribedCeToken || this.subscribedCeToken !== this.ceContract.symboltoken) {
            if (this.subscribedCeToken) {
              marketDataService.unsubscribe(this.userId, this.ceContract.exchange, this.subscribedCeToken, baseTimeframe);
            }
            await marketDataService.subscribe(this.userId, this.ceContract.exchange, this.ceContract.symboltoken, baseTimeframe);
            this.subscribedCeToken = this.ceContract.symboltoken;
          }
          if (!this.subscribedPeToken || this.subscribedPeToken !== this.peContract.symboltoken) {
            if (this.subscribedPeToken) {
              marketDataService.unsubscribe(this.userId, this.peContract.exchange, this.subscribedPeToken, baseTimeframe);
            }
            await marketDataService.subscribe(this.userId, this.peContract.exchange, this.peContract.symboltoken, baseTimeframe);
            this.subscribedPeToken = this.peContract.symboltoken;
          }
        }
      } catch (err) {
        console.error(`[${this.strategyName}] Contract discovery error:`, err.message);
      }
    };

    await resolveContracts();
    this.contractInterval = setInterval(resolveContracts, 60_000);
  }

  async startScanLoop() {
    if (this.candleListener) return;

    const runScan = async (eventData = null) => {
      if (!this.isRunning) return;
      if (this.state === 'COOLDOWN') {
        if (this.cooldownUntil && Date.now() >= this.cooldownUntil) {
          this.state = this.strategyName === '5minBreakout' ? 'WAITING' : 'SCANNING';
          this.cooldownUntil = null;
          this.log('Cooldown period completed. Resuming scanner.');
        } else {
          return;
        }
      }

      // Handle Reversal exit check when IN_POSITION on closed candle
      if (this.state === 'IN_POSITION' && this.activeTradePremium) {
        const activeContract = (this.ceContract && this.ceContract.tradingsymbol === this.activeTradePremium)
          ? this.ceContract
          : (this.peContract && this.peContract.tradingsymbol === this.activeTradePremium)
            ? this.peContract
            : null;

        if (activeContract) {
          const baseTimeframe = this.getBaseTimeframe();
          const items = marketDataService.getBuffer(activeContract.exchange, activeContract.symboltoken, baseTimeframe);
          if (items && items.length >= 2) {
            const PluginClass = strategyRegistry.getPlugin(this.strategyName);
            if (PluginClass) {
              const pluginInstance = new PluginClass(this.config);
              const signal = pluginInstance.analyze({ items, indicators });
              if (signal.isExit && !this.isExiting) {
                this.log(`Reversal exit signal detected on closed candle for ${activeContract.tradingsymbol}`);
                await this.executeExit(activeContract, this.currentLtp || signal.haClose, 'Reversal');
                return;
              }
            }
          }
        }
        return;
      }

      if (this.state !== 'SCANNING' && this.state !== 'WAITING') return;
      if (this.activeTradeId) return;
      if (!this.ceContract || !this.peContract) return;

      const scanStartMs = Date.now();
      const scanStartTs = formatPrecisionTime(new Date(scanStartMs));

      try {
        const PluginClass = strategyRegistry.getPlugin(this.strategyName);
        if (!PluginClass) {
          console.warn(`[${this.strategyName}] Plugin not registered in strategyRegistry`);
          return;
        }

        const pluginInstance = new PluginClass(this.config);
        const req = PluginClass.manifest?.requires || {};
        const baseTimeframe = req.timeframe || this.config.baseTimeframe || 'FIVE_MINUTE';
        const requiredCandles = req.lookbackCandles || 2;

        if (this.strategyName === '5minBreakout') {
          const fetchStartMs = Date.now();
          let ceItems = marketDataService.getBuffer(this.userId, this.ceContract.exchange, this.ceContract.symboltoken, 'ONE_MINUTE');
          let peItems = marketDataService.getBuffer(this.userId, this.peContract.exchange, this.peContract.symboltoken, 'ONE_MINUTE');

          if (!ceItems || ceItems.length < requiredCandles) {
            try { ceItems = await marketDataService.subscribe(this.userId, this.ceContract.exchange, this.ceContract.symboltoken, 'ONE_MINUTE', 20); } catch (err) { return; }
          }
          if (!peItems || peItems.length < requiredCandles) {
            try { peItems = await marketDataService.subscribe(this.userId, this.peContract.exchange, this.peContract.symboltoken, 'ONE_MINUTE', 20); } catch (err) { return; }
          }
          if (!ceItems || ceItems.length < requiredCandles || !peItems || peItems.length < requiredCandles) return;
          const fetchEndMs = Date.now();

          const ceEval = pluginInstance.analyze({ items: ceItems, lastProcessedTs: this.lastProcessedCandleTs, indicators });
          const peEval = pluginInstance.analyze({ items: peItems, lastProcessedTs: this.lastProcessedCandleTs, indicators });

          if (ceEval.nextTs) this.lastProcessedCandleTs = ceEval.nextTs;
          else if (peEval.nextTs) this.lastProcessedCandleTs = peEval.nextTs;

          if (ceEval.isBreakout || peEval.isBreakout) {
            const isCE = ceEval.isBreakout;
            const activeEval = isCE ? ceEval : peEval;
            const contractToTrade = isCE ? this.ceContract : this.peContract;

            this.rangeSide = isCE ? 'CE' : 'PE';
            this.stopLoss = activeEval.stopLoss;
            this.target = activeEval.target;

            const signalMs = Date.now();
            await this.executeEntry(contractToTrade, activeEval.entryPrice, isCE ? 'BULLISH' : 'BEARISH', {
              candleDetectedTs: scanStartTs,
              signalGeneratedMs: signalMs,
              signalGeneratedTs: formatPrecisionTime(new Date(signalMs)),
              fetchMs: fetchEndMs - fetchStartMs,
              calcMs: 0
            });
          }
        } else {
          const scanExchange = this.ceContract.exchange;
          const fetchStartMs = Date.now();
          let ceItems = marketDataService.getBuffer(this.userId, scanExchange, this.ceContract.symboltoken, baseTimeframe);
          let peItems = marketDataService.getBuffer(this.userId, scanExchange, this.peContract.symboltoken, baseTimeframe);

          if (!ceItems || ceItems.length < requiredCandles) {
            try { ceItems = await marketDataService.subscribe(this.userId, scanExchange, this.ceContract.symboltoken, baseTimeframe); } catch (err) { return; }
          }
          if (!peItems || peItems.length < requiredCandles) {
            try { peItems = await marketDataService.subscribe(this.userId, scanExchange, this.peContract.symboltoken, baseTimeframe); } catch (err) { return; }
          }
          if (!ceItems || ceItems.length < requiredCandles || !peItems || peItems.length < requiredCandles) return;
          const fetchEndMs = Date.now();

          const calcStartMs = Date.now();
          const ceSignal = pluginInstance.analyze({ items: ceItems, indicators });
          const peSignal = pluginInstance.analyze({ items: peItems, indicators });
          const calcEndMs = Date.now();

          // Diagnostic per-candle log output for the specific contract event (CE or PE)
          const targetSignal = (eventData && eventData.symboltoken === this.peContract?.symboltoken) ? peSignal : ceSignal;
          const targetContract = (eventData && eventData.symboltoken === this.peContract?.symboltoken) ? this.peContract : this.ceContract;
          const targetType = (eventData && eventData.symboltoken === this.peContract?.symboltoken) ? 'PE' : 'CE';

          if (targetSignal && (targetSignal.lastCandle || targetSignal.diagnostics)) {
            const candleRef = targetSignal.lastCandle || (targetType === 'CE' ? ceItems[ceItems.length - 1] : peItems[peItems.length - 1]);
            const timeStr = candleRef?.time
              ? new Date(typeof candleRef.time === 'number' && candleRef.time < 1e10 ? candleRef.time * 1000 : candleRef.time).toLocaleTimeString('en-IN')
              : scanStartTs;

            let details = '';
            if (targetSignal.lastCandle) {
              details = `  EMA = ${targetSignal.ema?.toFixed(2)}
  JMA = ${targetSignal.jma?.toFixed(2)}
  Last Candle = O:${targetSignal.lastCandle.open.toFixed(2)} H:${targetSignal.lastCandle.high.toFixed(2)} L:${targetSignal.lastCandle.low.toFixed(2)} C:${targetSignal.lastCandle.close.toFixed(2)}
  Prev Candle = O:${targetSignal.prevCandle.open.toFixed(2)} H:${targetSignal.prevCandle.high.toFixed(2)} L:${targetSignal.prevCandle.low.toFixed(2)} C:${targetSignal.prevCandle.close.toFixed(2)}`;
            } else if (targetSignal.diagnostics) {
              details = `  Diagnostics = ${JSON.stringify(targetSignal.diagnostics)}`;
            }

            this.log(`[CANDLE EVALUATION - ${targetType} ${targetContract.tradingsymbol}] Time: ${timeStr}\n${details}
  Result: ${targetSignal.isEntry ? 'SIGNAL GENERATED (YES)' : 'NO ENTRY'}
  ${!targetSignal.isEntry && targetSignal.failedReasons?.length ? 'Reason:\n    ' + targetSignal.failedReasons.join('\n    ') : ''}`);
          }

          const ceLastClosedTs = ceItems.length >= 1 ? (ceItems[ceItems.length - 1].time ?? null) : null;
          const peLastClosedTs = peItems.length >= 1 ? (peItems[peItems.length - 1].time ?? null) : null;

          if (ceSignal.isEntry && ceLastClosedTs !== this.lastEntryTime) {
            this.lastEntryTime = ceLastClosedTs;
            const signalMs = Date.now();
            const signalPrice = ceSignal.haClose || ceSignal.close || (ceItems.length ? ceItems[ceItems.length - 1].close : 0);
            await this.executeEntry(this.ceContract, signalPrice, 'BULLISH', {
              candleDetectedTs: scanStartTs,
              signalGeneratedMs: signalMs,
              signalGeneratedTs: formatPrecisionTime(new Date(signalMs)),
              fetchMs: fetchEndMs - fetchStartMs,
              calcMs: calcEndMs - calcStartMs
            });
          } else if (peSignal.isEntry && peLastClosedTs !== this.lastEntryTime) {
            this.lastEntryTime = peLastClosedTs;
            const signalMs = Date.now();
            const signalPrice = peSignal.haClose || peSignal.close || (peItems.length ? peItems[peItems.length - 1].close : 0);
            await this.executeEntry(this.peContract, signalPrice, 'BEARISH', {
              candleDetectedTs: scanStartTs,
              signalGeneratedMs: signalMs,
              signalGeneratedTs: formatPrecisionTime(new Date(signalMs)),
              fetchMs: fetchEndMs - fetchStartMs,
              calcMs: calcEndMs - calcStartMs
            });
          } else {
            this.trend = ceSignal.trend;
          }
        }
      } catch (err) {
        console.error(`[${this.strategyName}] Scan error:`, err.message);
      }
    };

    this.candleListener = async (eventData) => {
      if (eventData.userId && eventData.userId !== String(this.userId)) {
        return;
      }
      if (this.ceContract && this.peContract) {
        if (eventData.symboltoken === this.ceContract.symboltoken || eventData.symboltoken === this.peContract.symboltoken) {
          await runScan(eventData);
        }
      }
    };

    marketDataService.on('candle:closed', this.candleListener);
  }

  async executeEntry(contract, signalPrice, trendSide, timingInfo = {}) {
    if (!this.isRunning || this.state === 'IN_POSITION' || this.state === 'ENTRY_PENDING') {
      return;
    }

    // Include PROCESS_INSTANCE_ID so two server replicas for the same user
    // cannot accidentally re-acquire each other's active entry lock.
    const lockKey = `entry_${this.userId}_${this.strategyName}`;
    const ownerId = `${String(this.userId)}_${PROCESS_INSTANCE_ID}`;
    const acquired = await distributedLock.acquireLock(lockKey, ownerId, 15000);
    if (!acquired) {
      this.log('Concurrent entry lock active. Skipping duplicate entry trigger.');
      return;
    }

    const signalGeneratedMs = timingInfo.signalGeneratedMs || Date.now();
    const candleDetectedTs = timingInfo.candleDetectedTs || formatPrecisionTime(new Date(signalGeneratedMs));
    const signalGeneratedTs = timingInfo.signalGeneratedTs || formatPrecisionTime(new Date(signalGeneratedMs));

    this.log(`New candle detected: ${candleDetectedTs}`);
    this.log(`Signal generated: ${signalGeneratedTs}`);

    let actualPrice = signalPrice;
    const qty = this.config.quantity || INDEX_CONFIG[this.config.underlying || 'SENSEX']?.qty || 10;

    let buySentMs = Date.now();
    let buySentTs = formatPrecisionTime(new Date(buySentMs));

    try {
      // Find strategy document
      let strategyDoc = await Strategy.findOne({ name: this.strategyName, userId: this.userId });
      if (!strategyDoc) {
        strategyDoc = await Strategy.create({ name: this.strategyName, userId: this.userId });
      }

      // Pre-trade financial safety & risk validation
      await riskService.validateEntry({
        userId: this.userId,
        strategyId: strategyDoc._id,
        strategyName: this.strategyName,
        underlying: this.config.underlying || 'SENSEX',
        quantity: qty,
        isLive: !!this.config.liveTradingConsent,
        config: this.config
      });

      this.state = 'ENTRY_PENDING';

      // Create persistent Trade in ENTRY_PENDING state
      const tradeDoc = await Trade.create({
        userId: this.userId,
        strategyId: strategyDoc._id,
        status: 'ENTRY_PENDING',
        index: this.config.underlying || 'SENSEX',
        premium: contract.tradingsymbol,
        qty,
        buyPrice: signalPrice,
        symbolToken: contract.symboltoken,
        exchange: contract.exchange
      });
      this.activeTradeId = tradeDoc._id.toString();

      if (this.config.liveTradingConsent) {
        this.log(`BUY request sent: ${buySentTs}`);
        const sendStartMs = Date.now();
        const orderRes = await callAngelApi('/angel/orders/simple', this.userId, 'POST', {
          exchange: contract.exchange,
          tradingsymbol: contract.tradingsymbol,
          symboltoken: contract.symboltoken,
          transactiontype: 'BUY',
          producttype: 'CARRYFORWARD',
          quantity: qty,
          ordertype: 'MARKET'
        });
        const ackMs = Date.now();
        const ackTs = formatPrecisionTime(new Date(ackMs));
        this.log(`Broker acknowledged: ${ackTs} (API HTTP delay: ${ackMs - sendStartMs}ms)`);

        const orderId = orderRes?.item?.response?.data?.orderid || orderRes?.item?.response?.orderid;
        this.activeOrderId = orderId || null;

        if (!orderId) {
          tradeDoc.status = 'REJECTED';
          await tradeDoc.save();
          this.state = this.strategyName === '5minBreakout' ? 'WAITING' : 'SCANNING';
          this.activeTradeId = null;
          throw new Error('Broker returned empty orderId during BUY placement');
        }

        tradeDoc.orderId = orderId;
        await tradeDoc.save();

        // Reconcile order fill confirmation: orderbook polling with fallback
        let fillConfirmed = false;
        for (let i = 0; i < 5; i++) {
          await new Promise(r => setTimeout(r, 1000));
          const ob = await callAngelApi('/angel/orderbook', this.userId);
          const order = (ob?.data || []).find(o => String(o.orderid) === String(orderId));
          if (order) {
            const status = (order.status || order.orderstatus || '').toLowerCase();
            if (status === 'complete' || status === 'executed') {
              const execPrice = parseFloat(order.averageprice || order.price);
              if (!isNaN(execPrice) && execPrice > 0) {
                actualPrice = execPrice;
                fillConfirmed = true;
                const completedMs = Date.now();
                const completedTs = formatPrecisionTime(new Date(completedMs));
                this.log(`Order completed: ${completedTs}`);
                break;
              }
            } else if (status === 'rejected' || status === 'cancelled') {
              tradeDoc.status = 'REJECTED';
              await tradeDoc.save();
              this.state = this.strategyName === '5minBreakout' ? 'WAITING' : 'SCANNING';
              this.activeTradeId = null;
              this.activeOrderId = null;
              this.log(`Broker BUY rejected: ${order.text || status}`);
              return;
            }
          }
        }

        if (!fillConfirmed) {
          // Check broker position
          const posRes = await callAngelApi('/angel/positions', this.userId);
          const posList = Array.isArray(posRes?.data) ? posRes.data : [];
          const held = posList.find(p => (contract.symboltoken && String(p.symboltoken) === String(contract.symboltoken)) || p.tradingsymbol === contract.tradingsymbol);
          const netQty = held ? parseInt(held.netqty || '0', 10) : 0;
          if (netQty >= qty) {
            fillConfirmed = true;
            actualPrice = parseFloat(held.avgprice || held.buyavgprice) || signalPrice;
          }
        }

        if (!fillConfirmed) {
          tradeDoc.status = 'REJECTED';
          await tradeDoc.save();
          this.state = this.strategyName === '5minBreakout' ? 'WAITING' : 'SCANNING';
          this.activeTradeId = null;
          this.activeOrderId = null;
          this.log('BUY order confirmation timed out. Aborting position entry.');
          return;
        }
      } else {
        // Paper trading simulation timing logging
        this.log(`BUY request sent: ${buySentTs}`);
        this.log(`Broker acknowledged: ${buySentTs}`);
        this.log(`Order completed: ${buySentTs}`);
      }

      const confirmedMs = Date.now();
      const confirmedTs = formatPrecisionTime(new Date(confirmedMs));
      this.log(`Execution confirmed: ${confirmedTs}`);

      const totalLatencyMs = confirmedMs - signalGeneratedMs;
      this.log(`Total execution latency: ${totalLatencyMs} ms`);

      // Update trade to IN_POSITION
      tradeDoc.status = 'IN_POSITION';
      tradeDoc.buyPrice = actualPrice;
      await tradeDoc.save();

      this.entryPrice = actualPrice;
      this.activeTradePremium = contract.tradingsymbol;
      this.activeTradeContract = contract;
      this.state = 'IN_POSITION';
      this.trend = trendSide;

      if (this.strategyName === '5minBreakout') {
        const targetPoints = Number(this.config.targetPoints) || 20;
        this.target = actualPrice + targetPoints;
      } else if (this.strategyName === 'ModifiedHeikenAshi') {
        const initialSlPoints = Number(this.config.initialSlPoints) || 30;
        this.activeTrailingSl = actualPrice - initialSlPoints;
      }

      this.log(`ENTRY ${contract.tradingsymbol} @ ₹${actualPrice}`);
      this.startMonitorLoop();

    } catch (err) {
      console.error(`[${this.strategyName}] Entry execution error:`, err.message);
      this.log(`ENTRY ERROR: ${err.message}`);
      if (this.state === 'ENTRY_PENDING') {
        // If Trade.create() succeeded before the error, mark the dangling
        // ENTRY_PENDING record as REJECTED so the risk service does not
        // permanently block future entry attempts for this strategy.
        if (this.activeTradeId) {
          try {
            await Trade.findByIdAndUpdate(this.activeTradeId, { status: 'REJECTED' });
          } catch (updateErr) {
            console.error(`[${this.strategyName}] Failed to mark dangling ENTRY_PENDING trade as REJECTED:`, updateErr.message);
          }
        }
        this.state = this.strategyName === '5minBreakout' ? 'WAITING' : 'SCANNING';
        this.activeTradeId = null;
      }
    } finally {
      await distributedLock.releaseLock(lockKey, ownerId);
    }
  }

  startMonitorLoop() {
    if (this.monitorInterval) clearInterval(this.monitorInterval);

    const monitor = async () => {
      if (!this.isRunning || this.state !== 'IN_POSITION' || !this.activeTradePremium) return;

      const contract = this.activeTradeContract || (
        (this.ceContract && this.ceContract.tradingsymbol === this.activeTradePremium)
          ? this.ceContract
          : (this.peContract && this.peContract.tradingsymbol === this.activeTradePremium)
            ? this.peContract
            : null
      );

      if (!contract) return;

      try {
        const ltpRes = await callAngelApi(`/market/ltp?exchange=${encodeURIComponent(contract.exchange)}&tradingsymbol=${encodeURIComponent(contract.tradingsymbol)}&symboltoken=${encodeURIComponent(contract.symboltoken)}`, this.userId);
        const livePrice = ltpRes.ltp;
        this.currentLtp = livePrice;

        if (this.entryPrice) {
          const pnl = (livePrice - this.entryPrice) * (this.config.quantity || 10);
          this.message = `Position Active | LTP: ₹${livePrice.toFixed(2)} | PnL: ₹${pnl.toFixed(2)}`;
        }

        let shouldExit = this.exitTriggered || false;
        let exitPrice = livePrice;
        let exitReason = this.exitReasonStored || '';

        if (!shouldExit) {
          if (this.strategyName === '5minBreakout') {
            const targetPoints = Number(this.config.targetPoints) || 20;
            const targetPrice = (this.entryPrice && !isNaN(this.entryPrice)) ? (this.entryPrice + targetPoints) : this.target;

            if (this.stopLoss && livePrice <= this.stopLoss) {
              shouldExit = true;
              exitReason = 'SL';
            } else if (targetPrice && livePrice >= targetPrice) {
              shouldExit = true;
              exitReason = 'Target';
            }
          } else if (this.strategyName === 'ModifiedHeikenAshi' && this.config.exitStrategy === 'TRAILING_SL') {
            const finalTargetPoints = Number(this.config.finalTargetPoints) || 100;
            const initialSlPoints = Number(this.config.initialSlPoints) || 30;
            const trailingStopPoints = Number(this.config.trailingStopPoints) || 20;

            if (this.entryPrice && this.activeTrailingSl !== null) {
              const targetPrice = this.entryPrice + finalTargetPoints;
              if (livePrice >= targetPrice) {
                shouldExit = true;
                exitReason = 'Target';
              } else if (livePrice <= this.activeTrailingSl) {
                shouldExit = true;
                exitReason = this.activeTrailingSl === (this.entryPrice - initialSlPoints) ? 'SL' : 'Trailing SL';
              } else {
                const pointsGained = livePrice - this.entryPrice;
                if (pointsGained >= trailingStopPoints) {
                  const steps = Math.floor(pointsGained / trailingStopPoints);
                  const proposedSl = this.entryPrice + (steps * trailingStopPoints) - initialSlPoints;
                  if (proposedSl > this.activeTrailingSl) {
                    this.activeTrailingSl = proposedSl;
                    this.log(`Trailed SL up to ₹${proposedSl}`);
                  }
                }
              }
            }
          } else {
            // Combined SL & Target checks for HeikenAshi and all other strategies
            const targetPoints = Number(this.config.targetPoints) || 20;
            const slPoints = Number(this.config.slPoints) || 30;

            if (this.entryPrice) {
              if (livePrice >= this.entryPrice + targetPoints) {
                shouldExit = true;
                exitReason = 'Target';
              } else if (livePrice <= this.entryPrice - slPoints) {
                shouldExit = true;
                exitReason = 'SL';
              }
            }
          }

          if (shouldExit) {
            this.exitTriggered = true;
            this.exitReasonStored = exitReason;
          }
        }

        if (shouldExit && !this.exitInProgress) {
          const now = Date.now();
          const backoffDelay = Math.min(1000 * Math.pow(2, this.exitRetryCount), 60000);
          if (now - this.lastExitAttemptTime >= backoffDelay) {
            await this.executeExit(contract, exitPrice, exitReason);
          }
        }

      } catch (err) {
        console.error(`[${this.strategyName}] Monitor error:`, err.message);
      }
    };

    this.monitorInterval = setInterval(monitor, 1000);
  }

  async executeExit(contract, price, exitReason) {
    if (this.exitInProgress || this.state === 'EXIT_PENDING' || this.state === 'CLOSED') {
      this.log('Exit order execution already in progress or closed. Skipping duplicate call.');
      return;
    }

    // Include PROCESS_INSTANCE_ID so two server replicas for the same user
    // cannot accidentally re-acquire each other's active exit lock.
    const lockKey = `exit_${this.userId}_${this.strategyName}`;
    const ownerId = `${String(this.userId)}_${PROCESS_INSTANCE_ID}`;
    const acquired = await distributedLock.acquireLock(lockKey, ownerId, 20000);
    if (!acquired) {
      this.log('Concurrent exit lock active. Skipping duplicate exit trigger.');
      return;
    }

    this.exitInProgress = true;
    this.isExiting = true;
    this.lastExitAttemptTime = Date.now();
    let actualExitPx = price;
    const qty = this.config.quantity || 10;
    let exitSuccess = false;

    try {
      // 1. Atomic DB state transition to EXIT_PENDING
      if (this.activeTradeId) {
        const updated = await Trade.findOneAndUpdate(
          { _id: this.activeTradeId, status: 'IN_POSITION' },
          { $set: { status: 'EXIT_PENDING' } },
          { returnDocument: 'after' }
        );
        // If the DB record is not IN_POSITION, another replica has already started
        // (or completed) this exit. Do NOT submit a second SELL order.
        if (!updated) {
          this.log('Trade already exiting or exited in database. Skipping duplicate exit.');
          this.exitInProgress = false;
          this.isExiting = false;
          return;
        }
      }
      this.state = 'EXIT_PENDING';

      if (this.config.liveTradingConsent && contract) {
        // 2. Pre-exit state check: verify open position on broker before submitting order
        let brokerPositionOpen = true;
        try {
          const posRes = await callAngelApi('/angel/positions', this.userId);
          const posList = Array.isArray(posRes?.data) ? posRes.data : [];
          const held = posList.find(p => (contract.symboltoken && String(p.symboltoken) === String(contract.symboltoken)) || p.tradingsymbol === contract.tradingsymbol);
          const netQty = held ? parseInt(held.netqty || '0', 10) : 0;
          if (netQty <= 0) {
            brokerPositionOpen = false;
            this.log(`Broker position already zero (${contract.tradingsymbol} netQty: ${netQty}). Reconciling directly to CLOSED.`);
            exitSuccess = true;
          }
        } catch (posErr) {
          this.log(`Broker position check warning: ${posErr.message}. Proceeding with exit order.`);
        }

        // 3. Submit SELL order only if position is still open on broker
        if (brokerPositionOpen) {
          const orderRes = await callAngelApi('/angel/orders/simple', this.userId, 'POST', {
            exchange: contract.exchange,
            tradingsymbol: contract.tradingsymbol,
            symboltoken: contract.symboltoken,
            transactiontype: 'SELL',
            producttype: 'CARRYFORWARD',
            quantity: qty,
            ordertype: 'MARKET'
          });

          const orderId = orderRes?.item?.response?.data?.orderid || orderRes?.item?.response?.orderid;
          const brokerStatus = orderRes?.item?.response?.status;
          const brokerError = orderRes?.item?.response?.error;

          if (orderId) {
            if (this.activeTradeId) {
              await Trade.findByIdAndUpdate(this.activeTradeId, { exitOrderId: orderId });
            }

            // Await WebSocket confirmation or fallback to orderbook reconciliation
            let fillConfirmed = false;
            for (let i = 0; i < 5; i++) {
              await new Promise(r => setTimeout(r, 1000));
              const ob = await callAngelApi('/angel/orderbook', this.userId);
              const order = (ob?.data || []).find(o => String(o.orderid) === String(orderId));
              if (order) {
                const status = (order.status || order.orderstatus || '').toLowerCase();
                if (status === 'complete' || status === 'executed') {
                  const execPrice = parseFloat(order.averageprice || order.price);
                  actualExitPx = execPrice > 0 ? execPrice : actualExitPx;
                  fillConfirmed = true;
                  exitSuccess = true;
                  break;
                } else if (status === 'rejected' || status === 'cancelled') {
                  throw new Error(`Broker SELL order was rejected/cancelled: ${order.text || status}`);
                }
              }
            }

            if (!fillConfirmed) {
              // Final check on positions
              const posRes = await callAngelApi('/angel/positions', this.userId);
              const posList = Array.isArray(posRes?.data) ? posRes.data : [];
              const held = posList.find(p => (contract.symboltoken && String(p.symboltoken) === String(contract.symboltoken)) || p.tradingsymbol === contract.tradingsymbol);
              const netQty = held ? parseInt(held.netqty || '0', 10) : 0;
              if (netQty <= 0) {
                exitSuccess = true;
              } else {
                throw new Error('SELL order placed but confirmation timed out in orderbook fallback');
              }
            }
          } else if (brokerStatus === false && brokerError) {
            const errStr = String(brokerError).toLowerCase();
            if (errStr.includes('no holdings') || errStr.includes('position not found') || errStr.includes('insufficient quantity to sell') || errStr.includes('no open position')) {
              this.log(`Rejection indicates position already closed: ${brokerError}. Cleaning up...`);
              exitSuccess = true;
            } else {
              throw new Error(`Broker rejected exit order: ${brokerError}`);
            }
          } else {
            throw new Error('SmartAPI returned empty response during exit order');
          }
        }
      } else {
        exitSuccess = true;
      }

      if (exitSuccess) {
        this.log(`EXIT ${contract ? contract.tradingsymbol : ''} @ ₹${actualExitPx} (${exitReason})`);

        if (this.activeTradeId) {
          const trade = await Trade.findById(this.activeTradeId);
          if (trade) {
            const pnl = (actualExitPx - trade.buyPrice) * trade.qty;
            const charges = 60;
            trade.exitPrice = actualExitPx;
            trade.exitReason = exitReason;
            trade.pnl = pnl;
            trade.charges = charges;
            trade.status = 'CLOSED';
            trade.reconciled = true;
            await trade.save();
            this.lastCompletedTrade = trade.toObject();
          }
        }

        this.activeTradeId = null;
        this.activeTradePremium = null;
        this.entryPrice = null;
        this.activeTradeContract = null;
        this.activeTrailingSl = null;
        this.stopLoss = null;
        this.target = null;
        this.rangeSide = null;
        this.trend = 'NEUTRAL';

        this.exitInProgress = false;
        this.isExiting = false;
        this.exitTriggered = false;
        this.exitReasonStored = null;
        this.exitRetryCount = 0;
        this.lastExitAttemptTime = 0;
        this.lastExitError = null;

        if (this.monitorInterval) {
          clearInterval(this.monitorInterval);
          this.monitorInterval = null;
        }

        // Cooldown check
        let cooldownMinutes = 0;
        if (this.strategyName === '5minBreakout') {
          cooldownMinutes = 1;
        } else {
          if (exitReason === 'SL') cooldownMinutes = 4;
          else if (exitReason === 'Target' || exitReason === 'Trailing SL') cooldownMinutes = 2;
        }

        if (cooldownMinutes > 0) {
          this.cooldownUntil = Date.now() + (cooldownMinutes * 60 * 1000);
          this.state = 'COOLDOWN';
          this.log(`Entering cooldown for ${cooldownMinutes} min`);
        } else {
          this.state = this.strategyName === '5minBreakout' ? 'WAITING' : 'SCANNING';
        }
      }
    } catch (err) {
      this.exitRetryCount++;
      this.lastExitError = err.message;
      this.log(`LIVE SELL failed: ${err.message}. Retries: ${this.exitRetryCount}`);
      this.exitInProgress = false;
      this.isExiting = false;
    } finally {
      await distributedLock.releaseLock(lockKey, ownerId);
    }
  }

  async manualExit() {
    if (!this.activeTradePremium) return;
    const contract = (this.ceContract && this.ceContract.tradingsymbol === this.activeTradePremium)
      ? this.ceContract
      : (this.peContract && this.peContract.tradingsymbol === this.activeTradePremium)
        ? this.peContract
        : null;

    let exitPx = this.currentLtp || this.entryPrice || 0;
    if (contract) {
      try {
        const ltpRes = await callAngelApi(`/market/ltp?exchange=${encodeURIComponent(contract.exchange)}&tradingsymbol=${encodeURIComponent(contract.tradingsymbol)}&symboltoken=${encodeURIComponent(contract.symboltoken)}`, this.userId);
        if (ltpRes.ltp > 0) exitPx = ltpRes.ltp;
      } catch (e) {
        // use fallback
      }
    }

    this.exitTriggered = true;
    this.exitReasonStored = 'Manual';
    this.exitRetryCount = 0;
    this.lastExitAttemptTime = 0;
    await this.executeExit(contract, exitPx, 'Manual');
  }

  getStatus() {
    // Refresh checkpoints dynamically
    this.checkpoints = [
      { id: 'broker', label: 'Broker Connection', status: 'success' },
      { id: 'expiry', label: 'Next Expiry Locked', status: this.selectedExpiry ? 'success' : 'pending' },
      { id: 'ha_trend', label: 'HA Trend Stability', status: this.trend !== 'NEUTRAL' ? 'success' : 'pending' },
      { id: 'confirmation', label: 'ATM Strike Sync', status: this.atmStrike ? 'success' : 'pending' },
      { id: 'indicators', label: 'Premium Discovery', status: (this.ceContract && this.peContract) ? 'success' : 'pending' }
    ];

    return {
      strategyName: this.strategyName,
      isRunning: this.isRunning,
      state: this.state,
      message: this.message,
      trend: this.trend,
      selectedExpiry: this.selectedExpiry,
      atmStrike: this.atmStrike,
      ceContract: this.ceContract,
      peContract: this.peContract,
      monitoredPremiums: this.monitoredPremiums,
      checkpoints: this.checkpoints,
      activeTradeId: this.activeTradeId,
      activeTradePremium: this.activeTradePremium,
      entryPrice: this.entryPrice,
      currentLtp: this.currentLtp,
      activeTrailingSl: this.activeTrailingSl,
      stopLoss: this.stopLoss,
      target: this.target,
      lastCompletedTrade: this.lastCompletedTrade,
      exitInProgress: this.exitInProgress,
      exitTriggered: this.exitTriggered,
      exitReasonStored: this.exitReasonStored,
      lastExitError: this.lastExitError,
      exitRetryCount: this.exitRetryCount,
      lastExitAttemptTime: this.lastExitAttemptTime,
      logs: this.logs
    };
  }
}

class StrategyEngineManager {
  constructor() {
    this.runners = new Map();
  }

  getRunner(key) {
    if (!this.runners.has(key)) {
      // key: `${userId}_${strategyName}`
      const parts = key.split('_');
      const strategyName = parts.slice(1).join('_');
      this.runners.set(key, new SingleStrategyRunner(strategyName));
    }
    return this.runners.get(key);
  }

  async startStrategy(userId, strategyName, config) {
    const key = `${userId}_${strategyName}`;
    const runner = this.getRunner(key);
    if (runner.isRunning) {
      throw new Error('Strategy is already running.');
    }

    // Persist active strategy state in MongoDB for resilience and restart recovery
    await Strategy.findOneAndUpdate(
      { userId, name: strategyName },
      { $set: { isActive: true, config: config || {}, lastStartedAt: new Date() } },
      { upsert: true, returnDocument: 'after' }
    );

    await runner.start(config, userId);
    return runner.getStatus();
  }

  async stopStrategy(userId, strategyName) {
    const key = `${userId}_${strategyName}`;
    const runner = this.getRunner(key);
    // Issue #9 FIX: stop() throws if a position is open. Surface the error
    // back to the caller (strategyController) so the API can return a 409.
    runner.stop();

    await Strategy.findOneAndUpdate(
      { userId, name: strategyName },
      { $set: { isActive: false, lastStoppedAt: new Date() } }
    );

    return runner.getStatus();
  }

  async manualExitStrategy(userId, strategyName) {
    const key = `${userId}_${strategyName}`;
    const runner = this.getRunner(key);
    await runner.manualExit();
    return runner.getStatus();
  }

  getStrategyStatus(userId, strategyName) {
    const key = `${userId}_${strategyName}`;
    const runner = this.getRunner(key);
    return runner.getStatus();
  }

  async stopAllStrategiesForUser(userId) {
    const uid = String(userId);
    console.log(`[StrategyEngine] Stopping all running strategies for user: ${uid}`);
    for (const [key, runner] of this.runners.entries()) {
      if (key.startsWith(`${uid}_`)) {
        try {
          runner.forceStop();
        } catch (err) {
          console.error(`[StrategyEngine] Error force-stopping strategy ${key}:`, err.message);
        }
      }
    }

    try {
      await Strategy.updateMany(
        { userId: uid },
        { $set: { isActive: false, lastStoppedAt: new Date() } }
      );
    } catch (err) {
      console.error(`[StrategyEngine] Error updating Strategy.isActive on stopAll for user ${uid}:`, err.message);
    }
  }

  async handleSessionExpiry(userId) {
    try {
      const uid = String(userId);
      console.error(`[StrategyEngine] Session expired (401) for user: ${uid}. Invalidating cache and stopping strategies...`);
      
      // 1. Mark BrokerConnection as DISCONNECTED in MongoDB
      const BrokerConnection = require('../models/BrokerConnection');
      await BrokerConnection.findOneAndUpdate({ userId: uid }, { sessionStatus: 'DISCONNECTED', lastAuthError: 'Session expired' });
      
      // 2. Invalidate user's session cache in brokerController
      const brokerController = require('../controllers/brokerController');
      if (brokerController && brokerController.sessionCache) {
        brokerController.sessionCache.delete(uid);
      }
      
      // 3. Force stop all strategies cleanly for this user
      await this.stopAllStrategiesForUser(uid);

      // 4. Disconnect active smartStream connection for this user
      const smartStream = require('./smartStream');
      if (smartStream && typeof smartStream.disconnect === 'function') {
        smartStream.disconnect(uid);
      }
    } catch (err) {
      console.error('[StrategyEngine] Error handling session expiry:', err.message);
    }
  }

  async autoBootAll() {
    return autoBootBrokerStreams(true);
  }
}

// Auto-boot smartStream connections and active strategies on startup
const BrokerConnection = require('../models/BrokerConnection');
const smartStream = require('./smartStream');

async function autoBootBrokerStreams(force = false) {
  if (!force && process.env.NODE_ENV === 'test') {
    return; // Avoid unmanaged timer in automated test runs
  }
  try {
    if (!force) {
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState !== 1) return;
    
    // 1. Auto-boot active broker streams
    const connected = await BrokerConnection.find({ sessionStatus: 'CONNECTED' });
    console.log(`[StrategyEngine] Auto-booting ${connected.length} active broker streams...`);
    for (const conn of connected) {
      smartStream.connect(conn.userId.toString());
    }

    // 2. Auto-recover running strategies on startup
    const activeStrategies = await Strategy.find({ isActive: true });
    console.log(`[StrategyEngine] Auto-recovering ${activeStrategies.length} active strategies on startup...`);
    for (const strat of activeStrategies) {
      try {
        const key = `${strat.userId}_${strat.name}`;
        const runner = module.exports.getRunner(key);
        if (!runner.isRunning) {
          await runner.start(strat.config || {}, strat.userId.toString());
          console.log(`[StrategyEngine] Successfully auto-recovered strategy '${strat.name}' for user ${strat.userId}`);
        }
      } catch (stratErr) {
        console.error(`[StrategyEngine] Failed to auto-recover strategy '${strat.name}' for user ${strat.userId}:`, stratErr.message);
      }
    }
  } catch (err) {
    console.error('[StrategyEngine] Error during startup auto-boot:', err.message);
  }
}

autoBootBrokerStreams();

module.exports = new StrategyEngineManager();
