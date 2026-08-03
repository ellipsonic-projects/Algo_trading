const strategyRegistry = require('../services/strategyRegistry');
const strategyEngine = require('../services/strategyEngine');
const TwoCandleTrendPlugin = require('../trading/strategies/plugins/twoCandleTrendPlugin');

async function testTwoCandleTrendIntegration() {
  console.log('====================================================');
  console.log(' INTEGRATION TEST: TwoCandleTrend Strategy Plugin  ');
  console.log('====================================================\n');

  // STEP 1: Discovery & Registry Verification
  console.log('[STEP 1] Initializing Plugin Registry...');
  await strategyRegistry.init();

  const isRegistered = strategyRegistry.hasPlugin('TwoCandleTrend');
  console.log(` - Is "TwoCandleTrend" plugin registered?: ${isRegistered ? 'YES ✅' : 'NO ❌'}`);

  if (!isRegistered) {
    throw new Error('TwoCandleTrend plugin failed registry discovery');
  }

  const PluginClass = strategyRegistry.getPlugin('TwoCandleTrend');
  console.log(` - Plugin Name: "${PluginClass.manifest.name}"`);
  console.log(` - Engine Version: "${PluginClass.manifest.engineVersion}"`);

  // STEP 2: Plugin Signal Logic Verification
  console.log('\n[STEP 2] Verifying TwoCandleTrend Signal Analysis...');
  const pluginInstance = new PluginClass({ quantity: 1 });

  // Test Bullish CE Signal (2 green candles)
  const greenCandles = [
    { open: 100, high: 110, low: 98, close: 105, time: 1000 },
    { open: 105, high: 120, low: 104, close: 115, time: 1300 }
  ];
  const ceSignal = pluginInstance.analyze({ items: greenCandles });
  console.log(' - Bullish CE Signal Output:', ceSignal);
  if (!ceSignal.isEntry || ceSignal.signal !== 'BUY_CE') {
    throw new Error('Bullish CE signal failed verification');
  }
  console.log(' ✅ Bullish CE Signal Verified');

  // Test Bearish PE Signal (2 red candles)
  const redCandles = [
    { open: 110, high: 112, low: 95, close: 100, time: 1000 },
    { open: 100, high: 102, low: 88, close: 90, time: 1300 }
  ];
  const peSignal = pluginInstance.analyze({ items: redCandles });
  console.log(' - Bearish PE Signal Output:', peSignal);
  if (!peSignal.isEntry || peSignal.signal !== 'BUY_PE') {
    throw new Error('Bearish PE signal failed verification');
  }
  console.log(' ✅ Bearish PE Signal Verified');

  // STEP 3: Engine Runner Integration Verification
  console.log('\n[STEP 3] Verifying Engine Runner Dispatch for TwoCandleTrend...');
  const runner = strategyEngine.getRunner('test_user_TwoCandleTrend');
  if (!runner) {
    throw new Error('Failed to instantiate SingleStrategyRunner for TwoCandleTrend');
  }
  console.log(` - Runner Created for Strategy: "${runner.strategyName}"`);
  console.log(` - Base Timeframe: "${runner.getBaseTimeframe()}"`);

  if (runner.getBaseTimeframe() !== 'FIVE_MINUTE') {
    throw new Error(`Expected timeframe "FIVE_MINUTE", got "${runner.getBaseTimeframe()}"`);
  }
  console.log(' ✅ Base Timeframe correctly resolved from plugin manifest');

  console.log('\n====================================================');
  console.log(' TWO CANDLE TREND PLUGIN INTEGRATION TEST PASSED   ');
  console.log('====================================================');
  process.exit(0);
}

testTwoCandleTrendIntegration().catch(err => {
  console.error('❌ Integration Test Error:', err.message);
  process.exit(1);
});
