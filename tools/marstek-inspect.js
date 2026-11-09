'use strict';
const { ReadOnlyModbusTcpClient } = require('../lib/marstek/modbus-tcp');
const { readSnapshot, CONTROL_BLOCKS } = require('../lib/marstek/venus-e3');
async function main(args = process.argv.slice(2)) {
  const [host, portText = '502'] = args.filter(arg => arg !== '--include-controls');
  if (!host || args.includes('--help')) {
    console.log('Usage: node tools/marstek-inspect.js HOST [PORT] [--include-controls]\nReads only. Optional control-register snapshots are diagnostic evidence; no writes are sent.');
    return;
  }
  const client = new ReadOnlyModbusTcpClient({ host, port: Number(portText), unitId: 1 });
  try {
    const snapshot = await readSnapshot(client);
    if (args.includes('--include-controls')) {
      snapshot.controlReads = [];
      for (const [address, count] of CONTROL_BLOCKS) {
        try { snapshot.controlReads.push({ address, words: await client.readHoldingRegisters(address, count) }); }
        catch (error) { snapshot.controlReads.push({ address, error: error.message }); }
      }
    }
    console.log(JSON.stringify({ preview: true, hardwareQualified: false, ...snapshot }, null, 2));
  } finally { client.close(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
