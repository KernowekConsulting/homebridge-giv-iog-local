'use strict';
const {scheduledWindow}=require('./priority-policy');
// Refresh existing inverter telemetry before its 30s safety bound expires.
// No independent client, altered freshness limit or extra command path.
function needsPoll({config,context,nowMs,evidence,lastAttemptAtMs,singleAio,aioReserve}) {
 if(config.marstekIntegrationEnabled!==true||config.marstekControlEnabled!==true||!singleAio)return false;
 const window=scheduledWindow(context,nowMs);
 if(context.emergencyStop||context.automationHold||context.externalOwner)return false;
 const scheduled=window?.valid&&window.charge&&!window.suppressed&&Number.isFinite(window.end)&&window.end>nowMs;
 const reserveEco=context.ecoEnabled===true&&!context.exportActive&&!context.iogActive&&
  !(context.overnightEnabled&&context.nightActive)&&evidence?.identityVerified===true&&
  Number.isFinite(aioReserve)&&Number.isFinite(evidence.socPercent)&&evidence.socPercent>=0&&evidence.socPercent<=aioReserve;
 if(!scheduled&&!reserveEco)return false;
 if(Number.isFinite(lastAttemptAtMs)&&nowMs-lastAttemptAtMs<10000)return false;
 return !Number.isFinite(evidence?.observedAtMs)||evidence.observedAtMs>nowMs||nowMs-evidence.observedAtMs>=10000;
}
module.exports={needsPoll};
