'use strict';
const { gatewayOptionsFromConfig } = require('./integration-config');
const { readGateway } = require('./gateway-meter');
async function testGateway(payload, { read = readGateway } = {}) {
  const options=gatewayOptionsFromConfig(payload||{});if(!options)throw new Error('Enter both Gateway IP and expected serial');
  const first=Number(options.host.split('.')[0]),second=Number(options.host.split('.')[1]);
  if(!(first===10||first===127||(first===192&&second===168)||(first===172&&second>=16&&second<=31)))throw new Error('Use a local private Gateway IPv4 address');
  const sample=await read(options);
  // Defence in depth: never claim success merely because an injected reader returned data.
  if(sample.serial!==options.serial)throw new Error('Gateway identity mismatch');
  return { verified:true, observedAtMs:sample.observedAtMs, serial:sample.serial, gridExportW:sample.gridExportW,
    solarW:sample.solarW,householdLoadW:sample.householdLoadW,aioDischargeW:sample.aioDischargeW,
    onlineCount:sample.onlineCount,rawConfigured:sample.rawConfigured,topologyEncoding:sample.topologyEncoding,
    units:sample.units,shadowOnly:true };
}
module.exports={testGateway};
