'use strict';
const fs=require('node:fs');
const {GatewayMeterController}=require('./meter-controller');
class SiteCoordinator {
 constructor({commandLeaseMs=5000,aioCapacityKwh=13.5,venusCapacityKwh=5.12,aioReserve=20,venusReserve=20,importLimitW=0,exportLimitW=6000,marginW=200,venusOutputW=800,venusInputW=2500,aioPowerW=6000,aioChargeW=aioPowerW,aioDischargeW=aioPowerW,higherDischargeLimitConfirmed=false}={}) {
  Object.assign(this,{commandLeaseMs,aioCapacityKwh,venusCapacityKwh,aioReserve,venusReserve,importLimitW,exportLimitW,marginW,venusOutputW,venusInputW,aioPowerW,aioChargeW,aioDischargeW});
  if(![5000,8000].includes(commandLeaseMs))throw Error('Unqualified command lease');
  for(const key of ['aioCapacityKwh','venusCapacityKwh','aioPowerW','aioChargeW','aioDischargeW'])if(!Number.isFinite(this[key])||this[key]<=0)throw Error('Invalid '+key);
  for(const key of ['aioReserve','venusReserve'])if(!Number.isFinite(this[key])||this[key]<0||this[key]>=100)throw Error('Invalid '+key);
  if(!Number.isFinite(importLimitW)||importLimitW<0||!Number.isFinite(exportLimitW)||exportLimitW<=marginW||marginW<0||!Number.isFinite(marginW)||!Number.isFinite(venusOutputW)||venusOutputW<0||venusOutputW>2500||(venusOutputW>800&&!higherDischargeLimitConfirmed)||!Number.isFinite(venusInputW)||venusInputW<0||venusInputW>2500)throw Error('Unqualified site limits');
  this.eco=new GatewayMeterController({mode:'house-support',maxChargeW:venusInputW,maxDischargeW:venusOutputW,reserveSoc:venusReserve,higherDischargeLimitConfirmed,exportLimitW,exportMarginW:marginW,maxAgeMs:6000,maxSkewMs:2500,leaseMs:commandLeaseMs+2000});
 }
 step(sample){
  this.ecoUsed=false;
  try{return this.plan(sample);}finally{if(!this.ecoUsed)this.eco.last=null;}
 }
 plan({gateway:g,venus:v,nowMs,intent,context={}}) {
  if(context.priorityControlEnabled){const p=require('./priority-policy').priorityPlan({gateway:g,venus:v,nowMs,context,intent},this);if(p)return p;}
  const stop=reason=>({shadowOnly:true,reason,aioW:0,venusW:0,combinedSoc:null,reachable:false,leaseUntilMs:nowMs});
  if(!g||!v||!Number.isFinite(nowMs)||![g.observedAtMs,v.observedAtMs].every(t=>Number.isFinite(t)&&t<=nowMs&&nowMs-t<=(context.localApiTimed?30000:6000))||Math.abs(g.observedAtMs-v.observedAtMs)>(context.localApiTimed?30000:2500)||!v.acDirectionQualified)return stop('telemetry-unavailable');
  if(!Array.isArray(g.units)||g.units.length<1||g.units.length>3||g.onlineCount!==g.units.length||!g.units.every(u=>Number.isFinite(u.socPercent)&&u.socPercent>=0&&u.socPercent<=100)||!Number.isFinite(v.socPercent)||v.socPercent<0||v.socPercent>100||![g.gridExportW,g.aioDischargeW,v.acDischargeW].every(Number.isFinite))return stop('membership-or-readings-invalid');
  const aCap=this.aioCapacityKwh*g.units.length,total=aCap+this.venusCapacityKwh;
  const aSoc=g.units.reduce((sum,u)=>sum+u.socPercent,0)/g.units.length;
  const combinedSoc=(aSoc*aCap+v.socPercent*this.venusCapacityKwh)/total;
  const result={...stop('idle'),combinedSoc,availableKwh:g.units.reduce((sum,u)=>sum+this.aioCapacityKwh*Math.max(0,u.socPercent-this.aioReserve)/100,0)+this.venusCapacityKwh*Math.max(0,v.socPercent-this.venusReserve)/100,leaseUntilMs:nowMs+this.commandLeaseMs};
  if(context.emergencyStop||context.automationHold)return {...result,reason:'held'};
  if(context.priorityControlEnabled&&context.iogEnabled&&!require('./priority-policy').iogCurrent(context,nowMs))return {...result,reason:'iog-stale'};
  if(context.externalOwner)return {...result,reason:'external-control-owner'};
  let mode=intent?.mode,target=intent?.target;
  if(intent && (!Number.isFinite(intent.deadlineMs)||intent.deadlineMs<=nowMs))return {...result,reason:'intent-expired'};
  if(!intent&&context.overnightEnabled&&context.nightActive){mode='charge';target=context.nightTargetSoc;}
  if(!intent&&!mode&&context.iogEnabled&&context.iogActive){if(!context.iogFresh||!Number.isFinite(context.iogFetchedAtMs)||nowMs-context.iogFetchedAtMs>(Number.isFinite(context.iogFreshForMs)&&context.iogFreshForMs>0?context.iogFreshForMs:120000)||context.iogFetchedAtMs>nowMs)return {...result,reason:'iog-stale'};if(context.iogMode==='charge'){mode='charge';target=context.iogTargetSoc;}else return {...result,reason:'iog-pause'};}
  if(context.nightSuppressed&&context.nightActive||context.iogSuppressed&&context.iogActive)return {...result,reason:'occurrence-cancelled'};
  if(!mode&&context.exportActive){mode='assist';target=0;}
  if(!mode){
   if(!context.ecoEnabled)return result;
   // An unknown IOG schedule must not let house support drain into an EV.
   if(context.iogEnabled&&(!context.iogFresh||!Number.isFinite(context.iogFetchedAtMs)||context.iogFetchedAtMs>nowMs||nowMs-context.iogFetchedAtMs>(context.iogFreshForMs??120000)))return {...result,reason:'iog-stale'};
   this.ecoUsed=true;
   // API observations are paced; retain original timestamps and bounded leases.
   Object.assign(this.eco.config,context.localApiTimed?{maxAgeMs:30000,maxSkewMs:30000,leaseMs:40000}:{maxAgeMs:6000,maxSkewMs:2500,leaseMs:this.commandLeaseMs+2000});
   const request=this.eco.step({gateway:{...g,observedAtMs:require('./observation-clock').meterProgressAt(g,context,nowMs)},venus:v,nowMs});
   return {...result,controlKind:'eco',venusW:request.powerW,reason:request.kind==='stop'?request.reason:'eco-house-support',reachable:request.kind!=='stop',leaseUntilMs:Math.min(context.localApiTimed?nowMs+30000:result.leaseUntilMs,request.leaseUntilMs)};
  }
  if(!Number.isInteger(target)||target<0||target>100)return {...result,reason:'invalid-target'};
  result.controlKind=mode==='charge'||mode==='export'?'percentage':mode==='assist'?'assistance':'eco';
  if(intent){result.leaseUntilMs=Math.min(context.localApiTimed?nowMs+120000:result.leaseUntilMs,intent.deadlineMs);result.targetSoc=intent.target;result.actionEndAtMs=intent.deadlineMs;result.totalCapacityKwh=total;}
  if(mode==='charge') {
   if(combinedSoc>=target)return {...result,reason:'target-reached',complete:true,reachable:true};
   // Remove existing battery contributions before sharing a whole-site allowance.
   const otherImport=-g.gridExportW+(context.cooperativeCharge?0:g.aioDischargeW)+v.acDischargeW;
   let budget=this.importLimitW>0?Math.max(0,this.importLimitW-this.marginW-otherImport):(context.cooperativeCharge?this.venusInputW:this.aioChargeW+this.venusInputW);
   const aNeed=g.units.reduce((sum,u)=>sum+this.aioCapacityKwh*Math.max(0,target-u.socPercent)/100,0),vNeed=this.venusCapacityKwh*Math.max(0,target-v.socPercent)/100;
   let a=Math.min(this.aioChargeW,!context.cooperativeCharge&&aNeed>0?budget*aNeed/(aNeed+vNeed):0),b=Math.min(this.venusInputW,vNeed>0?budget-a:0);a=Math.min(this.aioChargeW,!context.cooperativeCharge&&aNeed>0?budget-b:0);
   if(g.aioDischargeW>50)b=0;
   const needed=Math.max(0,(target-combinedSoc)*total/100),power=a+b;
   return {...result,reason:power?'charge-budgeted':'no-import-headroom',aioW:a?-Math.round(a):0,venusW:b?-Math.round(b):0,remainingKwh:needed,estimatedHours:power?needed/(power/1000*.92):null,reachable:power>0};
  }
  if(mode!=='export'&&mode!=='assist')return {...result,reason:'invalid-mode'};
  if(mode==='export'&&combinedSoc<=target)return {...result,reason:'target-reached',complete:true,reachable:true};
  const otherExport=g.gridExportW-g.aioDischargeW-v.acDischargeW;
  let budget=Math.max(0,this.exportLimitW-this.marginW-otherExport);
  let a=mode==='assist'?Math.max(0,g.aioDischargeW):Math.min(this.aioDischargeW,budget);
  if(g.units.some(u=>u.socPercent<=this.aioReserve))a=mode==='assist'?Math.max(0,g.aioDischargeW):0;
  // Retain energy for command/measurement lag rather than requesting full power down to reserve.
  if(mode==='export')a=Math.min(a,Math.min(...g.units.map(u=>this.aioCapacityKwh*Math.max(0,u.socPercent-this.aioReserve)/100))*3600000*.94/15);
  let b=Math.min(this.venusOutputW,Math.max(0,budget-a),this.venusCapacityKwh*Math.max(0,v.socPercent-this.venusReserve)/100*3600000*.94/15);
  if(v.socPercent<=this.venusReserve||g.aioDischargeW < -50)b=0;
  return {...result,reason:mode==='assist'?'peak-export-assistance':(a+b?'export-budgeted':'reserve-or-headroom'),aioW:mode==='assist'?0:Math.round(a),venusW:Math.round(b),reachable:mode==='assist'||a+b>0,observedAioW:mode==='assist'?a:undefined};
 }
}
class TargetState {
 constructor(file){this.file=file;this.targets={charge:100,export:20};this.intent=null;this.recovery='new';try{const saved=JSON.parse(fs.readFileSync(file));if(saved.schema!==1||!['charge','export'].every(k=>Number.isInteger(saved.targets[k])&&saved.targets[k]>=0&&saved.targets[k]<=100))throw Error('Invalid target state');this.targets=saved.targets;this.recovery=saved.intent?'interrupted-action-held':'preferences-restored';if(saved.intent)this.save();}catch(e){if(e.code!=='ENOENT')throw e;}}
 save(){const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify({schema:1,targets:this.targets,intent:this.intent}),{mode:0o600});fs.renameSync(tmp,this.file);}
 set(mode,target,{preserveIntent=false}={}){if(!['charge','export'].includes(mode)||!Number.isInteger(target)||target<0||target>100)throw Error('Invalid target');this.targets[mode]=target;if(!preserveIntent)this.intent=null;this.save();}
 start(mode,now){if(!['charge','export'].includes(mode))throw Error('Invalid action');this.intent={mode,target:this.targets[mode],deadlineMs:now+6*3600000};this.save();}
 cancel(){if(this.intent===null)return;this.intent=null;this.save();}
}
module.exports={SiteCoordinator,TargetState};
