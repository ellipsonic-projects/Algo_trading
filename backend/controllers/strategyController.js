const Strategy = require('../models/Strategy');
const strategyEngine = require('../services/strategyEngine');

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

exports.startStrategy = async (req, res) => {
    try {
        const { strategyName } = req.params;
        const config = req.body || {};
        const status = await strategyEngine.startStrategy(req.user._id.toString(), strategyName, config);
        res.status(200).json({
            status: 'success',
            data: status
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
};

exports.stopStrategy = async (req, res) => {
    try {
        const { strategyName } = req.params;
        const status = strategyEngine.stopStrategy(req.user._id.toString(), strategyName);
        res.status(200).json({
            status: 'success',
            data: status
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
};

exports.getStrategyStatus = async (req, res) => {
    try {
        const { strategyName } = req.params;
        const status = strategyEngine.getStrategyStatus(req.user._id.toString(), strategyName);
        res.status(200).json({
            status: 'success',
            data: status
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
};

exports.exitStrategyPosition = async (req, res) => {
    try {
        const { strategyName } = req.params;
        const status = await strategyEngine.manualExitStrategy(req.user._id.toString(), strategyName);
        res.status(200).json({
            status: 'success',
            data: status
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
};
