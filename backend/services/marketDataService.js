const EventEmitter = require('events');
const config = require('../config');
const marketSessionManager = require('./marketSessionManager');
const smartStream = require('./smartStream');
const orderUpdateService = require('./orderUpdateService');

const ANGEL_API_BASE = config.API.ANGEL_ONE_API_BASE;

const EXCH_TYPE_MAP = {
  NSE: 1,
  nse_cm: 1,
  NFO: 2,
  nse_fo: 2,
  BSE: 3,
  bse_cm: 3,
  BFO: 4,
  bse_fo: 4,
  MCX: 5,
  mcx_fo: 5
};

const INTERVAL_MS_MAP = {
  ONE_MINUTE: 60 * 1000,
  '1m': 60 * 1000,
  THREE_MINUTE: 3 * 60 * 1000,
  '3m': 3 * 60 * 1000,
  FIVE_MINUTE: 5 * 60 * 1000,
  '5m': 5 * 60 * 1000,
  FIFTEEN_MINUTE: 15 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  THIRTY_MINUTE: 30 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  ONE_HOUR: 60 * 60 * 1000,
  '1h': 60 * 60 * 1000
};

class MarketDataService extends EventEmitter {
  constructor() {
    super();
    this.ltpCache = new Map(); // userId_token -> { ltp, timestamp }
    this.subscribers = new Map(); // userId_token -> { exchange, exchangeType, refCount }
    this.candleBuilders = new Map(); // userId_exchange_token_interval -> builder object

    this.wsConsecutiveTicks = 0;
    this.fallbackTimer = null;
    this.fallbackPollingInterval = null;
    this.isRestFallbackActive = false;

    // Listen to ticks from multi-user smartStreamPool
    smartStream.on('tick', (tick, userId) => this.handleTick(userId, tick));
  }

  getBufferKey(userId, exchange, symboltoken, interval) {
    return `${userId}_${exchange}_${symboltoken}_${interval}`;
  }

  getExchangeType(exchange) {
    const ex = String(exchange || '').toUpperCase();
    return EXCH_TYPE_MAP[ex] || 1;
  }

  getIntervalMs(interval) {
    const iv = String(interval || '').toUpperCase();
    return INTERVAL_MS_MAP[iv] || 5 * 60 * 1000;
  }

  initSession(credentials) {
    // Legacy support placeholder
  }

  handleTick(userId, tick) {
    if (!tick || !tick.token || typeof tick.ltp !== 'number' || tick.ltp <= 0) return;

    const uid = String(userId || 'default');
    const token = String(tick.token);
    const userTokenKey = `${uid}_${token}`;
    this.ltpCache.set(userTokenKey, { ltp: tick.ltp, timestamp: tick.timestamp });

    if (!tick.isFallback) {
      this.wsConsecutiveTicks++;
      if (this.wsConsecutiveTicks >= 3 && this.isRestFallbackActive) {
        this.stopRestFallback();
      }
    }

    // Distribute tick to all matching candle builders for this user and token
    for (const [key, builder] of this.candleBuilders.entries()) {
      if (builder.userId === uid && builder.symboltoken === token) {
        this.processTickForBuilder(builder, tick);
      }
    }
  }

  processTickForBuilder(builder, tick) {
    const intervalMs = this.getIntervalMs(builder.interval);
    const ts = tick.timestamp;

    if (builder.lastProcessedTs && ts < builder.lastProcessedTs) {
      return; // Discard out of order ticks
    }
    builder.lastProcessedTs = ts;

    const candleStartMs = Math.floor(ts / intervalMs) * intervalMs;
    const candleTimeSec = Math.floor(candleStartMs / 1000);

    if (!builder.activeCandle) {
      builder.activeCandle = {
        time: candleTimeSec,
        open: tick.ltp,
        high: tick.ltp,
        low: tick.ltp,
        close: tick.ltp,
        candleStartMs
      };
      return;
    }

    if (candleStartMs === builder.activeCandle.candleStartMs) {
      builder.activeCandle.high = Math.max(builder.activeCandle.high, tick.ltp);
      builder.activeCandle.low = Math.min(builder.activeCandle.low, tick.ltp);
      builder.activeCandle.close = tick.ltp;
    } else if (candleStartMs > builder.activeCandle.candleStartMs) {
      const closedCandle = { ...builder.activeCandle };
      delete closedCandle.candleStartMs;
      builder.candles.push(closedCandle);
      if (builder.candles.length > 200) builder.candles.shift();

      this.emit('candle:closed', {
        userId: builder.userId,
        exchange: builder.exchange,
        symboltoken: builder.symboltoken,
        interval: builder.interval,
        candle: closedCandle,
        candles: builder.candles
      });

      // Fill-forward missing gap candles if any
      let gapMs = candleStartMs - builder.activeCandle.candleStartMs;
      while (gapMs > intervalMs) {
        const ghostStartMs = builder.activeCandle.candleStartMs + intervalMs;
        const ghostCandle = {
          time: Math.floor(ghostStartMs / 1000),
          open: closedCandle.close,
          high: closedCandle.close,
          low: closedCandle.close,
          close: closedCandle.close
        };
        builder.candles.push(ghostCandle);
        if (builder.candles.length > 200) builder.candles.shift();

        this.emit('candle:closed', {
          userId: builder.userId,
          exchange: builder.exchange,
          symboltoken: builder.symboltoken,
          interval: builder.interval,
          candle: ghostCandle,
          candles: builder.candles
        });

        builder.activeCandle.candleStartMs = ghostStartMs;
        gapMs -= intervalMs;
      }

      // Initialize new active candle
      builder.activeCandle = {
        time: candleTimeSec,
        open: tick.ltp,
        high: tick.ltp,
        low: tick.ltp,
        close: tick.ltp,
        candleStartMs
      };
    }
  }

  async pollRestLtpFallback() {
    if (this.subscribers.size === 0) return;

    const fetchPromises = Array.from(this.subscribers.entries()).map(([userTokenKey, sub]) => {
      const parts = userTokenKey.split('_');
      const uid = parts[0];
      const token = parts[1];
      if (!uid || !token) return Promise.resolve();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const internalSecret = process.env.ANGEL_ONE_INTERNAL_SECRET || '';
      const url = `${ANGEL_API_BASE}/market/ltp?exchange=${encodeURIComponent(sub.exchange)}&tradingsymbol=&symboltoken=${encodeURIComponent(token)}`;
      
      return fetch(url, { 
        signal: controller.signal,
        headers: {
          'X-Internal-Token': internalSecret,
          'X-User-Id': uid
        }
      })
        .then(async (res) => {
          clearTimeout(timeoutId);
          if (res.status === 401) {
            const strategyEngine = require('./strategyEngine');
            if (strategyEngine && typeof strategyEngine.handleSessionExpiry === 'function') {
              strategyEngine.handleSessionExpiry(uid).catch(() => {});
            }
          }
          if (res.ok) {
            const json = await res.json();
            if (json && json.ltp > 0) {
              this.handleTick(uid, {
                token,
                exchangeType: sub.exchangeType,
                ltp: json.ltp,
                timestamp: Date.now(),
                isFallback: true
              });
            }
          }
        })
        .catch(() => {
          clearTimeout(timeoutId);
        });
    });

    await Promise.allSettled(fetchPromises);
  }

  async subscribe(userIdOrExchange, exchangeOrSymbol, symbolOrInterval, intervalOrLookback, lookbackMinutes) {
    let userId = 'default';
    let exchange, symboltoken, interval, lookback;

    // Detect legacy calls that omit userId
    const isLegacy = typeof userIdOrExchange === 'string' &&
      (['NSE', 'NFO', 'BSE', 'BFO', 'MCX'].includes(userIdOrExchange.toUpperCase()) || userIdOrExchange.length < 5);

    if (isLegacy) {
      exchange = userIdOrExchange;
      symboltoken = exchangeOrSymbol;
      interval = symbolOrInterval || 'FIVE_MINUTE';
      lookback = intervalOrLookback || null;
    } else {
      userId = userIdOrExchange || 'default';
      exchange = exchangeOrSymbol;
      symboltoken = symbolOrInterval;
      interval = intervalOrLookback || 'FIVE_MINUTE';
      lookback = lookbackMinutes || null;
    }

    const uid = String(userId);
    const token = String(symboltoken);
    const exchType = this.getExchangeType(exchange);
    
    const userTokenKey = `${uid}_${token}`;
    const key = this.getBufferKey(uid, exchange, token, interval);

    // Reference Counting
    let sub = this.subscribers.get(userTokenKey);
    if (!sub) {
      sub = { exchange, exchangeType: exchType, refCount: 0 };
      this.subscribers.set(userTokenKey, sub);
    }
    sub.refCount++;

    if (sub.refCount === 1) {
      smartStream.subscribe(uid, [{ exchangeType: exchType, tokens: [token] }]);
    }

    // Builder Setup
    let builder = this.candleBuilders.get(key);
    if (!builder) {
      builder = {
        key,
        userId: uid,
        exchange,
        symboltoken: token,
        interval,
        candles: [],
        activeCandle: null,
        lastProcessedTs: 0
      };
      this.candleBuilders.set(key, builder);

      // Backfill historical candles via REST
      try {
        const targetDate = new Date().toISOString().split('T')[0];
        const url = `${ANGEL_API_BASE}/market/candles?exchange=${encodeURIComponent(exchange)}&symboltoken=${encodeURIComponent(token)}&interval=${encodeURIComponent(interval)}&date=${targetDate}`;
        const internalSecret = process.env.ANGEL_ONE_INTERNAL_SECRET || '';
        const res = await fetch(url, {
          headers: {
            'X-Internal-Token': internalSecret,
            'X-User-Id': uid
          }
        });
        if (res.status === 401) {
          const strategyEngine = require('./strategyEngine');
          if (strategyEngine && typeof strategyEngine.handleSessionExpiry === 'function') {
            strategyEngine.handleSessionExpiry(uid).catch(() => {});
          }
        }
        if (res.ok) {
          const json = await res.json();
          if (Array.isArray(json.items)) {
            const parsed = json.items.map(c => ({
              time: Math.floor(new Date(c.ts.includes('+') ? c.ts : `${c.ts.replace(' ', 'T')}+05:30`).getTime() / 1000),
              open: Number(c.open),
              high: Number(c.high),
              low: Number(c.low),
              close: Number(c.close)
            })).sort((a, b) => a.time - b.time);
            builder.candles = parsed;
          }
        }
      } catch (err) {
        console.warn(`[MarketDataService] Seeding historical candles failed for ${key}:`, err.message);
      }
    }

    return builder.candles;
  }

  unsubscribe(userIdOrExchange, exchangeOrSymbol, symbolOrInterval, interval) {
    let userId = 'default';
    let exchange, symboltoken, intv;

    const isLegacy = typeof userIdOrExchange === 'string' &&
      (['NSE', 'NFO', 'BSE', 'BFO', 'MCX'].includes(userIdOrExchange.toUpperCase()) || userIdOrExchange.length < 5);

    if (isLegacy) {
      exchange = userIdOrExchange;
      symboltoken = exchangeOrSymbol;
      intv = symbolOrInterval || 'FIVE_MINUTE';
    } else {
      userId = userIdOrExchange || 'default';
      exchange = exchangeOrSymbol;
      symboltoken = symbolOrInterval;
      intv = interval || 'FIVE_MINUTE';
    }

    const uid = String(userId);
    const token = String(symboltoken);
    const userTokenKey = `${uid}_${token}`;
    const key = this.getBufferKey(uid, exchange, token, intv);

    this.candleBuilders.delete(key);

    const sub = this.subscribers.get(userTokenKey);
    if (sub) {
      sub.refCount--;
      if (sub.refCount <= 0) {
        smartStream.unsubscribe(uid, [{ exchangeType: sub.exchangeType, tokens: [token] }]);
        this.subscribers.delete(userTokenKey);
        this.ltpCache.delete(userTokenKey);
      }
    }
  }

  getLtp(userIdOrExchange, exchangeOrSymbol, symboltoken) {
    let userId = 'default';
    let token;

    if (symboltoken !== undefined) {
      userId = userIdOrExchange;
      token = String(symboltoken);
    } else {
      token = String(exchangeOrSymbol);
    }

    const uid = String(userId || 'default');
    const userTokenKey = `${uid}_${token}`;
    const cached = this.ltpCache.get(userTokenKey);
    return cached ? cached.ltp : null;
  }

  getBuffer(userIdOrExchange, exchangeOrSymbol, symbolOrInterval, interval) {
    let userId = 'default';
    let exchange, token, intv;

    if (interval !== undefined) {
      userId = userIdOrExchange;
      exchange = exchangeOrSymbol;
      token = symbolOrInterval;
      intv = interval;
    } else {
      exchange = userIdOrExchange;
      token = exchangeOrSymbol;
      intv = symbolOrInterval;
    }

    const uid = String(userId || 'default');
    const key = this.getBufferKey(uid, exchange, token, intv);
    const builder = this.candleBuilders.get(key);
    return builder ? builder.candles : [];
  }
}

module.exports = new MarketDataService();
