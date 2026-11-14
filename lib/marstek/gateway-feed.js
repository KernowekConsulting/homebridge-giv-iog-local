'use strict';
const {DirectLocalReadOnlyClient}=require('../direct-modbus-client');
const {fresh}=require('./priority-policy');
const signed=n=>n>32767?n-65536:n;
// Background collector: transport recovery may complete without holding Venus
// collection open. Every group retains its own original request timestamp.
class GatewayFeed{
 constructor(options,{now=Date.now,onEvidence=()=>{},metricsFile=null,canPoll=()=>true,aioEvidenceProvider=()=>null,client}={}){
  Object.assign(this,{options,now,onEvidence,metricsFile,canPoll,aioEvidenceProvider});this.metrics={startedAtMs:now(),serial:options.serial,counts:{},durationTotalsMs:{},last:null};this.groups=new Map();this.running=false;
  this.client=client||new DirectLocalReadOnlyClient({host:options.host,port:options.port??8899,expectedSerial:options.serial,deviceAddress:17,
   givLeaseOptions:()=>({priority:20,deadline:Date.now()+6000}),enableGracefulContinuity:true,onGracefulContinuityEvent:e=>this.record({kind:'transport-recovery',...e}),onTransportEvent:e=>this.record({kind:'transport',...e})});
 }
 record(e){const key=[e.kind,e.phase??e.base??e.reason,e.result??''].join(':');if(e.result==='fail')this.metrics.recentFailures=[...(this.metrics.recentFailures||[]),{atMs:this.now(),...e}].slice(-16);this.metrics.counts[key]=(this.metrics.counts[key]??0)+1;if(Number.isFinite(e.elapsedMs))this.metrics.durationTotalsMs[key]=(this.metrics.durationTotalsMs[key]??0)+e.elapsedMs;this.metrics.last={atMs:this.now(),...e};try{this.onEvidence(e);if(this.metricsFile&&(!this.lastSaved||this.now()-this.lastSaved>=30000)){const fs=require('node:fs');fs.writeFileSync(this.metricsFile+'.tmp',JSON.stringify(this.metrics),{mode:0o600});fs.renameSync(this.metricsFile+'.tmp',this.metricsFile);this.lastSaved=this.now();}}catch{ /* Keep evidence failure separate from control. */ }}
 async read(base,count){const at=this.now();if(!this.canPoll())throw Error('AIO transport quiet window');try{const r=await this.client.readInputRegisters(base,count);
  if(r.inverterSerial!==this.options.serial||r.deviceAddress!==17||r.transparentFunction!==4||r.baseRegister!==base||r.values?.length!==count||!r.values.every(n=>Number.isInteger(n)&&n>=0&&n<=65535))throw Error('Gateway group identity/range mismatch');
  const observedAtMs=r.requestSentAtMs??at;if(!Number.isFinite(observedAtMs)||observedAtMs<at||observedAtMs>this.now())throw Error('Gateway observation timestamp invalid');
  const group={observedAtMs,values:r.values};(this.collecting||this.groups).set(base,group);if(base===1616)this.meterSample=group;if(base===1700)this.topologySample=group;if(base===1700){const c=(this.options.topologyEncoding??'owner-enum')==='owner-enum'?r.values[0]+1:r.values[0];this.knownCount=c>=1&&c<=3&&r.values[1]===c?c:null;}this.record({kind:'group-read',base,elapsedMs:this.now()-at,result:'ok'});
 }catch(e){if(/identity\/range/.test(e.message)){this.groups.clear();this.collecting?.clear();this.meterSample=null;this.topologySample=null;this.knownCount=null;this.identityFault=true;}this.record({kind:'group-read',base,elapsedMs:this.now()-at,result:'fail',error:e.message});throw e;}}
 async tick(){if(this.inFlight)return this.inFlight;this.inFlight=(async()=>{
  if(!this.canPoll()){this.record({kind:'deferred',reason:'aio-quiet-window'});return;}
  this.collecting=new Map(this.groups);
  // Topology changes invalidate membership; refresh before publishing a new set.
  await this.read(1616,3);await this.read(1700,3);const a=this.aioEvidenceProvider();if(!(this.knownCount===1&&a?.singleAio===true&&a.identityVerified===true&&fresh(a,this.now(),30000)&&Number.isFinite(a.socPercent)&&a.socPercent>=0&&a.socPercent<=100))await this.read(1800,20);this.groups=this.collecting;this.identityFault=false;
 })().finally(()=>{this.collecting=null;this.inFlight=null;});return this.inFlight;}
 start(){if(this.running)return;this.running=true;const cycle=async()=>{const started=this.now();try{await this.tick();}catch{}if(this.running){this.timer=setTimeout(cycle,Math.max(100,2000-(this.now()-started)));this.timer.unref?.();}};void cycle();}
 snapshot({aioEvidence:a}={}){if(this.identityFault){const e=Error('Gateway identity/range mismatch');e.identityFault=true;throw e;}const now=this.now(),t=this.groups.get(1700),m=this.groups.get(1616),u=this.groups.get(1800);
  // For a confirmed single AIO, its existing verified poll supplies SOC.
  // AC output remains Gateway IR1702; direct battery watts are not substituted. The site meter remains a real, independently fresh Gateway read.
  if(this.knownCount===1&&a?.singleAio===true&&a.identityVerified===true&&fresh(a,now,30000)&&Number.isFinite(a.socPercent)&&a.socPercent>=0&&a.socPercent<=100&&Number.isFinite(a.acDischargeW)&&fresh(this.meterSample,now,6000)&&fresh(this.topologySample,now,30000)){const meter=this.meterSample,ac=-signed(this.topologySample.values[2]);return {serial:this.options.serial,observedAtMs:Math.min(meter.observedAtMs,this.topologySample.observedAtMs,a.observedAtMs),meterObservedAtMs:meter.observedAtMs,unitsObservedAtMs:a.observedAtMs,completedAtMs:now,onlineCount:1,units:[{slot:1,socPercent:a.socPercent,acDischargeW:ac}],gridExportW:signed(meter.values[0]),solarW:meter.values[1],householdLoadW:meter.values[2],aioDischargeW:ac,individualAioDischargeW:ac,aioPowerSource:'IR1702',batteryEvidenceSource:'aio',siteMeterSource:'gateway'};}
  if(!fresh(t,now,6000)||!fresh(m,now,6000)||!fresh(u,now,6000)||Math.max(t.observedAtMs,m.observedAtMs,u.observedAtMs)-Math.min(t.observedAtMs,m.observedAtMs,u.observedAtMs)>2500){this.record({kind:'snapshot-rejected',reason:!t||!m||!u?'missing-groups':!fresh(t,now,6000)||!fresh(m,now,6000)||!fresh(u,now,6000)?'stale-groups':'group-skew',agesMs:[t,m,u].map(x=>x?now-x.observedAtMs:null)});throw Error('Gateway groups unavailable or stale');}
  const count=(this.options.topologyEncoding??'owner-enum')==='owner-enum'?t.values[0]+1:t.values[0];
  if(count<1||count>3||t.values[1]!==count)throw Error('Gateway topology incomplete');
  const units=Array.from({length:count},(_,i)=>({slot:i+1,socPercent:u.values[1+i],acDischargeW:-signed(u.values[16+i])}));
  if(units.some(x=>x.socPercent>100))throw Error('Invalid Gateway SOC');
  return {serial:this.options.serial,observedAtMs:Math.min(t.observedAtMs,m.observedAtMs,u.observedAtMs),meterObservedAtMs:m.observedAtMs,unitsObservedAtMs:u.observedAtMs,topologyObservedAtMs:t.observedAtMs,completedAtMs:now,
   onlineCount:count,rawConfigured:t.values[0],units,gridExportW:signed(m.values[0]),solarW:m.values[1],householdLoadW:m.values[2],aioDischargeW:-signed(t.values[2]),aioPowerSource:'IR1702',individualAioDischargeW:units.reduce((s,x)=>s+x.acDischargeW,0)};
 }
 stop(){this.running=false;clearTimeout(this.timer);}
}
module.exports={GatewayFeed};
