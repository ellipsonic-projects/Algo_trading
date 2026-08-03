const strategyRegistry = require('../services/strategyRegistry');
const strategyEngine = require('../services/strategyEngine');

async function testHeartbeatSimulation() {
  console.log('====================================================');
  console.log('  Testing Real-Time Strategy Status & Heartbeat     ');
  console.log('====================================================\n');

  await strategyRegistry.init();

  const runnerKey = 'test_user_ModifiedHeikenAshi';
  const runner = strategyEngine.getRunner(runnerKey);

  runner.ceContract = { tradingsymbol: 'SENSEX2680678700CE', symboltoken: '840209', exchange: 'BFO' };
  runner.peContract = { tradingsymbol: 'SENSEX2680678700PE', symboltoken: '840325', exchange: 'BFO' };
  runner.isRunning = true;
  runner.state = 'SCANNING';

  console.log('[STEP 1] Testing Single Heartbeat Log Generation...');
  runner.startHeartbeatLoop();

  // Give heartbeat interval 500ms to verify instance properties
  await new Promise(resolve => setTimeout(resolve, 500));

  if (!runner.heartbeatInterval) {
    throw new Error('Heartbeat interval timer was not initialized');
  }
  console.log('✅ Heartbeat interval timer successfully initialized');

  if (runner.logs.length === 0) {
    throw new Error('No logs recorded on runner');
  }
  console.log(`Latest log entry: "${runner.logs[0]}"`);

  console.log('\n[STEP 2] Testing Clean Teardown on Strategy Stop...');
  runner.stop();

  if (runner.heartbeatInterval !== null) {
    throw new Error('Heartbeat interval timer was not cleared on stop()');
  }
  console.log('✅ Heartbeat interval timer successfully cleared on stop()');

  console.log('\n====================================================');
  console.log('  REAL-TIME HEARTBEAT VISIBILITY TEST PASSED 100%   ');
  console.log('====================================================');
  process.exit(0);
}

testHeartbeatSimulation().catch(err => {
  console.error('❌ Heartbeat Simulation Failed:', err.message);
  process.exit(1);
});
