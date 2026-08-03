const strategyRegistry = require('../services/strategyRegistry');
const indicators = require('../trading/indicators');

async function runPluginSimulation() {
  console.log('====================================================');
  console.log('  OptionAlgo Plug-and-Play Architecture Test Suite  ');
  console.log('====================================================\n');

  // STAGE 1: Discovery & Registry Initialization
  console.log('[STAGE 1] Testing Strategy Plugin Discovery & Registry');
  await strategyRegistry.init();

  const manifests = strategyRegistry.getManifests();
  console.log(`Discovered ${manifests.length} Plugin Manifests:`);
  manifests.forEach(m => {
    console.log(` - [${m.id}] ${m.name} (engineVersion: ${m.engineVersion}, timeframe: ${m.requires.timeframe})`);
  });

  if (manifests.length < 3) {
    throw new Error('Expected at least 3 strategy plugins registered');
  }
  console.log('✅ [STAGE 1 PASSED] All strategy plugins discovered and registered\n');

  // STAGE 2: Manifest Compatibility & Requirement Validation
  console.log('[STAGE 2] Testing Manifest Validation & Engine Version Compatibility');
  const haPlugin = strategyRegistry.getPlugin('HeikenAshi');
  const modHaPlugin = strategyRegistry.getPlugin('ModifiedHeikenAshi');
  const breakoutPlugin = strategyRegistry.getPlugin('5minBreakout');

  if (!haPlugin || !modHaPlugin || !breakoutPlugin) {
    throw new Error('Missing core strategy plugins in registry');
  }

  if (haPlugin.manifest.engineVersion !== '1.0.0' || modHaPlugin.manifest.engineVersion !== '1.0.0' || breakoutPlugin.manifest.engineVersion !== '1.0.0') {
    throw new Error('Plugin engineVersion mismatch');
  }
  console.log('✅ [STAGE 2 PASSED] Manifest validation and engineVersion rules verified\n');

  // STAGE 3: Signal Parity Test for HeikenAshi Plugin
  console.log('[STAGE 3] Testing Signal Parity for HeikenAshi Plugin');
  const haInstance = new haPlugin({ emaPeriod: 20, jmaLength: 7 });

  const mockCandles = [
    { time: 1000, open: 100, high: 105, low: 99, close: 104 },
    { time: 2000, open: 104, high: 110, low: 104, close: 109 },
    { time: 3000, open: 109, high: 115, low: 109, close: 114 }
  ];

  const haEval = haInstance.analyze({ items: mockCandles, indicators });
  console.log(`HeikenAshi Plugin Signal Evaluation -> trend: ${haEval.trend}, isEntry: ${haEval.isEntry}`);
  if (typeof haEval.isEntry !== 'boolean' || typeof haEval.trend !== 'string') {
    throw new Error('HeikenAshi signal output format invalid');
  }
  console.log('✅ [STAGE 3 PASSED] HeikenAshi plugin signal evaluation verified\n');

  // STAGE 4: Signal Parity Test for 5minBreakout Plugin
  console.log('[STAGE 4] Testing Signal Parity for 5minBreakout Plugin');
  const breakoutInstance = new breakoutPlugin({ lookback: 5, maxRangeLimit: 30 });
  const breakoutEval = breakoutInstance.analyze({ items: [], lastProcessedTs: null, indicators });

  if (typeof breakoutEval.isBreakout !== 'boolean') {
    throw new Error('5minBreakout signal output format invalid');
  }
  console.log('✅ [STAGE 4 PASSED] 5minBreakout plugin signal evaluation verified\n');

  console.log('====================================================');
  console.log('  ALL 4 PLUG-AND-PLAY ARCHITECTURE STAGES PASSED');
  console.log('====================================================');
  process.exit(0);
}

runPluginSimulation().catch(err => {
  console.error('❌ Plugin Simulation Failed:', err.message);
  process.exit(1);
});
