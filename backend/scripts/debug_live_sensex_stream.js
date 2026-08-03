const marketDataService = require('../services/marketDataService');
const contractManager = require('../services/contractManager');
const strategyRegistry = require('../services/strategyRegistry');
const smartStream = require('../services/smartStream');

async function runLiveTimestampTrace() {
  console.log('====================================================');
  console.log(' LIVE RUNTIME TIMESTAMP & TICK TRACE: SENSEX vs BANKNIFTY');
  console.log('====================================================\n');

  await strategyRegistry.init();

  const bnContracts = await contractManager.resolveContracts('BANKNIFTY', 'ATM', 1);
  const sxContracts = await contractManager.resolveContracts('SENSEX', 'ATM', 1);

  await marketDataService.subscribe(bnContracts.exchange, bnContracts.ceContract.symboltoken, 'FIVE_MINUTE');
  await marketDataService.subscribe(sxContracts.exchange, sxContracts.ceContract.symboltoken, 'FIVE_MINUTE');

  console.log('\n[LIVE TIMESTAMP INSPECTION FOR 5 SECONDS]');

  const tickHandler = (tick) => {
    const isSensex = tick.token === String(sxContracts.ceContract.symboltoken);
    const label = isSensex ? 'SENSEX (BFO)' : 'BANKNIFTY (NFO)';
    const dateObj = new Date(tick.timestamp);
    console.log(` -> [${label}] Token: ${tick.token} | Raw TS: ${tick.timestamp} | Formatted IST: ${dateObj.toLocaleTimeString('en-IN')} | LTP: ₹${tick.ltp}`);
  };

  smartStream.on('tick', tickHandler);
  await new Promise(resolve => setTimeout(resolve, 5000));
  smartStream.off('tick', tickHandler);

  console.log('\n====================================================');
  console.log(' LIVE TIMESTAMP TRACE COMPLETE');
  console.log('====================================================');
  process.exit(0);
}

runLiveTimestampTrace().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
