const Trade = require('../models/Trade');

// Issue #5 FIX: userId is now required. Overlays are scoped to the requesting user.
// rawTrades is no longer returned — callers receive only chart-display objects.
async function getTradeOverlays(underlying, date, userId) {
  const und = (underlying || 'NIFTY').toUpperCase();

  let startDate, endDate;
  if (date) {
    startDate = new Date(`${date}T00:00:00.000Z`);
    endDate = new Date(`${date}T23:59:59.999Z`);
  } else {
    const today = new Date().toISOString().split('T')[0];
    startDate = new Date(`${today}T00:00:00.000Z`);
    endDate = new Date(`${today}T23:59:59.999Z`);
  }

  try {
    // Issue #5 FIX: filter by userId so chart overlays only contain the requesting
    // user's trades — previously queried all users' trades with no userId filter.
    const trades = await Trade.find({
      index: und,
      userId,
      createdAt: { $gte: startDate, $lte: endDate },
    }).lean();

    const markers = [];
    const priceLines = [];

    const intervalSec = 300; // 5-minute candle boundary alignment

    trades.forEach((t) => {
      const entryTimeSec = Math.floor(new Date(t.createdAt).getTime() / 1000);
      const alignedEntryTime = Math.floor(entryTimeSec / intervalSec) * intervalSec;
      const isCE = t.premium && t.premium.endsWith('CE');

      // BUY Marker
      markers.push({
        time: alignedEntryTime,
        position: isCE ? 'belowBar' : 'aboveBar',
        color: '#10B981', // Green
        shape: isCE ? 'arrowUp' : 'arrowDown',
        text: `BUY @ ₹${t.buyPrice.toFixed(2)} (${t.premium})`,
      });

      // SELL Marker (if exited)
      if (t.exitPrice && t.updatedAt) {
        const exitTimeSec = Math.floor(new Date(t.updatedAt).getTime() / 1000);
        const alignedExitTime = Math.floor(exitTimeSec / intervalSec) * intervalSec;
        const pnlStr = t.pnl !== undefined ? ` (PnL: ₹${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)})` : '';
        markers.push({
          time: alignedExitTime,
          position: isCE ? 'aboveBar' : 'belowBar',
          color: '#EF4444', // Red
          shape: isCE ? 'arrowDown' : 'arrowUp',
          text: `SELL @ ₹${t.exitPrice.toFixed(2)}${pnlStr}`,
        });
      }

      // Horizontal Entry Price Line
      if (t.buyPrice) {
        priceLines.push({
          title: `Entry (${t.premium})`,
          price: t.buyPrice,
          color: '#3B82F6', // Blue
          lineStyle: 2, // Dashed
        });
      }
    });

    // Sort markers chronologically
    markers.sort((a, b) => a.time - b.time);

    // rawTrades intentionally NOT returned — it would expose symbols, prices,
    // P&L and order identifiers to any caller of this service.
    return {
      markers,
      priceLines,
    };
  } catch (err) {
    console.error('Failed to query trade overlays:', err.message);
    return { markers: [], priceLines: [] };
  }
}

module.exports = {
  getTradeOverlays,
};
