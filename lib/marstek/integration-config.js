'use strict';
const { isIP } = require('node:net');
const { normaliseDevices } = require('./venus-e3');
const { GatewayMeterController } = require('./meter-controller');
function gatewayOptionsFromConfig(config) {
 const host=String(config.marstekGatewayHost||'').trim();
 const serial=String(config.marstekGatewaySerial||'').trim().toUpperCase();
 if(!host&&!serial)return null;
 if(isIP(host)!==4 || !/^GW[A-Z0-9]{8}$/.test(serial))throw new Error('Marstek Gateway needs a valid IPv4 address and expected GW serial');
 return {host,serial,port:8899,topologyEncoding:'owner-enum'};
}
function controllerOptionsFromConfig(config,id) {
 const device=normaliseDevices(config.marstekDevices).find(d=>d.id===id);
 if(!device)throw new Error('Select one enabled Marstek battery for the controller simulation');
 const options={mode:config.marstekControllerMode??'residual',reserveSoc:config.marstekReserveSoc??20,
  maxDischargeW:device.maxDischargeW,maxChargeW:device.maxChargeW,higherDischargeLimitConfirmed:device.higherDischargeLimitConfirmed};
 new GatewayMeterController(options); // validate before returning; no connections or commands
 return options;
}
module.exports={gatewayOptionsFromConfig,controllerOptionsFromConfig};
