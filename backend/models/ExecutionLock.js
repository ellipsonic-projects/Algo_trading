const mongoose = require('mongoose');

const executionLockSchema = new mongoose.Schema({
    lockKey: {
        type: String,
        required: true,
        unique: true
    },
    ownerId: {
        type: String,
        required: true
    },
    acquiredAt: {
        type: Date,
        default: Date.now
    },
    expiresAt: {
        type: Date,
        required: true
    }
});

// TTL index for automatic expiration cleanup
executionLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('ExecutionLock', executionLockSchema);
