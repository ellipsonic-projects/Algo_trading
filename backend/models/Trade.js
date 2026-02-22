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
        type: Number,
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
        enum: ['Target', 'SL', 'Strategy']
    }
}, { timestamps: true });

module.exports = mongoose.model('Trade', tradeSchema);
