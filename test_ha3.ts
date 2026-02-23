import { analyzeHeikenAshiStrategy } from './algo-trading/src/trading/strategies/heikenAshi'

const haCandles = [
    ...Array(20).fill(0).map((_, i) => ({
        ts: i.toString(),
        open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, isGreen: true
    })),
    { ts: '20', open: 120, high: 125, low: 119.98, close: 124, isGreen: true }, // tiny wick of 0.02
    { ts: '21', open: 122, high: 130, low: 122, close: 128, isGreen: true } // perfect no wick
]

const signal = analyzeHeikenAshiStrategy(haCandles)
console.log(signal)
console.log("Wick 1:", haCandles[20].open - haCandles[20].low)
console.log("Wick 2:", haCandles[21].open - haCandles[21].low)
