/**
 * riskService.js
 * 
 * Server-Side Financial Safety & Risk Management Engine.
 * Enforces pre-trade risk validation rules before submitting orders to the broker.
 */

const Trade = require('../models/Trade');
const marketSessionManager = require('./marketSessionManager');

const MAX_ORDER_QUANTITY = {
    SENSEX: 500,
    NIFTY: 1800,
    BANKNIFTY: 900,
    FINNIFTY: 1800,
    CRUDEOILM: 50,
    DEFAULT: 1000
};

const DEFAULT_MAX_DAILY_LOSS = 50000; // Rs. 50,000 max daily loss per user

class RiskService {
    /**
     * Pre-trade validation gate. Throws an error if any safety condition is violated.
     * 
     * @param {Object} params
     * @param {string} params.userId - User ID
     * @param {string} params.strategyId - Strategy document ObjectId string
     * @param {string} params.strategyName - Name of strategy
     * @param {string} params.underlying - Index / underlying symbol
     * @param {number} params.quantity - Number of units requested
     * @param {boolean} params.isLive - Whether order is destined for live broker
     * @param {Object} params.config - Strategy user configuration (custom risk thresholds)
     */
    async validateEntry({ userId, strategyId, strategyName, underlying = 'SENSEX', quantity, isLive = false, config = {} }) {
        if (!userId) {
            throw new Error('[Risk Engine] Validation failed: userId is required.');
        }

        const qty = Number(quantity);
        if (!Number.isFinite(qty) || qty <= 0) {
            throw new Error(`[Risk Engine] Invalid order quantity: ${quantity}. Must be a positive integer.`);
        }

        // 1. Quantity & Position Size Limit
        const maxAllowedQty = config.maxQuantity || MAX_ORDER_QUANTITY[underlying] || MAX_ORDER_QUANTITY.DEFAULT;
        if (qty > maxAllowedQty) {
            throw new Error(`[Risk Engine] Order quantity ${qty} exceeds maximum allowed limit of ${maxAllowedQty} for ${underlying}.`);
        }

        // 2. Trading Session / Market Hours Check (Strict in live trading)
        if (isLive) {
            const isMarketOpen = marketSessionManager.isMarketOpen();
            if (!isMarketOpen) {
                throw new Error('[Risk Engine] Order rejected: Market is currently closed for live trading.');
            }
        }

        // 3. Prevent Concurrent Duplicate Open Position for the Same Strategy
        if (strategyId) {
            const openTrade = await Trade.findOne({
                userId,
                strategyId,
                status: { $in: ['ENTRY_PENDING', 'IN_POSITION', 'EXIT_PENDING'] }
            });

            if (openTrade) {
                throw new Error(`[Risk Engine] Duplicate entry blocked: Strategy '${strategyName}' already has an active trade in state '${openTrade.status}'.`);
            }
        }

        // 4. Daily Drawdown / Max Daily Loss Kill-Switch
        const maxDailyLoss = Number(config.maxDailyLoss) || DEFAULT_MAX_DAILY_LOSS;
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const dailyStats = await Trade.aggregate([
            {
                $match: {
                    userId: typeof userId === 'string' ? new (require('mongoose').Types.ObjectId)(userId) : userId,
                    createdAt: { $gte: todayStart },
                    pnl: { $exists: true }
                }
            },
            {
                $group: {
                    _id: null,
                    totalPnl: { $sum: '$pnl' }
                }
            }
        ]);

        const todayPnl = dailyStats.length > 0 ? dailyStats[0].totalPnl : 0;
        if (todayPnl <= -maxDailyLoss) {
            throw new Error(`[Risk Engine] Daily loss limit breached: Today's realized loss (₹${Math.abs(todayPnl).toFixed(2)}) exceeds max threshold of ₹${maxDailyLoss}. Trading halted.`);
        }

        return { valid: true };
    }
}

module.exports = new RiskService();
