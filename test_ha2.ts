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
    price += 2;
}

// Emulate a tiny wick due to float math or slight tick movement.
rawCandles.push({
    ts: '50',
    open: price,
    close: price + 5,
    high: price + 5,
    low: price - 0.05, // very small wick on raw
    v: 100
});
price += 5;

rawCandles.push({
    ts: '51',
    open: price,
    close: price + 5,
    high: price + 5,
    low: price - 0.01, // extremely small wick on raw
    v: 100
});

const ha = computeHeikenAshi(rawCandles);
const last = ha[ha.length - 1];
const prev = ha[ha.length - 2];

console.log("Last HA:", last);
console.log("Prev HA:", prev);
console.log("Last HA Wick Open-Low:", last.open - last.low);
console.log("Prev HA Wick Open-Low:", prev.open - prev.low);
console.log("Is Last < 1e-6?", Math.abs(last.open - last.low) < 1e-6);
console.log("Is Prev < 1e-6?", Math.abs(prev.open - prev.low) < 1e-6);

const signal = analyzeHeikenAshiStrategy(ha);
console.log("Signal:", signal);
