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
    this.ltpCache = new Map(); // token -> { ltp, timestamp }
    this.subscribers = new Map(); // token -> { exchange, exchangeType, refCount }
    this.candleBuilders = new Map(); // bufferKey -> builder object

    this.wsConsecutiveTicks = 0;
    this.fallbackTimer = null;
    this.fallbackPollingInterval = null;
    this.isRestFallbackActive = false;

    smartStream.on('tick', (tick) => this.handleTick(tick));
    smartStream.on('disconnected', () => this.handleStreamDisconnect());
    smartStream.on('connected', () => this.handleStreamConnect());
  }

  getBufferKey(exchange, symboltoken, interval) {
    return `${exchange}_${symboltoken}_${interval}`;
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
    if (credentials) {
      if (!smartStream.isConnected && !smartStream.isConnecting) {
        smartStream.connect(credentials);
      }
      if (credentials.jwtToken && !orderUpdateService.isConnected && !orderUpdateService.isConnecting) {
        orderUpdateService.connect(credentials.jwtToken);
      }
    }
  }

  handleStreamConnect() {
    console.log('[MarketDataService] Smart Stream connected. Monitoring consecutive ticks...');
    this.wsConsecutiveTicks = 0;
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }

  handleStreamDisconnect() {
    console.warn('[MarketDataService] Smart Stream disconnected. Starting 10s timeout for REST fallback...');
    this.wsConsecutiveTicks = 0;
    if (!this.fallbackTimer) {
      this.fallbackTimer = setTimeout(() => {
        this.startRestFallback();
      }, 10000);
    }
  }

  startRestFallback() {
    if (this.isRestFallbackActive) return;
    console.warn('[MarketDataService] 10s WebSocket disconnect timeout reached. Enabling REST Fallback Polling (2s interval)...');
    this.isRestFallbackActive = true;

    if (this.fallbackPollingInterval) clearInterval(this.fallbackPollingInterval);
    this.fallbackPollingInterval = setInterval(() => {
      this.pollRestLtpFallback();
    }, 2000);
  }

  stopRestFallback() {
    if (!this.isRestFallbackActive) return;
    console.log('[MarketDataService] WebSocket feed restored with 3 consecutive ticks. Disabling REST Fallback Polling.');
    this.isRestFallbackActive = false;
    if (this.fallbackPollingInterval) {
      clearInterval(this.fallbackPollingInterval);
      this.fallbackPollingInterval = null;
    }
  }

  async pollRestLtpFallback() {
    if (this.subscribers.size === 0) return;

    for (const [token, sub] of this.subscribers.entries()) {
      try {
        const url = `${ANGEL_API_BASE}/market/ltp?exchange=${encodeURIComponent(sub.exchange)}&tradingsymbol=&symboltoken=${encodeURIComponent(token)}`;
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          if (json && json.ltp > 0) {
            this.handleTick({
              token,
              exchangeType: sub.exchangeType,
              ltp: json.ltp,
              timestamp: Date.now(),
              isFallback: true
            });
          }
        }
      } catch (err) {
        // Suppress fallback error output
      }
    }
  }

  handleTick(tick) {
    if (!tick || !tick.token || typeof tick.ltp !== 'number' || tick.ltp <= 0) return;

    const token = String(tick.token);
    this.ltpCache.set(token, { ltp: tick.ltp, timestamp: tick.timestamp });

    if (!tick.isFallback) {
      this.wsConsecutiveTicks++;
      if (this.wsConsecutiveTicks >= 3 && this.isRestFallbackActive) {
        this.stopRestFallback();
      }
    }

    // Distribute tick to all matching candle builders for this token
    for (const [key, builder] of this.candleBuilders.entries()) {
      if (builder.symboltoken === token) {
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
      // Close current active candle
      const closedCandle = { ...builder.activeCandle };
      delete closedCandle.candleStartMs;
      builder.candles.push(closedCandle);
      if (builder.candles.length > 200) builder.candles.shift();

      this.emit('candle:closed', {
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

  async autoInitSession() {
    if ((smartStream.isConnected || smartStream.isConnecting) && (orderUpdateService.isConnected || orderUpdateService.isConnecting)) return;
    try {
      const res = await fetch(`${ANGEL_API_BASE}/angel/session-tokens`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.status && data.client_code && data.feed_token) {
          this.initSession({
            clientCode: data.client_code,
            feedToken: data.feed_token,
            jwtToken: data.jwt_token,
            apiKey: data.api_key
          });
        }
      }
    } catch (e) {
      // Session fetch error
    }
  }

  async subscribe(exchange, symboltoken, interval = 'FIVE_MINUTE', lookbackMinutes = null) {
    await this.autoInitSession();

    const token = String(symboltoken);
    const exchType = this.getExchangeType(exchange);
    const key = this.getBufferKey(exchange, token, interval);

    // Reference Counting
    let sub = this.subscribers.get(token);
    if (!sub) {
      sub = { exchange, exchangeType: exchType, refCount: 0 };
      this.subscribers.set(token, sub);
    }
    sub.refCount++;

    if (sub.refCount === 1) {
      smartStream.subscribe([{ exchangeType: exchType, tokens: [token] }]);
    }

    // Builder Setup
    let builder = this.candleBuilders.get(key);
    if (!builder) {
      builder = {
        key,
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
        const res = await fetch(url);
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

  unsubscribe(exchange, symboltoken, interval = 'FIVE_MINUTE') {
    const token = String(symboltoken);
    const key = this.getBufferKey(exchange, token, interval);

    this.candleBuilders.delete(key);

    const sub = this.subscribers.get(token);
    if (sub) {
      sub.refCount--;
      if (sub.refCount <= 0) {
        smartStream.unsubscribe([{ exchangeType: sub.exchangeType, tokens: [token] }]);
        this.subscribers.delete(token);
        this.ltpCache.delete(token);
      }
    }
  }

  getLtp(exchange, symboltoken) {
    const token = String(symboltoken);
    const cached = this.ltpCache.get(token);
    return cached ? cached.ltp : null;
  }

  getBuffer(exchange, symboltoken, interval) {
    const key = this.getBufferKey(exchange, symboltoken, interval);
    const builder = this.candleBuilders.get(key);
    return builder ? builder.candles : [];
  }
}

module.exports = new MarketDataService();
