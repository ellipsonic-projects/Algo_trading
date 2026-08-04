const candleCache = require('./candleCache');

const ANGEL_API_URL = process.env.ANGEL_API_URL || 'http://localhost:8000';

const INDEX_SPOT_TOKENS = {
  SENSEX: { exchange: 'BSE', symboltoken: '99919000' },
  NIFTY: { exchange: 'NSE', symboltoken: '99926000' },
  BANKNIFTY: { exchange: 'NSE', symboltoken: '99926009' },
  FINNIFTY: { exchange: 'NSE', symboltoken: '99926037' },
};

const INTERVAL_MAP = {
  '1m': 'ONE_MINUTE',
  '5m': 'FIVE_MINUTE',
  '15m': 'FIFTEEN_MINUTE',
  '1h': 'ONE_HOUR',
  ONE_MINUTE: 'ONE_MINUTE',
  FIVE_MINUTE: 'FIVE_MINUTE',
  FIFTEEN_MINUTE: 'FIFTEEN_MINUTE',
  ONE_HOUR: 'ONE_HOUR',
};

// Build the required internal auth headers for every Python wrapper call.
// Python's require_internal_token dep returns 403 without X-Internal-Token.
// Python's require_user_id dep returns 400 without X-User-Id.
function buildInternalHeaders(userId) {
  return {
    'Content-Type': 'application/json',
    'X-Internal-Token': process.env.ANGEL_ONE_INTERNAL_SECRET || '',
    'X-User-Id': userId ? String(userId) : ''
  };
}

async function getCandles(underlying, date, interval = '5m', userId = null) {
  const und = (underlying || 'NIFTY').toUpperCase();
  const iv = INTERVAL_MAP[interval] || 'FIVE_MINUTE';
  const targetDate = date || new Date().toISOString().split('T')[0];
  const uid = userId ? String(userId) : 'default';

  // 1. Check Cache
  const cached = candleCache.get(und, targetDate, interval);
  if (cached && cached.length > 0) {
    console.log(`[candleService] Returning ${cached.length} cached candles for ${und} (${targetDate}, ${interval})`);
    return cached;
  }

  // 2. Resolve token
  const info = INDEX_SPOT_TOKENS[und] || INDEX_SPOT_TOKENS.NIFTY;

  // 3. Fetch from Python Angel One wrapper with required auth headers
  let rawItems = [];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const url = `${ANGEL_API_URL}/market/candles?exchange=${info.exchange}&symboltoken=${info.symboltoken}&interval=${iv}&date=${targetDate}`;

    console.log(`[candleService] Fetching candles for ${und} (Token: ${info.symboltoken}) date: ${targetDate} interval: ${iv} userId: ${uid}`);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: buildInternalHeaders(uid)
    });
    clearTimeout(timer);

    if (res.ok) {
      const json = await res.json();
      rawItems = Array.isArray(json.items) ? json.items : [];
    } else {
      console.warn(`[candleService] Angel wrapper returned HTTP ${res.status} for ${und}`);
    }
  } catch (err) {
    console.warn(`[candleService] Warning fetching candles for ${und}:`, err.message);
  }

  // 4. Format candles to TradingView Lightweight-Charts standard: { time (unix sec), open, high, low, close }
  const formatted = rawItems
    .map((c) => {
      let ts = c.ts;
      let unixSec = 0;
      if (typeof ts === 'string') {
        const parseable = ts.includes('+') || ts.includes('Z') ? ts : `${ts.replace(' ', 'T')}+05:30`;
        const dateObj = new Date(parseable);
        unixSec = Math.floor(dateObj.getTime() / 1000);
      } else if (typeof ts === 'number') {
        unixSec = ts > 1e10 ? Math.floor(ts / 1000) : ts;
      }
      return {
        time: unixSec,
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
      };
    })
    .filter((c) => !isNaN(c.time) && c.time > 0)
    .sort((a, b) => a.time - b.time);

  // Log summary
  console.log(`[candleService] Index: ${und} | Token: ${info.symboltoken} | Date: ${targetDate} | Candles Fetched: ${formatted.length}`);
  if (formatted.length > 0) {
    console.log(`[candleService] First Candle:`, formatted[0]);
    console.log(`[candleService] Last Candle:`, formatted[formatted.length - 1]);
  }

  // 5. Store in cache if candles exist
  if (formatted.length > 0) {
    const isToday = targetDate === new Date().toISOString().split('T')[0];
    const ttl = isToday ? 5 * 60 * 1000 : 24 * 60 * 60 * 1000;
    candleCache.set(und, targetDate, interval, formatted, ttl);
  }

  return formatted;
}

module.exports = {
  getCandles,
  INDEX_SPOT_TOKENS,
};
