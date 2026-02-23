import { computeEMA, computeJMA, computeHeikenAshi, analyzeHeikenAshiStrategy } from './algo-trading/src/trading/strategies/heikenAshi'

const rawCandles = [];
let price = 100;
for (let i = 0; i < 50; i++) {
    const raw = {
        ts: i.toString(),
        open: price,
        close: price + 2,
        high: price + 3,
        low: price - 1,
        v: 100
    };
    rawCandles.push(raw);
    price += 2; // steady uptrend
}
// Last 2 candles, strong trend with open=low
for (let i = 0; i < 2; i++) {
    const raw = {
        ts: (50 + i).toString(),
        open: price,
        close: price + 5,
        high: price + 5,
        low: price, // no lower wick!
        v: 100
    };
    rawCandles.push(raw);
    price += 5;
}

const ha = computeHeikenAshi(rawCandles);
const last = ha[ha.length - 1];
const prev = ha[ha.length - 2];

const emas = computeEMA(ha.map(h => h.close), 20);
const jmas = computeJMA(ha.map(h => h.close), 7);

const lastEma = emas[emas.length - 1];
const lastJma = jmas[jmas.length - 1];

console.log("Last HA:", last);
console.log("Prev HA:", prev);
console.log("Last EMA 20:", lastEma);
console.log("Last JMA 7:", lastJma);
console.log("JMA > EMA?", lastJma > lastEma);
console.log("Close > JMA?", last.close > lastJma);
console.log("Last Wick:", last.open - last.low);
console.log("Prev Wick:", prev.open - prev.low);

const signal = analyzeHeikenAshiStrategy(ha);
console.log("Signal:", signal);
