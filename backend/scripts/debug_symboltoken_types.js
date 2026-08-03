const contractManager = require('../services/contractManager');

async function testSymboltokenTypes() {
  console.log('====================================================');
  console.log(' TESTING SYMBOLTOKEN TYPES FOR BANKNIFTY VS SENSEX');
  console.log('====================================================\n');

  const bn = await contractManager.resolveContracts('BANKNIFTY', 'ATM', 1);
  const sx = await contractManager.resolveContracts('SENSEX', 'ATM', 1);

  console.log('BANKNIFTY CE symboltoken:', bn.ceContract.symboltoken, 'Type:', typeof bn.ceContract.symboltoken);
  console.log('BANKNIFTY PE symboltoken:', bn.peContract.symboltoken, 'Type:', typeof bn.peContract.symboltoken);

  console.log('SENSEX CE symboltoken:', sx.ceContract.symboltoken, 'Type:', typeof sx.ceContract.symboltoken);
  console.log('SENSEX PE symboltoken:', sx.peContract.symboltoken, 'Type:', typeof sx.peContract.symboltoken);

  const mockEventDataStr = { symboltoken: String(sx.ceContract.symboltoken) };
  const strictMatchCE = mockEventDataStr.symboltoken === sx.ceContract.symboltoken;
  const looseMatchCE = String(mockEventDataStr.symboltoken) === String(sx.ceContract.symboltoken);

  console.log('\nStrict Equality (===):', strictMatchCE);
  console.log('String Coerced Equality:', looseMatchCE);

  process.exit(0);
}

testSymboltokenTypes().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
