const chartService = require('../services/chartService');
const config = require('../config');

const ltpCache = new Map();

exports.getMarketChartData = async (req, res) => {
  try {
    const { underlying, date, interval } = req.query;
    // Issue #5 FIX: pass userId so trade overlays are filtered to this user only.
    const data = await chartService.getMarketChartData({ underlying, date, interval, userId: req.user._id });
    res.status(200).json({
      status: 'success',
      data,
    });
  } catch (err) {
    console.error('Error in getMarketChartData controller:', err.message);
    res.status(500).json({
      status: 'error',
      message: err.message || 'Failed to fetch market chart data',
    });
  }
};

exports.getIndexLtp = async (req, res) => {
  try {
    const underlying = (req.query.underlying || 'NIFTY').toUpperCase();
    const cached = ltpCache.get(underlying);
    if (cached && Date.now() - cached.timestamp < 2000) {
      return res.status(200).json(cached.data);
    }

    const response = await fetch(`${config.API.ANGEL_ONE_API_BASE}/market/index-ltp?underlying=${encodeURIComponent(underlying)}`);
    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).send(text);
    }
    const data = await response.json();
    ltpCache.set(underlying, { timestamp: Date.now(), data });
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};
