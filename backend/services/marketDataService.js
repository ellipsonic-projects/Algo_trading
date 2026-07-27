const EventEmitter = require('events');
const config = require('../config');
const marketSessionManager = require('./marketSessionManager');

const ANGEL_API_BASE = config.API.ANGEL_ONE_API_BASE;

function formatPrecisionTime(d = new Date()) {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
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

const INTERVAL_MINUTES_MAP = {
  ONE_MINUTE: 1,
  THREE_MINUTE: 3,
  FIVE_MINUTE: 5,
  FIFTEEN_MINUTE: 15,
  THIRTY_MINUTE: 30,
  ONE_HOUR: 60
};

let lastApiCallMs = 0;
const MIN_REQUEST_SPACING_MS = 200;

async function callAngelApi(endpoint, method = 'GET', body = null) {
  const now = Date.now();
  const timeSinceLast = now - lastApiCallMs;
  if (timeSinceLast < MIN_REQUEST_SPACING_MS) {
    const waitMs = MIN_REQUEST_SPACING_MS - timeSinceLast;
    await new Promise(r => setTimeout(r, waitMs));
  }
  lastApiCallMs = Date.now();

  const url = `${ANGEL_API_BASE}${endpoint}`;
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body !== null) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Angel API Error [${res.status}]: ${text}`);
  }
  return await res.json();
}

async function callAngelApiWithRetry(endpoint, method = 'GET', body = null, maxRetries = 3, initialDelayMs = 1000) {
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      return await callAngelApi(endpoint, method, body);
    } catch (err) {
      if (attempt <= maxRetries) {
        const delay = initialDelayMs * Math.pow(2, attempt - 1);
        console.warn(`[MarketDataService] API request to ${endpoint} failed (attempt ${attempt}/${maxRetries}): ${err.message}. Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
}

class MarketDataService extends EventEmitter {
  constructor() {
    super();
    this.buffers = new Map(); // key -> { key, exchange, symboltoken, interval, candles, state, refCount, idleTimer, lastTsMs, seedingPromise }
    this.probeInterval = null;
    this.isProbing = false;
    global.mdsInstance = this;
  }

  getBufferKey(exchange, symboltoken, interval) {
    return `${exchange}_${symboltoken}_${interval}`;
  }

  async subscribe(exchange, symboltoken, interval = 'FIVE_MINUTE', lookbackMinutes = null) {
    const key = this.getBufferKey(exchange, symboltoken, interval);
    let bufEntry = this.buffers.get(key);

    if (bufEntry) {
      bufEntry.refCount++;
      if (bufEntry.idleTimer) {
        clearTimeout(bufEntry.idleTimer);
        bufEntry.idleTimer = null;
        bufEntry.state = 'LIVE';
        console.log(`[MarketDataService] Buffer ${key} resumed from IDLE to LIVE (refCount: ${bufEntry.refCount})`);
      }
      if (bufEntry.state === 'LIVE' && bufEntry.candles.length > 0) {
        return bufEntry.candles;
      }
      if (bufEntry.seedingPromise) {
        return await bufEntry.seedingPromise;
      }
      if (bufEntry.state === 'FAILED' && bufEntry.lastFailMs && (Date.now() - bufEntry.lastFailMs < 10000)) {
        throw new Error(`Buffer ${key} seeding in cooldown after recent failure`);
      }
    } else {
      bufEntry = {
        key,
        exchange,
        symboltoken,
        interval,
        candles: [],
        state: 'SEEDING',
        refCount: 1,
        idleTimer: null,
        lastTsMs: 0,
        seedingPromise: null,
        lastFailMs: 0
      };
      this.buffers.set(key, bufEntry);
    }

    // Seed historical buffer with deduplication and state protection
    const seedTask = async () => {
      try {
        bufEntry.state = 'SEEDING';
        const intervalMins = INTERVAL_MINUTES_MAP[interval] || 5;
        const targetLookback = lookbackMinutes || (config.ENGINE.BUFFER_SIZE * intervalMins);

        console.log(`[MarketDataService] Seeding buffer for ${key} (Lookback: ${targetLookback}m)...`);
        const res = await callAngelApiWithRetry(`/market/candles?exchange=${encodeURIComponent(exchange)}&symboltoken=${encodeURIComponent(symboltoken)}&interval=${encodeURIComponent(interval)}&lookback_minutes=${targetLookback}`);
        
        const rawItems = Array.isArray(res.items) ? res.items : [];
        const sorted = [...rawItems].sort((a, b) => (parseCandleTsMs(a.ts) || 0) - (parseCandleTsMs(b.ts) || 0));
        const bounded = sorted.slice(-config.ENGINE.BUFFER_SIZE);

        if (bounded.length === 0) {
          bufEntry.state = 'FAILED';
          bufEntry.lastFailMs = Date.now();
          bufEntry.candles = [];
          console.warn(`[MarketDataService] Buffer ${key} seeding FAILED: 0 candles returned (state: FAILED)`);
          throw new Error(`Buffer ${key} seeding returned 0 candles`);
        }

        bufEntry.candles = bounded;
        bufEntry.lastTsMs = parseCandleTsMs(bounded[bounded.length - 1].ts) || 0;
        bufEntry.state = 'LIVE';
        bufEntry.lastFailMs = 0;

        console.log(`[MarketDataService] Buffer ${key} SEEDED successfully with ${bounded.length} candles ending at ${bounded[bounded.length - 1].ts}`);
        
        this.ensureProbeLoopRunning();
        return bufEntry.candles;
      } catch (err) {
        bufEntry.state = 'FAILED';
        bufEntry.lastFailMs = Date.now();
        console.error(`[MarketDataService] Error seeding buffer for ${key}:`, err.message);
        throw err;
      } finally {
        bufEntry.seedingPromise = null;
      }
    };

    bufEntry.seedingPromise = seedTask();
    return await bufEntry.seedingPromise;
  }

  unsubscribe(exchange, symboltoken, interval = 'FIVE_MINUTE') {
    const key = this.getBufferKey(exchange, symboltoken, interval);
    const bufEntry = this.buffers.get(key);
    if (!bufEntry) return;

    bufEntry.refCount = Math.max(0, bufEntry.refCount - 1);
    console.log(`[MarketDataService] Unsubscribed ${key} (refCount: ${bufEntry.refCount})`);

    if (bufEntry.refCount === 0 && bufEntry.state === 'LIVE') {
      bufEntry.state = 'IDLE';
      console.log(`[MarketDataService] Buffer ${key} entered IDLE state (15-min TTL started)`);

      bufEntry.idleTimer = setTimeout(() => {
        if (bufEntry.refCount === 0) {
          bufEntry.state = 'DESTROYED';
          this.buffers.delete(key);
          console.log(`[MarketDataService] Buffer ${key} DESTROYED and purged from memory`);
          this.checkStopProbeLoop();
        }
      }, config.ENGINE.IDLE_TIMEOUT_MS);
    }
  }

  ensureProbeLoopRunning() {
    if (this.probeInterval) return;

    const probe = async () => {
      if (this.isProbing) {
        // Skip tick if previous probe cycle or backoff retry sequence is still executing
        return;
      }

      this.isProbing = true;
      try {
        if (!marketSessionManager.isMarketOpen()) return;

        // Only probe active LIVE buffers. Skip IDLE, SEEDING, or FAILED buffers to avoid API limit waste.
        const liveEntries = Array.from(this.buffers.values()).filter(b => b.state === 'LIVE');
        if (liveEntries.length === 0) return;

        for (const entry of liveEntries) {
          await this.probeSingleBuffer(entry);
        }
      } finally {
        this.isProbing = false;
      }
    };

    // Fast 5-second polling for active trading buffers
    this.probeInterval = setInterval(probe, 5000);
  }

  checkStopProbeLoop() {
    const active = Array.from(this.buffers.values()).some(b => b.state === 'LIVE');
    if (!active && this.probeInterval) {
      clearInterval(this.probeInterval);
      this.probeInterval = null;
    }
  }

  async probeSingleBuffer(entry) {
    try {
      const intervalMins = INTERVAL_MINUTES_MAP[entry.interval] || 5;
      const res = await callAngelApiWithRetry(`/market/candles?exchange=${encodeURIComponent(entry.exchange)}&symboltoken=${encodeURIComponent(entry.symboltoken)}&interval=${encodeURIComponent(entry.interval)}&lookback_minutes=${intervalMins * 3}`, 'GET', null, 2, 500);
      
      const rawItems = Array.isArray(res.items) ? res.items : [];
      if (rawItems.length === 0) return;

      const sorted = [...rawItems].sort((a, b) => (parseCandleTsMs(a.ts) || 0) - (parseCandleTsMs(b.ts) || 0));
      const latest = sorted[sorted.length - 1];
      const latestMs = parseCandleTsMs(latest.ts);

      if (!latestMs) return;

      // Duplicate candle protection
      if (latestMs <= entry.lastTsMs) {
        return; // Already processed
      }

      // Gap detection
      const stepMs = intervalMins * 60 * 1000;
      if (entry.lastTsMs > 0 && latestMs > (entry.lastTsMs + stepMs + 1000)) {
        console.warn(`[MarketDataService] Gap detected on ${entry.key}! (Last: ${entry.lastTsMs}, New: ${latestMs}). Entering RECOVERING state...`);
        entry.state = 'RECOVERING';
        await this.subscribe(entry.exchange, entry.symboltoken, entry.interval);
        return;
      }

      // Append new closed candle
      entry.candles.push(latest);
      if (entry.candles.length > config.ENGINE.BUFFER_SIZE) {
        entry.candles.shift();
      }
      entry.lastTsMs = latestMs;

      const pubTs = formatPrecisionTime(new Date());
      console.log(`[MarketDataService] Candle closed for ${entry.key}: ${latest.ts} (Published at ${pubTs})`);

      this.emit('candle:closed', {
        key: entry.key,
        exchange: entry.exchange,
        symboltoken: entry.symboltoken,
        interval: entry.interval,
        candle: latest,
        candles: entry.candles,
        publishedTs: pubTs
      });
    } catch (err) {
      console.error(`[MarketDataService] Probe error for ${entry.key}:`, err.message);
    }
  }

  getBuffer(exchange, symboltoken, interval) {
    const key = this.getBufferKey(exchange, symboltoken, interval);
    const entry = this.buffers.get(key);
    return entry ? entry.candles : null;
  }

  getBufferState(exchange, symboltoken, interval) {
    const key = this.getBufferKey(exchange, symboltoken, interval);
    const entry = this.buffers.get(key);
    return {
      state: entry ? entry.state : 'UNINITIALIZED',
      count: entry && entry.candles ? entry.candles.length : 0,
      candles: entry ? entry.candles : []
    };
  }
}

module.exports = new MarketDataService();
