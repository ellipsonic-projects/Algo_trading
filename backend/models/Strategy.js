const mongoose = require('mongoose');

const strategySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    isActive: {
        type: Boolean,
        default: false
    },
    config: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    lastStartedAt: {
        type: Date
    },
    lastStoppedAt: {
        type: Date
    }
}, { timestamps: true });

// Compound unique index strictly scoped per tenant (prevents multi-user name collision)
strategySchema.index({ userId: 1, name: 1 }, { unique: true });
strategySchema.index({ isActive: 1 });
strategySchema.index({ userId: 1, isActive: 1 });

const Strategy = mongoose.model('Strategy', strategySchema);

// Safe background migration: drop legacy global name_1 index if present
if (mongoose.connection.readyState === 1) {
    Strategy.collection.dropIndex('name_1').catch(() => {});
} else {
    mongoose.connection.once('open', () => {
        Strategy.collection.dropIndex('name_1').catch(() => {});
    });
}

module.exports = Strategy;
