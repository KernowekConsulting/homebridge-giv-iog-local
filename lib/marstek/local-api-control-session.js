'use strict';
const {LocalApiClient}=require('./local-api-client');
class LocalApiControlSession{
 constructor(device,{qualified=false,now=Date.now,client=new LocalApiClient({host:device.host,port:device.apiPort??30000}),checkpoint=()=>{},onEvidence=()=>{},currentContext=()=>null}={}){Object.assign(this,{device,qualified,now,client,checkpoint,onEvidence,currentContext});this.timed=typeof client.setTimedPower==='function'?new (require('./timed-action').TimedAction)(client,{now,checkpoint}):null;this.command=0;this.activeAttempt=false;this.externalHeld=false;this.uncertain=false;this.generation=0;this.lease=0;this.tail=Promise.resolve();this.stopped=false;this.status='commissioning-required';this.lastPair=null;this.lastClock=this.now();this.timer=setInterval(()=>{const now=this.now(),backwards=now<this.lastClock;this.lastClock=now;let authorityLost=false;try{authorityLost=Boolean(this.activeValid&&!this.activeValid());}catch{authorityLost=true;}if(this.lease&&(now>=this.lease||backwards||authorityLost)){this.lease=0;void this.revoke(backwards?'clock-regression':authorityLost?'authority-changed':'lease-expired').catch(()=>{});}},250);this.timer.unref?.();}
 enqueue(fn){const job=this.tail.then(fn);this.tail=job.catch(()=>{});return job;}
 evidence(e){try{this.onEvidence({at:this.now(),...e});}catch{}}
 revoke(reason='revoked'){this.generation++;this.lease=0;return this.enqueue(()=>this.stop(reason));}
 apply(plan,{gateway,venus,context={},tokenValid=()=>true}={}){const generation=this.generation;return this.enqueue(async()=>{
  if(!this.qualified||this.stopped||this.externalHeld)return {status:this.status};
  if(this.timed&&this.uncertain&&venus?.deviceMode==='Passive'&&Number.isFinite(venus.observedAtMs)&&venus.observedAtMs<=this.now()&&this.now()-venus.observedAtMs<30000&&Number.isFinite(venus.acDischargeW)&&Math.abs(venus.acDischargeW)<=30){this.command=0;this.activeAttempt=false;this.uncertain=false;this.lease=0;this.timed.active=null;this.checkpoint(null);this.status='stop-measured';this.evidence({phase:'venus-stop-reconciled',observedAtMs:venus.observedAtMs,observedW:venus.acDischargeW});}
  if(this.timed&&!context.automationHold&&!context.emergencyStop&&!context.externalOwner&&venus?.deviceMode!=='Passive'){
   // Explicitly enabled/qualified control owns the mode, including native Manual schedules.
   this.activeAttempt=true;
   try{await this.timed.stop();this.externalHeld=false;this.command=0;this.activeAttempt=false;this.uncertain=false;return {status:this.status='takeover-confirmed-await-fresh-observation'};}
   catch(error){this.uncertain=true;return {status:this.status='takeover-unconfirmed',error:error.message};}
  }
  if(this.timed&&context.localApiTimed&&(plan?.controlKind||['charge-budgeted','export-budgeted','eco-house-support','peak-export-assistance'].includes(plan?.reason))){
   const now=this.now(),fresh=x=>x&&Number.isFinite(x.observedAtMs)&&x.observedAtMs<=now&&now-x.observedAtMs<30000;
   const valid=()=>{const c=this.currentContext()||context;return generation===this.generation&&!this.stopped&&tokenValid()&&!c.automationHold&&!c.emergencyStop&&!c.externalOwner&&!(plan.venusW>0&&c.iogEnabled&&(c.iogActive||!require('./priority-policy').iogCurrent(c,this.now())));};
   const percentage=plan.controlKind==='percentage'||['charge-budgeted','export-budgeted'].includes(plan.reason);
   if(!valid()||!fresh(gateway)||!fresh(venus)||(percentage&&(!Number.isFinite(plan.actionEndAtMs)||!Number.isFinite(plan.targetSoc)))){await this.stop('percentage-evidence-unavailable');return {status:this.status};}
   const raw=Math.trunc(plan.venusW/50)*50,power=raw>0?Math.min(raw,this.device.maxDischargeW):-Math.min(-raw,this.device.maxChargeW);
   if(!power){await this.stop('percentage-no-headroom');return {status:this.status};}
   if(this.command*power<0){await this.stop('percentage-direction-change');return {status:this.status};}
   const gap=Math.abs(plan.targetSoc-plan.combinedSoc),energy=percentage?gap*plan.totalCapacityKwh/100:plan.availableKwh,totalPower=Math.abs(plan.aioW)+Math.abs(power);
   const estimate=energy*3600000000/Math.max(1,totalPower)*(power<0?1/.92:.94);
   const end=Math.min(percentage?plan.actionEndAtMs:now+120000,now+120000,now+Math.max(1000,estimate));
   if(this.timed.active?.power===power&&this.timed.active.endAtMs<=end&&this.timed.active.endAtMs-now>15000)return {status:this.status='timed-action-running'};
   this.activeAttempt=true;this.activeValid=valid;this.lease=end;
   try{const result=await this.timed.set(power,end,{valid});this.command=power;return {status:this.status=result.status,...result};}
   catch(error){this.uncertain=true;await this.stop('percentage-command-unconfirmed');return {status:this.status,error:error.message};}
  }
  if(this.timed&&plan?.evidenceKind==='scheduled-battery'){
   const policy=require('./priority-policy'),w=policy.scheduledWindow(context,this.now());
   const valid=()=>{const c=this.currentContext()||context,current=policy.scheduledWindow(c,this.now());return generation===this.generation&&!this.stopped&&tokenValid()&&!c.emergencyStop&&!c.automationHold&&!c.externalOwner&&current?.valid&&current.charge&&!current.suppressed&&current.end===w?.end&&current.target===w?.target;};
   const evidence=policy.scheduledEvidence(plan,{gateway,venus,context:{...context,localApiTimed:true},nowMs:this.now()});
   if(!valid()||!evidence||!w?.charge||plan.venusW>=0){await this.stop('scheduled-transition');return {status:this.status};}
   if(venus.deviceMode!=='Passive'){this.externalHeld=true;return {status:this.status='external-control-owner'};}
   const desired=-Math.min(this.device.maxChargeW,Math.abs(plan.venusW));
   if(this.timed.active?.power===desired&&this.timed.active.endAtMs<=w.end&&this.timed.active.endAtMs-this.now()>30000)return {status:this.status='timed-action-running'};
   this.activeAttempt=true;this.activeValid=valid;this.lease=Math.min(w.end,this.now()+120000);
   try{const result=await this.timed.set(desired,this.lease,{valid});this.command=desired;return {status:this.status=result.status,...result};}
   catch(error){this.uncertain=true;await this.stop('timed-command-unconfirmed');return {status:this.status,error:error.message};}
  }
  if(this.timed&&context.localApiTimed){await this.stop('no-timed-authority');return {status:this.status};}
  const valid=()=>generation===this.generation&&!this.stopped&&tokenValid()&&Number.isFinite(plan?.leaseUntilMs)&&this.now()<plan.leaseUntilMs;
  const fresh=plan?.evidenceKind==='scheduled-battery'?require('./priority-policy').scheduledEvidence(plan,{gateway,venus,context,nowMs:this.now()}):[gateway,venus].every(x=>x&&Number.isFinite(x.observedAtMs)&&x.observedAtMs<=this.now()&&this.now()-x.observedAtMs<6000);
  let desired=valid()&&fresh&&Number.isFinite(plan.venusW)?Math.trunc(plan.venusW/50)*50:0;
  desired=desired>0?Math.min(desired,this.device.maxDischargeW):-Math.min(-desired,this.device.maxChargeW);
  if(!desired||this.uncertain||!valid()){await this.stop(plan?.reason||'invalid-plan');return {status:this.status};}
  if(venus.deviceMode!=='Passive'){this.externalHeld=true;return {status:this.status='external-control-owner'};}
  if(this.lastPair&&((plan.evidenceKind!=='scheduled-battery'&&gateway.observedAtMs===this.lastPair.g)||venus.observedAtMs===this.lastPair.v))return {status:'await-fresh-pair'};
  this.lease=plan.leaseUntilMs;
  try{
   if(this.command*desired<0){await this.stop();return {status:this.status='waiting-for-zero'};}
   this.checkpoint({active:true,requestedW:desired,transport:'local-api'});this.activeAttempt=true;
   const reply=await this.client.setPower(desired,{valid,expiresAtMs:plan.leaseUntilMs});
   if(reply.result.set_result!==true||!valid())throw Error('Venus Local API command unconfirmed');
   this.command=desired;this.lastPair={g:gateway?.observedAtMs,v:venus.observedAtMs};
   return {status:this.status='api-command-acknowledged',requestedW:desired,effectConfirmed:Math.sign(venus.acDischargeW)===Math.sign(desired)&&Math.abs(venus.acDischargeW)>50};
  }catch(error){this.uncertain=true;this.status='command-uncertain';await this.stop();return {status:this.status,error:error.message};}
 });}
 async stop(reason='transition'){this.activeValid=null;if(!this.qualified||this.stopped||this.externalHeld||!this.command&&!this.activeAttempt&&!this.uncertain)return;
  this.evidence({phase:'venus-stop-requested',reason,requestedW:this.command});
  if(this.timed&&(this.timed.active||this.activeAttempt)){try{const r=await this.timed.stop();this.command=0;this.activeAttempt=false;this.uncertain=false;this.lease=0;this.status='stop-measured';this.stopEvidence={at:this.now(),observedW:r.observedW,kind:'measured-ac-power'};return;}catch(error){this.uncertain=true;this.status='stop-unconfirmed';return;}}
  const end=this.now()+8000,valid=()=>!this.stopped&&this.now()<end;
  try{const ack=await this.client.setPower(0,{valid,countdownS:1,expiresAtMs:end,priority:100});if(ack.result.set_result!==true)throw Error('Venus API stop rejected');const reading=await this.client.getMode({valid,expiresAtMs:end,priority:100});if(!Number.isFinite(reading.result.ongrid_power)||Math.abs(reading.result.ongrid_power)>50)throw Error('Venus API stop not measured');this.stopEvidence={at:this.now(),observedW:reading.result.ongrid_power,kind:'measured-ac-power'};this.command=0;this.activeAttempt=false;this.uncertain=false;this.lastPair=null;this.lease=0;this.checkpoint(null);this.status='stop-measured';this.evidence({phase:'venus-stop-result',reason,status:this.status,observedW:reading.result.ongrid_power});}catch(error){this.uncertain=true;this.status='stop-unconfirmed';this.evidence({phase:'venus-stop-result',reason,status:this.status,error:error.message});}
 }
 async close(){clearInterval(this.timer);this.generation++;await this.enqueue(()=>this.stop());this.stopped=true;this.client.close();}
}
module.exports={LocalApiControlSession};
