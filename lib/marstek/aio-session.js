'use strict';
// Adapter into established 4.1.3 acquisition/restoration; never writes Gateway.
class AioSession {
 constructor(platform,{qualified=false,now=Date.now}={}){Object.assign(this,{platform,qualified,now});this.generation=0;this.owner=null;this.mode=null;this.acquiredW=0;this.tail=Promise.resolve();}
 revoke(){this.generation++;return this.enqueue(()=>this.cleanup());}
 enqueue(fn){const job=this.tail.then(fn);this.tail=job.catch(()=>{});return job;}
 async cleanup(){if(!this.owner)return;const owner=this.owner;await this.platform.cleanupApplianceCommandFamily(this.mode,'Marstek action ended',owner.id,true);this.owner=null;this.mode=null;this.acquiredW=0;}
 apply(plan,sample,intent){const generation=this.generation;return this.enqueue(async()=>{
  if(!this.qualified){await this.cleanup();return {status:'commissioning-required'};}
  const p=this.platform,valid=()=>generation===this.generation&&plan?.leaseUntilMs>this.now()&&sample.gateway?.observedAtMs<=this.now()&&this.now()-sample.gateway.observedAtMs<6000;
  const mode=intent?.mode;
  if(!intent||!['charge','export'].includes(mode)||!valid()||!plan.reachable||plan.complete||!plan.aioW){await this.cleanup();return {status:'idle'};}
  if(!p.applianceControl.masterGateSatisfied||!p.applianceControl.features[mode==='charge'?'chargeTiles':'exportTiles'])throw Error('AIO feature disabled');
  if(this.owner&&p.currentControlOwner(this.mode)?.id!==this.owner.id){this.owner=null;this.mode=null;throw Error('AIO owner changed');}
  if(this.owner&&this.mode===mode){if(Math.abs(plan.aioW)<this.acquiredW){await this.cleanup();return {status:'allowance-reduced'};}return {status:'owned'};}
  if(this.owner)await this.cleanup();
  if(p.currentControlOwner('charge')||p.currentControlOwner('export')||p.currentControlOwner('pause'))throw Error('AIO is controlled elsewhere');
  try{await p.withManualChargeTransportGate('Marstek percentage action',async()=>{
   if(!valid())throw Error('AIO action revoked');p.marstekActivationGuard=valid;
   try{const options={label:mode==='charge'?'Marstek Charge To':'Marstek Export To',endDate:new Date(Math.min(intent.deadlineMs,this.now()+3600000)),targetSoc:100,exportTargetSoc:sample.context?.aioReserve??20};
    if(mode==='charge'){const ratedW=(p.applianceControl.maxBatteryChargePowerKw||6)*1000;const percent=Math.floor(Math.abs(plan.aioW)/ratedW*100);if(percent<1)throw Error('AIO charging allowance below supported step');options.powerPercent=Math.min(100,percent);}
    if(mode==='charge')await p.startTimedChargeCommand({kind:'marstek-charge',minutes:60},options);
    else await p.startTimedExportCommand({kind:'marstek-export',minutes:60},{...options,powerKw:Math.abs(plan.aioW)/1000});
    this.owner=p.currentControlOwner(mode);this.mode=mode;this.acquiredW=Math.abs(plan.aioW);
   }finally{p.marstekActivationGuard=null;}
  });if(!valid()){await this.cleanup();throw Error('AIO action revoked after acquisition');}return {status:'owned'};
  }catch(error){const owner=p.currentControlOwner(mode);if(owner?.source===(mode==='charge'?'Marstek Charge To':'Marstek Export To')){this.owner=owner;this.mode=mode;await this.cleanup();}throw error;}
 });}
}
module.exports={AioSession};
