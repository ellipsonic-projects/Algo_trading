const Trade = require('../models/Trade');
const Strategy = require('../models/Strategy');

exports.recordTrade = async (req, res) => {
    try {
        const { strategyName, index, premium, qty, buyPrice } = req.body;

        // 1. Find strategy
        const strategy = await Strategy.findOne({ name: strategyName });
        if (!strategy) {
            return res.status(404).json({ status: 'fail', message: 'Strategy not found' });
        }

        // 2. Create trade log
        const trade = await Trade.create({
            userId: req.user._id,
            strategyId: strategy._id,
            index,
            premium,
            qty,
            buyPrice
        });

        res.status(201).json({
            status: 'success',
            data: {
                trade
            }
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
};

exports.updateTradeExit = async (req, res) => {
    try {
        const { tradeId, exitPrice, exitReason } = req.body;

        const trade = await Trade.findById(tradeId);
        if (!trade) {
            return res.status(404).json({ status: 'fail', message: 'Trade not found' });
        }

        // Calculate PNL
        const pnl = (exitPrice - trade.buyPrice) * trade.qty;

        trade.exitPrice = exitPrice;
        trade.exitReason = exitReason;
        trade.pnl = pnl;

        await trade.save();

        res.status(200).json({
            status: 'success',
            data: {
                trade
            }
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
};

exports.getLatestOpenTrade = async (req, res) => {
    try {
        const { strategyName } = req.query;
        const strategy = await Strategy.findOne({ name: strategyName });

        if (!strategy) {
            return res.status(404).json({ status: 'fail', message: 'Strategy not found' });
        }

        const trade = await Trade.findOne({
            userId: req.user._id,
            strategyId: strategy._id,
            exitPrice: { $exists: false }
        }).sort({ createdAt: -1 });

        res.status(200).json({
            status: 'success',
            data: {
                trade
            }
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
};
exports.getStats = async (req, res) => {
    try {
        const stats = await Trade.aggregate([
            { $match: { userId: req.user._id, pnl: { $exists: true } } },
            {
                $group: {
                    _id: null,
                    totalPnl: { $sum: '$pnl' },
                    totalTrades: { $sum: 1 },
                    winningTrades: {
                        $sum: { $cond: [{ $gt: ['$pnl', 0] }, 1, 0] }
                    }
                }
            }
        ]);

        const data = stats.length > 0 ? stats[0] : { totalPnl: 0, totalTrades: 0, winningTrades: 0 };
        const winRate = data.totalTrades > 0 ? (data.winningTrades / data.totalTrades) * 100 : 0;

        res.status(200).json({
            status: 'success',
            data: {
                totalPnl: data.totalPnl,
                totalTrades: data.totalTrades,
                winRate: Math.round(winRate)
            }
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
};
exports.getAllTrades = async (req, res) => {
    try {
        const { strategyId, startDate, endDate, page = 1, limit = 10 } = req.query;
        const query = { userId: req.user._id };

        if (strategyId) {
            query.strategyId = strategyId;
        }

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }

        const trades = await Trade.find(query)
            .populate('strategyId', 'name')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit));

        const total = await Trade.countDocuments(query);

        res.status(200).json({
            status: 'success',
            results: trades.length,
            total,
            pages: Math.ceil(total / limit),
            data: {
                trades
            }
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
};
