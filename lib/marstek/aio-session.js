'use strict';
// Adapter into established 4.1.3 acquisition/restoration; never writes Gateway.
class AioSession {
 constructor(platform,{qualified=false,now=Date.now,onFault=()=>{}}={}){Object.assign(this,{platform,qualified,now,onFault});this.generation=0;this.owner=null;this.mode=null;this.acquiredW=0;this.tail=Promise.resolve();this.transportActive=false;this.phase='idle';this.interruptedOwners=['charge','export'].map(family=>({family,owner:platform.currentControlOwner?.(family)})).filter(x=>x.owner?.source===(x.family==='charge'?'Marstek Charge To':'Marstek Export To'));}
 revoke(){this.nativeRevoked=true;this.clearNativeHold();this.generation++;return this.enqueue(()=>this.cleanup());}
 clearNativeHold(){clearInterval(this.nativeHoldTimer);this.nativeHoldTimer=null;this.nativeHoldUntil=0;}
 membershipCurrent(count){const feed=this.platform.marstek?.gatewayFeed;return !feed||!feed.identityFault&&Number.isInteger(count)&&count>=1&&count<=3&&feed.knownCount===count;}
 canRetainNative(){
  const now=this.now(),c=this.platform.marstekPolicyContext?.(now)||{},owner=this.platform.currentControlOwner?.(this.mode);
  return Boolean(!this.nativeRevoked&&this.membershipCurrent(this.nativeMemberCount)&&this.qualified&&this.owner&&owner?.id===this.owner.id&&owner.phase==='active'&&this.nativeIntent&&Number.isFinite(this.lastGoodAt)&&now>=this.lastGoodAt&&now<Math.min(this.lastGoodAt+30000,this.nativeIntent.deadlineMs,owner.endAtMs??Infinity)&&!c.emergencyStop&&!c.automationHold&&!c.externalOwner&&(!c.iogEnabled||require('./priority-policy').iogCurrent(c,now))&&!(c.iogEnabled&&c.iogActive&&(this.mode==='export'||c.iogMode!=='charge')));
 }
 holdForTelemetry(){
  if(!this.canRetainNative())return this.revoke();
  if(!this.nativeHoldUntil){this.nativeHoldUntil=Math.min(this.lastGoodAt+30000,this.nativeIntent.deadlineMs,this.owner.endAtMs??Infinity);
   this.nativeHoldTimer=setInterval(()=>{if(!this.nativeHoldUntil)return;if(this.now()>=this.nativeHoldUntil||!this.canRetainNative())void this.revoke().catch(error=>this.onFault(error));},250);this.nativeHoldTimer.unref?.();
  }
  return Promise.resolve({status:'native-continuity',until:this.nativeHoldUntil,requestedW:this.mode==='charge'?-this.acquiredW:this.acquiredW});
 }
 canRecover(){return !this.interruptedOwners.length&&!this.applying&&(!this.owner||Boolean(this.nativeHoldUntil&&this.canRetainNative()));}
 enqueue(fn){const job=this.tail.then(fn);this.tail=job.catch(()=>{});return job;}
 async cleanup(){
  this.clearNativeHold();while(!this.owner&&this.interruptedOwners.length){const saved=this.interruptedOwners.shift();if(this.platform.currentControlOwner?.(saved.family)?.id===saved.owner.id){this.owner=saved.owner;this.mode=saved.family;this.nativeRevoked=true;}}if(!this.owner)return;
  const owner=this.owner;this.phase='stopping';let last;
  // Reconcile the same owned action; never blindly repeat an activation.
  for(let attempt=1;attempt<=3;attempt++){
   try{const result=await this.platform.cleanupApplianceCommandFamily(this.mode,'Marstek action ended',owner.id,true);
    if(result&&!result.verified&&!result.superseded&&!result.noOwner)throw Error('AIO cleanup not verified');
    this.owner=null;this.mode=null;this.acquiredW=0;this.phase='idle';if(this.interruptedOwners.length)return this.cleanup();return;
   }catch(error){last=error;this.platform.log?.warn?.('[Marstek] AIO restoration attempt %s: %s',attempt,error.message);}
  }
  this.phase='stop-unconfirmed';const error=new Error('AIO restoration remains unconfirmed: '+last.message,{cause:last});error.code='AIO_STOP_UNCONFIRMED';throw error;
 }

 apply(plan,sample,intent){this.latest={plan,sample,intent};if(this.applying)return this.applying;const generation=this.generation;const job=this.enqueue(async()=>{
  if(this.interruptedOwners.length){await this.cleanup();return {status:'restart-restored'};}
  if(!this.qualified){await this.cleanup();return {status:'commissioning-required'};}
  const p=this.platform,stageDeadline=this.now()+120000,valid=()=>{const next=this.latest,c=p.marstekPolicyContext?.(this.now());return this.membershipCurrent(next?.sample?.gateway?.onlineCount)&&this.now()<stageDeadline&&(!c||!c.emergencyStop&&!c.automationHold&&!c.externalOwner&&!(intent?.mode==='export'&&c.iogEnabled&&(c.iogActive||!require('./priority-policy').iogCurrent(c,this.now()))))&& generation===this.generation&&this.qualified&&next?.intent?.mode===intent?.mode&&next?.intent?.target===intent?.target&&next?.intent?.deadlineMs===intent?.deadlineMs&&next.plan?.reachable&&!next.plan.complete&&Math.sign(next.plan.aioW)===Math.sign(plan.aioW)&&Math.abs(next.plan.aioW)>=Math.abs(plan.aioW)&&next.plan.leaseUntilMs>this.now()&&require('./observation-clock').meterProgressAt(next.sample.gateway,next.sample.context,this.now())<=this.now()&&this.now()-require('./observation-clock').meterProgressAt(next.sample.gateway,next.sample.context,this.now())<(next.sample.context?.localApiTimed?30000:6000);};
  const mode=intent?.mode;
  if(this.nativeHoldUntil&&intent?.mode===this.nativeIntent?.mode&&intent?.target===this.nativeIntent?.target&&intent?.deadlineMs===this.nativeIntent?.deadlineMs&&['continuity-wait','continuity-stop-pending'].includes(plan.reason)){if(!this.canRetainNative()){this.generation++;await this.cleanup();return {status:'native-continuity-expired'};}return this.holdForTelemetry();}
  if(['charge','export'].includes(mode)&&!p.applianceControl.masterGateSatisfied)throw Error('AIO feature disabled');
  if(!intent||!['charge','export'].includes(mode)||!valid()||!plan.reachable||plan.complete||!plan.aioW){await this.cleanup();return {status:'idle'};}
  // Percentage actions replace the old timed tiles; hiding them is not a control veto.
  const siteEnabled=p.config?.marstekIntegrationEnabled===true&&p.config?.marstekControlEnabled===true&&p.config?.marstekSitePreviewEnabled===true;
  if(!p.applianceControl.masterGateSatisfied||(!siteEnabled&&!p.applianceControl.features[mode==='charge'?'chargeTiles':'exportTiles']))throw Error('AIO feature disabled');
  if(this.owner&&p.currentControlOwner(this.mode)?.id!==this.owner.id){this.owner=null;this.mode=null;throw Error('AIO owner changed');}
  if(this.owner&&this.mode===mode){this.clearNativeHold();this.nativeRevoked=false;this.lastGoodAt=Math.min(this.now(),require('./observation-clock').meterProgressAt(this.latest.sample.gateway,this.latest.sample.context,this.now()),this.latest.sample.venus?.observedAtMs??this.now());this.nativeIntent={...intent};this.nativeMemberCount=this.latest.sample.gateway.onlineCount;if(Math.abs(plan.aioW)<this.acquiredW){await this.cleanup();return {status:'allowance-reduced'};}return {status:'owned'};}
  if(this.owner)await this.cleanup();
  if(p.currentControlOwner('charge')||p.currentControlOwner('export')||p.currentControlOwner('pause'))throw Error('AIO is controlled elsewhere');
  try{await p.withManualChargeTransportGate('Marstek percentage action',async()=>{
   this.transportActive=true;this.phase='preparing';
   if(!valid()){this.transportActive=false;throw Error('AIO action revoked');}p.marstekActivationGuard=valid;
   try{const options={label:mode==='charge'?'Marstek Charge To':'Marstek Export To',endDate:new Date(Math.min(intent.deadlineMs,this.now()+3600000)),targetSoc:100,exportTargetSoc:sample.context?.aioReserve??20};
    if(mode==='charge'){const ratedW=(p.applianceControl.maxBatteryChargePowerKw||6)*1000;const percent=Math.floor(Math.abs(plan.aioW)/ratedW*100);if(percent<1)throw Error('AIO charging allowance below supported step');options.powerPercent=Math.min(100,percent);}
    if(mode==='charge')await p.startTimedChargeCommand({kind:'marstek-charge',minutes:60},options);
    else await p.startTimedExportCommand({kind:'marstek-export',minutes:60},{...options,powerKw:Math.abs(plan.aioW)/1000});
    this.owner=p.currentControlOwner(mode);this.mode=mode;this.acquiredW=Math.abs(plan.aioW);this.phase='active';this.nativeRevoked=false;this.lastGoodAt=Math.min(this.now(),require('./observation-clock').meterProgressAt(this.latest.sample.gateway,this.latest.sample.context,this.now()),this.latest.sample.venus?.observedAtMs??this.now());this.nativeIntent={...intent};this.nativeMemberCount=this.latest.sample.gateway.onlineCount;
   }finally{p.marstekActivationGuard=null;this.transportActive=false;this.gatewayReadUntilMs=this.now()+6000;}
  });if(!valid()){await this.cleanup();throw Error('AIO action revoked after acquisition');}return {status:'owned'};
  }catch(error){p.log?.warn?.('[Marstek] AIO acquisition veto: %s',JSON.stringify({error:error.message,mode,generation,currentGeneration:this.generation,qualified:this.qualified,now:this.now(),stageDeadline,requestedAioW:plan.aioW,latestPlan:this.latest?.plan,latestIntent:this.latest?.intent,gateway:this.latest?.sample?.gateway,venus:this.latest?.sample?.venus,context:p.marstekPolicyContext?.(this.now())}));const owner=p.currentControlOwner(mode);if(owner?.source===(mode==='charge'?'Marstek Charge To':'Marstek Export To')){this.owner=owner;this.mode=mode;try{await this.cleanup();}catch(cleanupError){cleanupError.acquisitionCause=error.message;throw cleanupError;}}if(!valid())return {status:'revoked',reason:error.message};throw error;}
 });this.applying=job;void job.finally(()=>{if(this.applying===job)this.applying=null;}).catch(()=>{});return job;}
}
module.exports={AioSession};
