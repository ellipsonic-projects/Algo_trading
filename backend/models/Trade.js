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
    status: {
        type: String,
        enum: ['ENTRY_PENDING', 'IN_POSITION', 'EXIT_PENDING', 'CLOSED', 'REJECTED', 'CANCELLED'],
        default: 'ENTRY_PENDING'
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
    charges: {
        type: Number,
        default: 0
    },
    chargesBreakdown: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    chargesVersion: {
        type: String
    },
    exitReason: {
        type: String,
        enum: ['Target', 'SL', 'Trailing SL', 'Strategy', 'HA_TREND_REVERSAL', 'Reversal', 'RECOVERY_CLEANUP', 'Manual', 'RiskKillSwitch', 'TimeoutReconciled']
    },
    orderId: {
        type: String
    },
    exitOrderId: {
        type: String
    },
    symbolToken: {
        type: String
    },
    exchange: {
        type: String
    },
    reconciled: {
        type: Boolean,
        default: false
    }
}, { timestamps: true });

// Compound indexes to optimize query performance and multi-tenant isolation
tradeSchema.index({ userId: 1, createdAt: -1 });
tradeSchema.index({ userId: 1, strategyId: 1, status: 1 });
tradeSchema.index({ userId: 1, status: 1 });
tradeSchema.index({ userId: 1, exitPrice: 1 });

module.exports = mongoose.model('Trade', tradeSchema);
