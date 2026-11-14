'use strict';
const { EventEmitter } = require('node:events');
const { performance } = require('node:perf_hooks');
const { ChargingPolicy } = require('./charging-policy');
const {recoverRead}=require('./read-continuity');
class ShadowService extends EventEmitter {
  constructor({ readGateway, readVenus, contextProvider=()=>({}), options={}, journal, periodMs=2000, now=Date.now, monotonic=()=>performance.now(), deadlineMs=3000,planProvider=null,onUnavailable=()=>{},readRecovery=false,refreshGateway=null,continuityMs=0 }) {
    super(); if(!Number.isInteger(periodMs)||periodMs<1000||periodMs>8000)throw new Error('Shadow interval must be 1–8 seconds');
    Object.assign(this,{readGateway,readVenus,contextProvider,journal,periodMs,now,monotonic,deadlineMs,planProvider,onUnavailable,readRecovery,refreshGateway,continuityMs});
    this.policy=new ChargingPolicy(options);this.running=false;this.inFlight=null;this.timer=null;this.watchdog=null;this.generation=0;this.lastResult=null;
  }
  start() { if(this.running)return;this.running=true;this.generation++;this.cycle(); }
  async cycle() {
    const started=this.monotonic();await this.tick();if(!this.running)return;
    this.timer=setTimeout(()=>this.cycle(),Math.max(100,this.periodMs-(this.monotonic()-started)));this.timer.unref?.();
  }
  tick() {
    if(this.inFlight)return this.inFlight;
    const generation=this.generation;
    this.inFlight=this.collect(generation).finally(()=>{this.inFlight=null;});return this.inFlight;
  }
  publish(request) {
    if(request.kind==='stop')this.requestStop(request.reason);
    // Proposal journal; command execution belongs to the control session.
    let record;
    try { record=this.journal ? this.journal.record(request,this.now()) : {shadowOnly:true,request}; }
    catch(error){if(request.kind!=='stop')this.requestStop('journal-failure');this.policy.previous=null;this.policy.meter.last=null;this.lastResult={shadowOnly:true,request:{kind:'stop',powerW:0,reason:'journal-failure',dryRun:true,leaseUntilMs:this.now()},error:error.message};this.emit('decision',this.lastResult);return;}
    this.lastResult=record;this.emit('decision',record);
  }
  requestStop(reason){
    if(this.stopActionPending)return this.stopAction;
    this.stopActionPending=true;
    this.emit('continuity',{at:this.now(),phase:'stop-requested',reason});
    const action=Promise.resolve().then(()=>this.onUnavailable()).then(outcome=>{
      const at=this.now();
      this.emit('continuity',{at,phase:'stop-action-result',reason,outcome:outcome??null});
      if(outcome?.venus?.wasActive&&!this.pendingMeasuredStop)this.pendingMeasuredStop={requestedAt:at};
      return outcome;
    }).catch(error=>{if(!this.pendingMeasuredStop)this.pendingMeasuredStop={requestedAt:this.now()};this.emit('continuity',{at:this.now(),phase:'stop-action-unresolved',reason,error:error.message});});
    this.stopAction=action.finally(()=>{this.stopActionPending=false;});
    return this.stopAction;
  }
  observeStop(venus){
    if(this.pendingMeasuredStop&&venus.observedAtMs>=this.pendingMeasuredStop.requestedAt&&venus.observedAtMs<=this.now()&&this.now()-venus.observedAtMs<=(this.continuityMs||6000)&&Number.isFinite(venus.acDischargeW)&&Math.abs(venus.acDischargeW)<=50){this.emit('continuity',{at:this.now(),phase:'stop-measured',observedAtMs:venus.observedAtMs,observedVenusW:venus.acDischargeW});this.pendingMeasuredStop=null;}
  }
  readFailure(request){
    const age=this.lastObservationAt===undefined?Infinity:this.now()-this.lastObservationAt;
    if(this.continuityMs>0&&age>=0&&age<this.continuityMs&&request.transient!==false){
      this.emit('continuity',{at:this.now(),phase:'observation-delayed',reason:request.reason,ageMs:age,error:request.error});
      this.publish({...request,kind:'wait',reason:'observation-delayed',powerW:0,leaseUntilMs:this.now()});return;
    }
    this.publish(request);
  }
  async collect(generation) {
    let timedOut=false;const readEvidence=[],pending=new Set(['gateway','venus']),deadline=this.monotonic()+this.deadlineMs;
    const observationAge=Number.isFinite(this.lastObservationAt)?this.now()-this.lastObservationAt:null;
    const expired=this.continuityMs>0&&observationAge!==null&&observationAge>=this.continuityMs;
    // Stop expired authority immediately, but let recovery collect new evidence.
    // Reusing the exhausted safety deadline here would permanently reject all reads.
    if(expired)this.readFailure({kind:'stop',powerW:0,reason:'observation-expired',dryRun:true,leaseUntilMs:this.now()});
    const collectionBudget=this.continuityMs>0&&observationAge!==null&&!expired?Math.min(this.deadlineMs,Math.max(1,this.continuityMs-observationAge)):this.deadlineMs;
    this.watchdog=setTimeout(()=>{timedOut=true;if(generation===this.generation)this.readFailure({kind:'stop',powerW:0,reason:'collection-timeout',pendingSources:[...pending],readEvidence:[...readEvidence],dryRun:true,leaseUntilMs:this.now()});},collectionBudget);
    try {
      // Different endpoints may be read in parallel; only one cycle is in flight.
      const read=(source,fn)=>recoverRead(fn,{source,deadline,enabled:this.readRecovery,monotonic:this.monotonic,valid:()=>!timedOut&&generation===this.generation,onEvent:event=>{readEvidence.push(event);if(event.phase!=='read-ok')this.emit('continuity',{at:this.now(),...event});}}).then(value=>{if(source==='venus')void Promise.resolve(this.stopAction).then(()=>{if(generation===this.generation)this.observeStop(value);});return value;}).finally(()=>pending.delete(source));
      const gatewayRead=read('gateway',this.readGateway).catch(error=>{if(this.contextProvider(this.now()).priorityControlEnabled)return {unavailable:true,error:error.message};throw error;});
      const results=await Promise.allSettled([gatewayRead,read('venus',this.readVenus)]);
      if(timedOut||generation!==this.generation)return;
      const failure=results.find(result=>result.status==='rejected');
      if(failure)throw failure.reason;
      // The collection deadline covers reads. Control has its own revocable lease.
      clearTimeout(this.watchdog);this.watchdog=null;
      let [gateway,venus]=results.map(result=>result.value);
      if(this.refreshGateway)gateway=this.refreshGateway();
      if(this.stopActionPending||this.pendingMeasuredStop)this.emit('observation',{gateway,venus,nowMs:this.now(),context:this.contextProvider(this.now())});
      if(this.stopActionPending){this.publish({kind:'wait',powerW:0,reason:'continuity-stop-pending',dryRun:true,leaseUntilMs:this.now(),readEvidence,observedVenusW:venus.acDischargeW});return;}
      await this.stopAction;
      if(generation!==this.generation)return;
      if(this.pendingMeasuredStop){
        this.observeStop(venus);
        if(this.pendingMeasuredStop){this.publish({kind:'wait',powerW:0,reason:'continuity-awaiting-stop',dryRun:true,leaseUntilMs:this.now(),readEvidence,observedVenusW:venus.acDischargeW});return;}
      }
      const nowMs=this.now(),context=this.contextProvider(nowMs);
      if(this.continuityMs>0&&gateway?.unavailable&&!gateway.identityFault&&!require('./priority-policy').scheduledWindow(context,nowMs)){
        this.readFailure({kind:'stop',powerW:0,reason:'gateway-observation-unavailable',transient:true,error:gateway.error||'Gateway temporarily unavailable',dryRun:true,leaseUntilMs:nowMs});return;
      }
      this.lastObservationAt=Math.min(gateway?.unavailable?nowMs:require('./observation-clock').meterProgressAt(gateway,context,nowMs)??nowMs,venus.observedAtMs??nowMs);
      this.emit('sample',{gateway,venus,nowMs,context});
      if(this.planProvider){const site=await this.planProvider({gateway,venus,nowMs,context});if(generation!==this.generation)return;this.publish({kind:'request',powerW:site?.venusW||0,leaseUntilMs:site?.leaseUntilMs??nowMs,reason:site?.reason||'site-unavailable',dryRun:true,readEvidence,observedVenusW:venus.acDischargeW,observedAioW:gateway.aioDischargeW,observedIndividualAioW:gateway.individualAioDischargeW,aioPowerSource:gateway.aioPowerSource,observedGridExportW:gateway.gridExportW,aioReadEvidence:context.aioEvidence?{...context.aioEvidence}:null,gatewayObservedAtMs:gateway.observedAtMs,meterObservedAtMs:gateway.meterObservedAtMs,gatewayUnavailableReason:gateway.error||null,venusObservedAtMs:venus.observedAtMs,sitePlan:site});}
      else this.publish(this.policy.step({gateway,venus,nowMs,context}));
    }catch(error){if(!timedOut&&generation===this.generation){const transient=require('./read-continuity').retryable(error),request={kind:'stop',powerW:0,reason:'read-or-context-failure',transient,error:error.message,readSource:error.readSource||null,readEvidence,dryRun:true,leaseUntilMs:this.now()};if(expired&&transient)this.publish({...request,kind:'wait',reason:'recovery-read-failed'});else this.readFailure(request);}}
    finally{clearTimeout(this.watchdog);this.watchdog=null;}
  }
  stop() {this.running=false;this.generation++;clearTimeout(this.timer);clearTimeout(this.watchdog);this.policy.previous=null;this.policy.meter.last=null;}
}
module.exports={ShadowService};
