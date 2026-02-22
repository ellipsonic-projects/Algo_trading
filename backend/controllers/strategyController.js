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
