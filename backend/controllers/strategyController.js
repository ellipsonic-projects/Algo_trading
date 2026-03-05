const Strategy = require('../models/Strategy');

exports.getStrategyCount = async (req, res) => {
    try {
        const count = await Strategy.countDocuments({ userId: req.user._id });
        res.status(200).json({
            status: 'success',
            data: {
                count
            }
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
};

exports.getAllStrategies = async (req, res) => {
    try {
        const strategies = await Strategy.find({ userId: req.user._id }).select('_id name');
        res.status(200).json({
            status: 'success',
            data: {
                strategies
            }
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
};
