const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../models/User');
const Strategy = require('../models/Strategy');

dotenv.config();

const seed = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('DB connection successful for seeding!');

        // 1. Clear existing data
        await User.deleteMany();
        await Strategy.deleteMany();

        // 2. Create User
        const user = await User.create({
            email: 'mithun@gmail.com',
            password: 'mithun@1234'
        });
        console.log('User created:', user.email);

        // 3. Create Strategies
        const s1 = await Strategy.create({
            name: 'HeikenAshi',
            userId: user._id
        });
        const s2 = await Strategy.create({
            name: '5minBreakout',
            userId: user._id
        });
        const s3 = await Strategy.create({
            name: 'ModifiedHeikenAshi',
            userId: user._id
        });
        console.log('Strategies created:', s1.name, s2.name, s3.name);

        console.log('Seeding completed successfully!');
        process.exit();
    } catch (err) {
        console.error('Seeding error:', err);
        process.exit(1);
    }
};

seed();
