const mongoose = require('mongoose');

const strategySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, { timestamps: true });

// Compound index to optimize user-scoped strategy lookup by name
strategySchema.index({ userId: 1, name: 1 });

module.exports = mongoose.model('Strategy', strategySchema);
