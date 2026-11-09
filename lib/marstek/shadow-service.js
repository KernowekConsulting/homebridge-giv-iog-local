'use strict';
const { EventEmitter } = require('node:events');
const { performance } = require('node:perf_hooks');
const { ChargingPolicy } = require('./charging-policy');
class ShadowService extends EventEmitter {
  constructor({ readGateway, readVenus, contextProvider=()=>({}), options={}, journal, periodMs=2000, now=Date.now, monotonic=()=>performance.now(), deadlineMs=3000,planProvider=null,onUnavailable=()=>{} }) {
    super(); if(!Number.isInteger(periodMs)||periodMs<1000||periodMs>5000)throw new Error('Shadow interval must be 1–5 seconds');
    Object.assign(this,{readGateway,readVenus,contextProvider,journal,periodMs,now,monotonic,deadlineMs,planProvider,onUnavailable});
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
    if(request.kind==='stop')Promise.resolve().then(()=>this.onUnavailable()).catch(()=>{});
    // Proposal journal; command execution belongs to the control session.
    let record;
    try { record=this.journal ? this.journal.record(request,this.now()) : {shadowOnly:true,request}; }
    catch(error){this.policy.previous=null;this.policy.meter.last=null;this.lastResult={shadowOnly:true,request:{kind:'stop',powerW:0,reason:'journal-failure',dryRun:true,leaseUntilMs:this.now()},error:error.message};this.emit('decision',this.lastResult);return;}
    this.lastResult=record;this.emit('decision',record);
  }
  async collect(generation) {
    let timedOut=false;
    this.watchdog=setTimeout(()=>{timedOut=true;if(generation===this.generation)this.publish({kind:'stop',powerW:0,reason:'collection-timeout',dryRun:true,leaseUntilMs:this.now()});},this.deadlineMs);
    try {
      // Different endpoints may be read in parallel; only one cycle is in flight.
      const results=await Promise.allSettled([this.readGateway(),this.readVenus()]);
      if(timedOut||generation!==this.generation)return;
      const failure=results.find(result=>result.status==='rejected');
      if(failure)throw failure.reason;
      const [gateway,venus]=results.map(result=>result.value);
      const nowMs=this.now(),context=this.contextProvider(nowMs);
      this.emit('sample',{gateway,venus,nowMs,context});
      if(this.planProvider){const site=await this.planProvider({gateway,venus,nowMs,context});this.publish({kind:'request',powerW:site?.venusW||0,leaseUntilMs:site?.leaseUntilMs??nowMs,reason:site?.reason||'site-unavailable',dryRun:true,sitePlan:site});}
      else this.publish(this.policy.step({gateway,venus,nowMs,context}));
    }catch(error){if(!timedOut&&generation===this.generation)this.publish({kind:'stop',powerW:0,reason:'read-or-context-failure',error:error.message,dryRun:true,leaseUntilMs:this.now()});}
    finally{clearTimeout(this.watchdog);this.watchdog=null;}
  }
  stop() {this.running=false;this.generation++;clearTimeout(this.timer);clearTimeout(this.watchdog);this.policy.previous=null;this.policy.meter.last=null;}
}
module.exports={ShadowService};
