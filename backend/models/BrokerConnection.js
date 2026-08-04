const mongoose = require('mongoose');

const brokerConnectionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    brokerName: {
        type: String,
        required: true,
        default: 'angelone'
    },
    encryptedDek: {
        type: String,
        required: true
    },
    dekIv: {
        type: String,
        required: true
    },
    dekTag: {
        type: String,
        required: true
    },
    ciphertext: {
        type: String,
        required: true
    },
    iv: {
        type: String,
        required: true
    },
    tag: {
        type: String,
        required: true
    },
    keyVersion: {
        type: Number,
        required: true,
        default: 1
    },
    sessionStatus: {
        type: String,
        enum: ['DISCONNECTED', 'CONNECTED', 'REAUTH_REQUIRED', 'EXPIRED', 'ERROR'],
        default: 'DISCONNECTED'
    },
    lastLoginTime: {
        type: Date
    },
    sessionExpiryEstimate: {
        type: Date
    },
    lastRestHeartbeat: {
        type: Date
    },
    lastWsHeartbeat: {
        type: Date
    },
    lastAuthError: {
        type: String
    },
    invalidatedAt: {
        type: Date
    }
}, { timestamps: true });

// Prevent duplicate connections of the same broker type per user
brokerConnectionSchema.index({ userId: 1, brokerName: 1 }, { unique: true });

module.exports = mongoose.model('BrokerConnection', brokerConnectionSchema);
