'use strict';
const states=new WeakMap();
// Clear a HomeKit communication fault and notify even if the recovered value
// equals the previous one. Normal identical values retain HAP's event filtering.
function publish(characteristic,value){
 const failed=value instanceof Error,previous=states.get(characteristic);
 if(failed&&previous===true)return;
 const wasFailed=Boolean(characteristic.statusCode);characteristic.updateValue(value);states.set(characteristic,failed);
 if((previous===true||wasFailed)&&!failed)characteristic.sendEventNotification?.(value);
}
class SocContinuity{
 constructor({maxAgeMs=90000}={}){this.maxAgeMs=maxAgeMs;this.last=null;}
 observe(record,{gateway,venus,context={},nowMs}={}){
  if(gateway?.identityFault||venus?.identityQualified===false||['membership-or-readings-invalid','guard-time-regression'].includes(record?.result?.reason)){this.last=null;return;}
  const value=record?.result?.combinedSoc;
  if(!Number.isFinite(value)||value<0||value>100)return;
  const a=record.result.evidenceKind==='scheduled-battery'?record.result.aioObservedAtMs:gateway?.observedAtMs;
  const times=[a,venus?.observedAtMs];
  if(!times.every(t=>Number.isFinite(t)&&t<=nowMs))return;
  // Never replace the source timestamp with a UI refresh timestamp.
  this.remember(value,Math.min(...times),nowMs);
 }
 remember(value,at,now){if(!Number.isFinite(value)||value<0||value>100||!Number.isFinite(at)||!Number.isFinite(now)||at>now||this.last&&at<this.last.at)return false;this.last={at,value:Math.round(value)};return true;}
 value(now){return this.last&&now>=this.last.at&&now-this.last.at<=this.maxAgeMs?this.last.value:null;}
 clear(){this.last=null;}
}
module.exports={publish,SocContinuity};
