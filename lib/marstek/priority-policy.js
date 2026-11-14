'use strict';
// Scheduled charging uses battery evidence, never an invented whole-site meter.
const fresh=(x,now,age)=>x&&Number.isFinite(x.observedAtMs)&&x.observedAtMs<=now&&now-x.observedAtMs<age;
function iogCurrent(c,now){return c.iogFresh&&Number.isFinite(c.iogFetchedAtMs)&&c.iogFetchedAtMs<=now&&now-c.iogFetchedAtMs<(c.iogFreshForMs??120000);}
function scheduledWindow(c,now){
 if(c.iogEnabled&&c.iogActive)return {source:'iog',target:c.iogTargetSoc,end:c.iogEndAtMs,suppressed:c.iogSuppressed,charge:c.iogMode==='charge',valid:iogCurrent(c,now)};
 if(c.overnightEnabled&&c.nightActive)return {source:'overnight',target:c.nightTargetSoc,end:c.nightEndAtMs,suppressed:c.nightSuppressed,charge:true,valid:true};
 return null;
}
function batteryEvidence({gateway:g,context:c={},nowMs:now}){
 if(fresh(g,now,6000)&&Array.isArray(g.units)&&g.units.length>=1&&g.units.length<=3&&g.onlineCount===g.units.length&&g.units.every(u=>Number.isFinite(u.socPercent)&&u.socPercent>=0&&u.socPercent<=100)&&Number.isFinite(g.aioDischargeW))return {observedAtMs:g.observedAtMs,socPercent:g.units.reduce((s,u)=>s+u.socPercent,0)/g.units.length,acDischargeW:g.aioDischargeW,count:g.units.length,source:'gateway'};
 const a=c.aioEvidence;
 if(fresh(a,now,30000)&&a.identityVerified===true&&a.singleAio===true&&Number.isFinite(a.socPercent)&&a.socPercent>=0&&a.socPercent<=100&&Number.isFinite(a.acDischargeW))return {...a,count:1,source:'aio'};
 return null;
}
function scheduledEvidence(plan,{gateway,venus,context={},nowMs}){
 const w=scheduledWindow(context,nowMs),a=batteryEvidence({gateway,context,nowMs});
 return plan.evidenceKind==='scheduled-battery'&&w?.valid&&w.charge&&!w.suppressed&&w.end>nowMs&&plan.chargeTargetSoc===w.target&&plan.leaseUntilMs<=w.end&&
  !context.emergencyStop&&!context.automationHold&&!context.externalOwner&&fresh(venus,nowMs,context.localApiTimed?30000:6000)&&venus.acDirectionQualified===true&&
  a&&a.acDischargeW<=50;
}
function priorityPlan({gateway:g,venus:v,nowMs,context:c={},intent},settings){
 const w=scheduledWindow(c,nowMs);
 if(!w)return null;
 const zero=reason=>({shadowOnly:true,evidenceKind:'scheduled-battery',reason,aioW:0,venusW:0,combinedSoc:null,reachable:false,leaseUntilMs:nowMs,chargeTargetSoc:w.target});
 if(c.emergencyStop||c.automationHold||c.externalOwner)return zero('held');
 if(!w.valid)return zero('iog-stale');
 if(w.suppressed)return zero('occurrence-cancelled');
 if(!w.charge)return zero('iog-pause');
 // An explicit manual charge may keep its existing combined-target semantics.
 // EV protection always overrides a manual export.
 if(intent?.mode==='charge'&&w.source!=='iog')return null;
 const plan={...zero('scheduled-charge'),chargeSource:w.source,leaseUntilMs:Math.min(w.end,nowMs+(c.localApiTimed?120000:(settings.commandLeaseMs??5000)))};
 if(!Number.isInteger(w.target)||w.target<10||w.target>100||!Number.isFinite(w.end)||w.end<=nowMs)return zero('invalid-charge-window-or-target');
 if(!fresh(v,nowMs,c.localApiTimed?30000:6000)||!Number.isFinite(v.socPercent)||v.socPercent<0||v.socPercent>100||!v.acDirectionQualified)return zero('venus-unavailable');
 if(!scheduledEvidence(plan,{gateway:g,venus:v,context:c,nowMs}))return zero('await-aio-evidence');
 const a=batteryEvidence({gateway:g,context:c,nowMs}),ac=settings.aioCapacityKwh*a.count,vc=settings.venusCapacityKwh;
 plan.aioObservedAtMs=a.observedAtMs;plan.batteryEvidenceSource=a.source;
 plan.combinedSoc=(a.socPercent*ac+v.socPercent*vc)/(ac+vc);
 plan.availableKwh=ac*Math.max(0,a.socPercent-settings.aioReserve)/100+vc*Math.max(0,v.socPercent-settings.venusReserve)/100;
 if(v.socPercent>=w.target)return {...plan,reason:'venus-target-protected',reachable:true};
 return {...plan,venusW:-settings.venusInputW,reachable:true};
}
module.exports={batteryEvidence,fresh,iogCurrent,scheduledWindow,scheduledEvidence,priorityPlan};
