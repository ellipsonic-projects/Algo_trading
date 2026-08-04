const mongoose = require('mongoose');

const tradeSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    strategyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Strategy',
        required: true
    },
    index: {
        type: String,
        required: true
    },
    premium: {
        type: String,
        required: true
    },
    qty: {
        type: Number,
        required: true
    },
    buyPrice: {
        type: Number,
        required: true
    },
    exitPrice: {
        type: Number
    },
    pnl: {
        type: Number
    },
    exitReason: {
        type: String,
        enum: ['Target', 'SL', 'Trailing SL', 'Strategy', 'HA_TREND_REVERSAL', 'Reversal', 'RECOVERY_CLEANUP', 'Manual']
    },
    orderId: {
        type: String
    },
    symbolToken: {
        type: String
    },
    exchange: {
        type: String
    }
}, { timestamps: true });

// Compound indexes to optimize query performance
tradeSchema.index({ userId: 1, createdAt: -1 });
tradeSchema.index({ userId: 1, strategyId: 1, exitPrice: 1 });
tradeSchema.index({ userId: 1, exitPrice: 1 });

module.exports = mongoose.model('Trade', tradeSchema);
