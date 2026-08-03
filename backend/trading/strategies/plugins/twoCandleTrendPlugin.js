const BaseStrategy = require("../BaseStrategy");

class TwoCandleTrendPlugin extends BaseStrategy {

    static manifest = {
        id: "TwoCandleTrend",
        name: "Two Candle Trend Strategy",
        engineVersion: "1.0.0",

        requires: {
            timeframe: "FIVE_MINUTE",
            lookbackCandles: 2,
            dataStreams: ["CE_CANDLES", "PE_CANDLES"]
        },

        parameters: {
            quantity: {
                type: "number",
                label: "Quantity",
                default: 1,
                min: 1
            }
        }
    };

    analyze(context) {

        const items = context.items;

        if (!items || items.length < 2) {
            return {
                signal: "NONE",
                isEntry: false,
                failedReasons: ["Not enough candles"]
            };
        }

        const last = items[items.length - 1];
        const prev = items[items.length - 2];

        const lastGreen = last.close > last.open;
        const prevGreen = prev.close > prev.open;

        const lastRed = last.close < last.open;
        const prevRed = prev.close < prev.open;

        if (lastGreen && prevGreen) {

            return {
                signal: "BUY_CE",
                isEntry: true,
                trend: "BULLISH",
                diagnostics: {
                    lastGreen,
                    prevGreen
                }
            };
        }

        if (lastRed && prevRed) {

            return {
                signal: "BUY_PE",
                isEntry: true,
                trend: "BEARISH",
                diagnostics: {
                    lastRed,
                    prevRed
                }
            };
        }

        return {
            signal: "NONE",
            isEntry: false,
            trend: "NEUTRAL",
            failedReasons: [
                "Last two candles are not the same colour"
            ]
        };
    }

    shouldExit() {
        return false;
    }

}

module.exports = TwoCandleTrendPlugin;