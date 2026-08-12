const chargesConfig = require('../config/chargesConfig');

/**
 * Calculates the stock exchange charges and taxes for an options trade.
 * 
 * @param {number} buyPrice - The execution price of the buy order.
 * @param {number} exitPrice - The execution price of the sell/exit order.
 * @param {number} qty - The quantity/lot size traded.
 * @returns {object} - Total charges and detailed breakdown.
 */
function calculateCharges(buyPrice, exitPrice, qty) {
  const options = chargesConfig.options;
  
  const buyTurnover = buyPrice * qty;
  const exitTurnover = exitPrice * qty;
  
  // Flat brokerage: 20 Rs per order (Buy + Sell = 40 Rs)
  const brokerage = options.brokeragePerOrder * 2; 
  
  // STT: 0.0625% on Sell side premium turnover
  const stt = exitTurnover * options.sttRateOnSellTurnover;
  
  // Exchange Txn Charges: 0.05% on Buy + Sell premium turnover
  const exchangeTxn = (buyTurnover + exitTurnover) * options.exchangeTxnRate;
  
  // SEBI turnover fee: ₹10/crore (0.000001) on Buy + Sell premium turnover
  const sebi = (buyTurnover + exitTurnover) * options.sebiChargesRate;
  
  // Stamp duty: 0.003% on Buy side premium turnover
  const stampDuty = buyTurnover * options.stampDutyRateOnBuyTurnover;
  
  // GST: 18% on (Brokerage + Exchange Txn + SEBI)
  const gst = (brokerage + exchangeTxn + sebi) * options.gstRate;
  
  const total = brokerage + stt + exchangeTxn + sebi + stampDuty + gst;
  
  return {
    total: Math.round(total * 100) / 100,
    breakdown: {
      brokerage: Math.round(brokerage * 100) / 100,
      stt: Math.round(stt * 100) / 100,
      exchangeTxn: Math.round(exchangeTxn * 100) / 100,
      sebi: Math.round(sebi * 100) / 100,
      stampDuty: Math.round(stampDuty * 100) / 100,
      gst: Math.round(gst * 100) / 100
    },
    version: chargesConfig.version
  };
}

module.exports = {
  calculateCharges
};
