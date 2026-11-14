'use strict';
class ProposalGuard{
 constructor(){this.last=null;this.sequence=0;}
 apply(plan,sample){
 let {nowMs,gateway:g,venus:v}=sample;
 if(g)g={...g,observedAtMs:require('./observation-clock').meterProgressAt(g,sample.context,nowMs)};
 if(plan.evidenceKind==='scheduled-battery'){if(!require('./priority-policy').scheduledEvidence(plan,{...sample,nowMs})){this.last=null;return {...plan,aioW:0,venusW:0,leaseUntilMs:nowMs};}g={observedAtMs:plan.aioObservedAtMs};}const zero=reason=>{this.last=null;return {...plan,aioW:0,venusW:0,reason,shadowOnly:true,leaseUntilMs:nowMs,sequence:++this.sequence};};
 if(!Number.isFinite(nowMs)||!g||!v)return zero('guard-invalid');
 if(this.last&&(nowMs<this.last.now||g.observedAtMs<this.last.g||v.observedAtMs<this.last.v))return zero('guard-time-regression');
 if(!plan.aioW&&!plan.venusW)return zero(plan.reason);
 if(plan.leaseUntilMs<=nowMs||plan.combinedSoc===null)return zero(plan.reason);
 if(this.last&&nowMs<this.last.plan.leaseUntilMs&&((plan.evidenceKind!=='scheduled-battery'&&g.observedAtMs===this.last.g)||v.observedAtMs===this.last.v))return {...this.last.plan,aioW:(plan.aioW*this.last.plan.aioW<0?0:Math.sign(plan.aioW))*Math.min(Math.abs(plan.aioW),Math.abs(this.last.plan.aioW)),venusW:(plan.venusW*this.last.plan.venusW<0?0:Math.sign(plan.venusW))*Math.min(Math.abs(plan.venusW),Math.abs(this.last.plan.venusW)),reason:'guard-await-fresh-pair'};
 const active=this.last&&nowMs<this.last.plan.leaseUntilMs?this.last.plan:null;
 // Immediate reductions, slow increases, and no charge/discharge direction jump.
 const gate=(desired,prior)=>{if(!Number.isFinite(desired))return 0;if(prior*desired<0)return 0;return Math.sign(desired)*Math.min(Math.abs(desired),Math.abs(prior)+300);};
 const result={...plan,aioW:sample.intent?plan.aioW:gate(plan.aioW,active?.aioW||0),venusW:gate(plan.venusW,active?.venusW||0),sequence:++this.sequence,shadowOnly:true};
 this.last={now:nowMs,g:g.observedAtMs,v:v.observedAtMs,plan:result};return result;
 }
}
module.exports={ProposalGuard};
