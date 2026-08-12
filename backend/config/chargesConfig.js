module.exports = {
  version: "2026-v1",
  options: {
    brokeragePerOrder: 20.0,
    sttRateOnSellTurnover: 0.000625, // 0.0625%
    exchangeTxnRate: 0.0005,         // 0.05%
    sebiChargesRate: 0.000001,       // ₹10/crore
    stampDutyRateOnBuyTurnover: 0.00003, // 0.003%
    gstRate: 0.18                    // 18% on (brokerage + exchangeTxn + sebi)
  }
};
