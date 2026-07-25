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

async function callAngelApi(endpoint, method = 'GET', body = null) {
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

class MarketDataService extends EventEmitter {
  constructor() {
    super();
    this.buffers = new Map(); // key -> { key, exchange, symboltoken, interval, candles, state, refCount, idleTimer, lastTsMs }
    this.probeInterval = null;
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
      if (bufEntry.state === 'LIVE') {
        return bufEntry.candles;
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
        lastTsMs: 0
      };
      this.buffers.set(key, bufEntry);
    }

    // Seed historical buffer
    try {
      const intervalMins = INTERVAL_MINUTES_MAP[interval] || 5;
      const targetLookback = lookbackMinutes || (config.ENGINE.BUFFER_SIZE * intervalMins);

      console.log(`[MarketDataService] Seeding buffer for ${key} (Lookback: ${targetLookback}m)...`);
      const res = await callAngelApi(`/market/candles?exchange=${encodeURIComponent(exchange)}&symboltoken=${encodeURIComponent(symboltoken)}&interval=${encodeURIComponent(interval)}&lookback_minutes=${targetLookback}`);
      
      const rawItems = Array.isArray(res.items) ? res.items : [];
      const sorted = [...rawItems].sort((a, b) => (parseCandleTsMs(a.ts) || 0) - (parseCandleTsMs(b.ts) || 0));
      
      const bounded = sorted.slice(-config.ENGINE.BUFFER_SIZE);
      bufEntry.candles = bounded;
      bufEntry.lastTsMs = bounded.length > 0 ? (parseCandleTsMs(bounded[bounded.length - 1].ts) || 0) : 0;
      bufEntry.state = 'LIVE';

      console.log(`[MarketDataService] Buffer ${key} SEEDED successfully with ${bounded.length} candles ending at ${bounded.length > 0 ? bounded[bounded.length - 1].ts : 'N/A'}`);
      
      this.ensureProbeLoopRunning();
      return bufEntry.candles;
    } catch (err) {
      console.error(`[MarketDataService] Error seeding buffer for ${key}:`, err.message);
      bufEntry.state = 'UNINITIALIZED';
      throw err;
    }
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
      if (!marketSessionManager.isMarketOpen()) return;

      const liveEntries = Array.from(this.buffers.values()).filter(b => b.state === 'LIVE' || b.state === 'IDLE');
      if (liveEntries.length === 0) return;

      for (const entry of liveEntries) {
        await this.probeSingleBuffer(entry);
      }
    };

    // Run probe loop every 5 seconds (or on adaptive candle boundaries)
    this.probeInterval = setInterval(probe, 5000);
    probe();
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
      const res = await callAngelApi(`/market/candles?exchange=${encodeURIComponent(entry.exchange)}&symboltoken=${encodeURIComponent(entry.symboltoken)}&interval=${encodeURIComponent(entry.interval)}&lookback_minutes=${intervalMins * 3}`);
      
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
}

module.exports = new MarketDataService();
