const Strategy = require('../models/Strategy');
const strategyEngine = require('../services/strategyEngine');
const strategyStats = require('../services/strategyStats');

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

        // Validation
        const engineSchema = require('../services/engineSchema');
        const strategyRegistry = require('../services/strategyRegistry');
        const pluginClass = strategyRegistry.getPlugin(strategyName);
        if (!pluginClass) {
            return res.status(400).json({ status: 'error', message: `Strategy plugin '${strategyName}' is not registered.` });
        }
        const manifest = pluginClass.manifest || {};
        const manifestParams = manifest.parameters || {};
        const combinedSchema = { ...engineSchema, ...manifestParams };

        for (const [key, param] of Object.entries(combinedSchema)) {
            const val = config[key];
            if (val !== undefined && val !== null) {
                if (param.type === 'number' && typeof val !== 'number') {
                    return res.status(400).json({ status: 'error', message: `Parameter '${key}' must be a number.` });
                }
                if (param.type === 'boolean' && typeof val !== 'boolean') {
                    return res.status(400).json({ status: 'error', message: `Parameter '${key}' must be a boolean.` });
                }
                if (param.type === 'select' && param.options && !param.options.includes(val)) {
                    return res.status(400).json({ status: 'error', message: `Parameter '${key}' must be one of: ${param.options.join(', ')}` });
                }
                if (param.min !== undefined && val < param.min) {
                    return res.status(400).json({ status: 'error', message: `Parameter '${key}' must be at least ${param.min}.` });
                }
                if (param.max !== undefined && val > param.max) {
                    return res.status(400).json({ status: 'error', message: `Parameter '${key}' must be at most ${param.max}.` });
                }
            }
        }

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
        // Issue #9 FIX: stop() throws when the strategy has an open position.
        // Return 409 Conflict so the frontend knows to run a manual exit first.
        if (err.message && err.message.includes('Cannot stop strategy while a position is open')) {
            return res.status(409).json({ status: 'fail', message: err.message });
        }
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

/**
 * GET /api/v1/strategies/stats/report
 * Returns the live condition evaluation statistics collected since last reset.
 */
exports.getConditionReport = (req, res) => {
    try {
        const report = strategyStats.getReport();
        res.status(200).json({ status: 'success', data: report });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
};

/**
 * POST /api/v1/strategies/stats/reset
 * Clears all counters so data collection starts fresh.
 */
exports.resetConditionReport = (req, res) => {
    try {
        strategyStats.reset();
        res.status(200).json({ status: 'success', message: 'Statistics counters reset.' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
};

/**
 * GET /api/v1/strategies/manifests
 * Returns schemas of all registered strategy plugins.
 */
exports.getManifests = (req, res) => {
    try {
        const strategyRegistry = require('../services/strategyRegistry');
        const engineSchema = require('../services/engineSchema');
        const manifests = strategyRegistry.getManifests();
        res.status(200).json({ status: 'success', data: { manifests, engineSchema } });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
};
