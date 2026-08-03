module.exports = {
  underlying: {
    type: 'select',
    label: 'Underlying Index',
    options: ['SENSEX', 'BANKNIFTY', 'NIFTY', 'FINNIFTY'],
    default: 'SENSEX',
    grouping: 'Core Settings',
    order: 1
  },
  quantity: {
    type: 'number',
    label: 'Order Quantity (Lots)',
    default: 1,
    min: 1,
    grouping: 'Core Settings',
    order: 2
  },
  strikeMode: {
    type: 'select',
    label: 'Strike Preference',
    options: ['ITM', 'ATM', 'OTM'],
    default: 'ATM',
    grouping: 'Strike Selection',
    order: 3
  },
  strikeDepth: {
    type: 'number',
    label: 'Strike Offset Depth',
    default: 1,
    min: 1,
    grouping: 'Strike Selection',
    order: 4,
    visibilityCondition: 'strikeMode != "ATM"'
  },
  premiumMin: {
    type: 'number',
    label: 'Option Premium Min Filter',
    default: 300,
    min: 1,
    grouping: 'Strike Selection',
    order: 5
  },
  premiumMax: {
    type: 'number',
    label: 'Option Premium Max Filter',
    default: 400,
    min: 1,
    grouping: 'Strike Selection',
    order: 6
  },
  exitStrategy: {
    type: 'select',
    label: 'Exit Strategy',
    options: ['POINTS', 'CANDLES', 'REVERSAL'],
    default: 'POINTS',
    grouping: 'Exit Settings',
    order: 7
  },
  targetPoints: {
    type: 'number',
    label: 'Target Points',
    default: 20,
    min: 1,
    grouping: 'Exit Settings',
    order: 8
  },
  slPoints: {
    type: 'number',
    label: 'Stop Loss Points',
    default: 30,
    min: 1,
    grouping: 'Exit Settings',
    order: 9
  },
  trailingStopPoints: {
    type: 'number',
    label: 'Trailing Stop Points',
    default: 0,
    min: 0,
    grouping: 'Exit Settings',
    order: 10
  },
  liveTradingConsent: {
    type: 'boolean',
    label: 'Live Trading Consent',
    default: false,
    grouping: 'Risk Settings',
    order: 11
  }
};
