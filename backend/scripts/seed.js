const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../models/User');
const Strategy = require('../models/Strategy');

dotenv.config();

const seed = async () => {
    // CRITICAL: Block execution in production environments
    if (process.env.NODE_ENV === 'production') {
        console.error('[SEED GUARD] Refusing to run destructive seed script in production environment!');
        process.exit(1);
    }

    try {
        if (!process.env.MONGO_URI) {
            throw new Error('MONGO_URI is not defined in environment variables');
        }

        await mongoose.connect(process.env.MONGO_URI);
        console.log('DB connection successful for seeding (Non-production mode)');

        const seedEmail = (process.env.SEED_USER_EMAIL || 'dev-test-trader@algo.local').toLowerCase();
        const seedPassword = process.env.SEED_USER_PASSWORD || 'DevTrader@2026!Secure';

        // Upsert seed user idempotently without wiping unrelated tenant data
        let user = await User.findOne({ email: seedEmail });
        if (!user) {
            user = await User.create({
                email: seedEmail,
                password: seedPassword,
                tokenVersion: 1
            });
            console.log('Seeded developer test account created:', user.email);
        } else {
            console.log('Developer test account already exists:', user.email);
        }

        // Upsert default strategies for this user
        const strategyNames = ['HeikenAshi', '5minBreakout', 'ModifiedHeikenAshi'];
        for (const name of strategyNames) {
            await Strategy.findOneAndUpdate(
                { name, userId: user._id },
                { name, userId: user._id },
                { upsert: true, new: true }
            );
        }
        console.log('Developer strategies verified/seeded for user:', user.email);

        console.log('Idempotent seeding completed safely!');
        process.exit(0);
    } catch (err) {
        console.error('Seeding error:', err.message);
        process.exit(1);
    }
};

seed();
