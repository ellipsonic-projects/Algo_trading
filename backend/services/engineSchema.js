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
  baseTimeframe: {
    type: 'select',
    label: 'Primary Timeframe',
    options: ['ONE_MINUTE', 'THREE_MINUTE', 'FIVE_MINUTE', 'FIFTEEN_MINUTE', 'THIRTY_MINUTE'],
    default: 'FIVE_MINUTE',
    grouping: 'Core Settings',
    order: 3
  },
  needConfirmation: {
    type: 'boolean',
    label: 'Higher Timeframe Sync',
    default: false,
    grouping: 'Core Settings',
    order: 4
  },
  confirmationTimeframe: {
    type: 'select',
    label: 'Confirmation Timeframe',
    options: ['ONE_MINUTE', 'THREE_MINUTE', 'FIVE_MINUTE', 'FIFTEEN_MINUTE', 'THIRTY_MINUTE'],
    default: 'FIFTEEN_MINUTE',
    grouping: 'Core Settings',
    order: 5
  },
  strikeMode: {
    type: 'select',
    label: 'Strike Preference',
    options: ['ITM', 'ATM', 'OTM'],
    default: 'ATM',
    grouping: 'Strike Selection',
    order: 6
  },
  strikeDepth: {
    type: 'number',
    label: 'Strike Offset Depth',
    default: 1,
    min: 1,
    grouping: 'Strike Selection',
    order: 7,
    visibilityCondition: 'strikeMode != "ATM"'
  },
  premiumMin: {
    type: 'number',
    label: 'Option Premium Min Filter',
    default: 300,
    min: 1,
    grouping: 'Strike Selection',
    order: 8
  },
  premiumMax: {
    type: 'number',
    label: 'Option Premium Max Filter',
    default: 400,
    min: 1,
    grouping: 'Strike Selection',
    order: 9
  },
  exitStrategy: {
    type: 'select',
    label: 'Exit Strategy',
    options: ['POINTS', 'CANDLES', 'REVERSAL', 'TARGET', 'TRAILING_SL'],
    default: 'POINTS',
    grouping: 'Exit Settings',
    order: 10
  },
  targetPoints: {
    type: 'number',
    label: 'Target Points',
    default: 20,
    min: 1,
    grouping: 'Exit Settings',
    order: 11
  },
  slPoints: {
    type: 'number',
    label: 'Stop Loss Points',
    default: 30,
    min: 1,
    grouping: 'Exit Settings',
    order: 12
  },
  trailingStopPoints: {
    type: 'number',
    label: 'Trailing Stop Points',
    default: 0,
    min: 0,
    grouping: 'Exit Settings',
    order: 13
  },
  liveTradingConsent: {
    type: 'boolean',
    label: 'Live Trading Consent',
    default: false,
    grouping: 'Risk Settings',
    order: 14
  }
};

