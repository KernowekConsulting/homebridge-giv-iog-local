'use strict';
const fs=require('node:fs'),path=require('node:path');
const {SiteCoordinator,TargetState}=require('./site-coordinator');
const {publish,SocContinuity}=require('./homekit-continuity');
const OWNER='givhome-site-shadow-v1';
class SiteHomebridge {
 constructor(log,api,config,{now=Date.now,onInvalidate=()=>{},canControl=()=>true,canRecover=()=>true,onRefresh=()=>{},aioEvidenceProvider=()=>null}={}){Object.assign(this,{log,api,config,now,onInvalidate,canControl,canRecover,onRefresh,aioEvidenceProvider});this.cached=new Map();this.latest=null;this.socDisplay=new SocContinuity();this.aioSocDisplay=new SocContinuity();this.pending=null;this.sampleAgeMs=config.marstekTimedApi===true?30000:6000;}
 owns(a){return a.context?.siteOwner===OWNER;}
 configureAccessory(a){this.cached.set(a.UUID,a);}
 start(){
  if(!this.config.marstekSitePreviewEnabled){if(this.cached.size)this.api.unregisterPlatformAccessories?.('homebridge-giv-iog-local','GivHomeModbus',[...this.cached.values()]);return;}
  const directory=path.join(this.api.user.storagePath(),'givhome-site-preview');fs.mkdirSync(directory,{recursive:true});
  const siteSettings=require('./site-settings');
  this.authority=new (require('./action-authority').ActionAuthority)(path.join(directory,'authority.json'),siteSettings.identity(this.config),{legacyIdentityMatch:siteSettings.legacyIdentityMatches});
  this.guard=new (require('./proposal-guard').ProposalGuard)();
  this.state=new TargetState(path.join(directory,'targets.json'));
  if(['continuity-wait','restart-recovery'].includes(this.authority.state.hold))this.authority.hold('telemetry-stale');
  this.planFile=path.join(directory,'latest-plan.json');
  this.planner=new SiteCoordinator(siteSettings.settings(this.config));
  this.tiles={};const {Service:S,Characteristic:C,Perms}=this.api.hap;
  if(this.config.marstekReuseBatteryLevel){const id=this.api.hap.uuid.generate(OWNER+':soc'),old=this.cached.get(id);if(old){this.api.unregisterPlatformAccessories?.('homebridge-giv-iog-local','GivHomeModbus',[old]);this.cached.delete(id);}}
  const modes=this.config.marstekReuseBatteryLevel?['charge','export']:['soc','charge','export'];if(this.config.marstekIntegrationEnabled===true)modes.unshift('aioSoc');
  for(const mode of modes){
   const display=mode==='soc'||mode==='aioSoc',label=mode==='aioSoc'?'AIO SOC':mode==='soc'?'Combined SOC':mode==='charge'?'Charge To':'Export To';
   const uuid=this.api.hap.uuid.generate(OWNER+':'+mode),a=this.cached.get(uuid)||new this.api.platformAccessory(label,uuid);
   a.context.siteOwner=OWNER;
   const s=a.getService(S.Lightbulb)||a.addService(S.Lightbulb,a.displayName);
   if(a.context.siteNameRevision!==2){a.displayName=label;s.setCharacteristic(C.Name,label);a.getService(S.AccessoryInformation).setCharacteristic(C.Name,label);a.context.siteNameRevision=2;}
   for(const legacy of s.characteristics.filter(c=>c.UUID===C.ConfiguredName.UUID))s.removeCharacteristic(legacy);
   const on=s.getCharacteristic(C.On),level=s.getCharacteristic(C.Brightness);
   const fault=()=>{throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);};
   level.onGet(()=>{if(display){const v=mode==='aioSoc'?this.aioSocDisplay.value(this.now()):this.socLevel();if(v===null)return fault();return v;}return this.state.targets[mode];});
   on.onGet(()=>{if(display){if((mode==='aioSoc'?this.aioSocDisplay.value(this.now()):this.socLevel())===null)return fault();return true;}return this.state.intent?.mode===mode;});
   if(display){for(const c of [on,level]){c.setProps({perms:mode==='aioSoc'?[Perms.PAIRED_READ,Perms.PAIRED_WRITE,Perms.NOTIFY]:[Perms.PAIRED_READ,Perms.NOTIFY]});if(mode==='aioSoc')c.onSet(async()=>{});}}
   else {level.onSet(value=>{const target=Math.round(value);if(target===this.state.targets[mode])return;if(this.lastCompletion?.mode===mode)this.lastCompletion=null;const active=this.state.intent?.mode===mode;const fresh=this.latest&&this.now()-this.latest.at<=this.sampleAgeMs&&this.latest.result.combinedSoc!==null;if(active){this.onInvalidate();this.pending=null;this.authority.hold('target-edited');}this.state.set(mode,target,{preserveIntent:!active});if(active&&(fresh||this.socLevel()!==null)&&this.canControl()){this.token=this.authority.begin(mode,this.now());this.state.start(mode,this.now());if(!fresh)this.pauseIntent('target-edited-awaiting-readings');}this.refresh();});on.onSet(value=>{if(value){if(!this.canControl())return fault();const fresh=this.latest&&this.now()-this.latest.at<=this.sampleAgeMs&&this.latest.result.combinedSoc!==null;if(!fresh&&this.socLevel()===null)return fault();this.pending=null;this.lastCompletion=null;this.token=this.authority.begin(mode,this.now());this.state.start(mode,this.now());if(!fresh)this.pauseIntent('await-fresh-readings');}else if(this.state.intent?.mode===mode){this.onInvalidate();this.authority.hold('manual-cancel');this.state.cancel();this.pending=null;}this.refresh();});}
   if(!this.cached.has(uuid))this.api.registerPlatformAccessories('homebridge-giv-iog-local','GivHomeModbus',[a]);this.cached.set(uuid,a);this.tiles[mode]={on,level};
  }
  this.timer=setInterval(()=>{if(this.latest&&this.now()-this.latest.at>this.sampleAgeMs){this.latest=null;if(this.state.intent)this.pauseIntent('telemetry-stale');else if(this.authority.state.active){this.onInvalidate();this.authority.hold('telemetry-stale');}}this.expirePending(this.now());this.refresh();},1000);this.timer.unref?.();this.refresh();
 }
 observeAio({gateway,nowMs,context={}}){if(!this.aioSocDisplay)return;if(gateway?.identityFault){this.aioSocDisplay.clear();return;}const a=require('./priority-policy').batteryEvidence({gateway,context,nowMs});if(a)this.aioSocDisplay.remember(a.socPercent,a.observedAtMs,nowMs);}
 socLevel(now=this.now()){return this.socDisplay.value(now);}
 pauseIntent(reason){
  if(!this.state.intent||this.pending)return;
  if(this.authority.state.hold){this.onInvalidate();this.state.cancel();return;}
  this.onInvalidate({preserveNative:true});this.authority.hold('continuity-wait');this.resetContinuity();
  if(this.latest)this.latest={...this.latest,result:{...this.latest.result,aioW:0,venusW:0,reachable:false,complete:false,leaseUntilMs:this.now(),reason:'continuity-wait'}};
  this.pending={reason,until:Math.min(this.state.intent.deadlineMs,this.now()+(this.config?.marstekTimedApi===true?120000:30000)),lastPair:null,count:0,start:null};
 }
 expirePending(now){if(!this.pending)return;if(!this.state.intent){this.pending=null;return;}if(now>=this.pending.until){this.onInvalidate();this.state.cancel();if(['continuity-wait','restart-recovery'].includes(this.authority.state.hold))this.authority.hold('telemetry-stale');this.pending=null;}}
 recoverPending(sample){
  if(!this.pending)return;this.expirePending(sample.nowMs);if(!this.pending)return;
  if(this.authority.state.hold!=='continuity-wait'){this.state.cancel();this.pending=null;return;}
  const {gateway:g,venus:v,nowMs,context:c={}}=sample;
  const probe=this.planner.step({...sample,intent:null,context:{...c,ecoEnabled:false,nightActive:false,iogActive:false,exportActive:false}});
  const p=this.pending,safe=probe.combinedSoc!==null&&this.canControl()&&this.canRecover()&&!c.emergencyStop&&!c.automationHold&&!c.externalOwner&&(!c.iogEnabled||require('./priority-policy').iogCurrent(c,nowMs))&&!(this.state.intent?.mode==='export'&&c.iogEnabled&&c.iogActive);
  if(!safe){p.lastPair=null;p.count=0;p.start=null;return;}
  const pair=[require('./observation-clock').meterProgressAt(g,c,nowMs),v?.observedAtMs];
  if(!pair.every(Number.isFinite)||p.lastPair&&pair.some((t,i)=>t<p.lastPair[i])){p.lastPair=null;p.count=0;p.start=null;return;}
  if(!p.lastPair||nowMs-p.lastAt>this.sampleAgeMs){p.start=nowMs;p.count=1;p.lastPair=pair;p.lastAt=nowMs;}
  else if(pair.every((t,i)=>t>p.lastPair[i])){p.count++;p.lastPair=pair;p.lastAt=nowMs;}
  if(p.count>=3&&nowMs-p.start>=6000){this.token=this.authority.begin(this.state.intent.mode,nowMs);this.pending=null;this.resetContinuity();}
 }
 observe({gateway,venus,nowMs,context={}}){
  this.observeAio({gateway,nowMs,context});
  if(!this.planner)return;
  // Freshness only: never issue a plan, renew an output lease or complete an action here.
  const result=this.planner.step({gateway,venus,nowMs,context:{...context,ecoEnabled:false,nightActive:false,iogActive:false,exportActive:false},intent:null});
  this.socDisplay.observe({at:nowMs,result},{gateway,venus,context,nowMs});
  if(result.combinedSoc===null)return;
  this.latest={at:nowMs,result:{...result,aioW:0,venusW:0,complete:false,reachable:false,leaseUntilMs:nowMs,reason:'continuity-stop-pending'}};
  this.refresh();
 }
 sample({gateway,venus,nowMs,context={}}){
  this.observeAio({gateway,nowMs,context});
  if(!this.planner)return null;
  if(gateway?.identityFault||venus?.identityQualified===false){this.socDisplay.clear();this.pending=null;this.onInvalidate();this.state.cancel();this.authority.hold('identity-unqualified');}
  if(context.priorityControlEnabled&&context.iogEnabled&&context.iogActive&&this.state.intent?.mode==='export'){this.onInvalidate();this.state.cancel();this.pending=null;this.authority.finish();this.resetContinuity();}
  this.recoverPending({gateway,venus,nowMs,context});
  // Cancelled actions stay cancelled. Only normal operation may recover.
  const recoverable=new Set([...(this.config?.marstekTimedApi===true?['operator-hold','stop-unconfirmed','aio-stop-unconfirmed','aio-control-fault']:[]),'telemetry-stale','telemetry-unavailable','target-reached','intent-expired','manual-cancel','external-owner']);
  if(recoverable.has(this.authority.state.hold)){
   const probe=this.planner.step({gateway,venus,nowMs,context,intent:null});
   const stopRecovered=this.authority.state.hold!=='stop-unconfirmed'||venus?.deviceMode==='Passive'&&Number.isFinite(venus.acDischargeW)&&Math.abs(venus.acDischargeW)<=30;
   const safe=stopRecovered&&probe.combinedSoc!==null&&!context.externalOwner&&!context.emergencyStop&&!context.automationHold&&this.canControl()&&this.canRecover();
   const pair=[probe.evidenceKind==='scheduled-battery'?probe.aioObservedAtMs:require('./observation-clock').meterProgressAt(gateway,context,nowMs),venus?.observedAtMs];
   if(!safe||!this.recovery||nowMs-this.recovery.lastAt>this.sampleAgeMs||pair.some((t,i)=>t<this.recovery.pair[i]))this.recovery=safe?{start:nowMs,lastAt:nowMs,count:1,pair}:null;
   else if(pair[1]>this.recovery.pair[1]&&(probe.evidenceKind==='scheduled-battery'?pair[0]>=this.recovery.pair[0]:pair[0]>this.recovery.pair[0])){this.recovery={...this.recovery,lastAt:nowMs,count:this.recovery.count+1,pair};}
   if(this.recovery?.count>=3&&nowMs-this.recovery.start>=6000){this.state.cancel();this.authority.begin('default-operation-recovered',nowMs);this.authority.finish();this.resetContinuity();this.recovery=null;}
  }else this.recovery=null;
  if(context.externalOwner||context.emergencyStop||context.automationHold){this.lastCompletion=null;this.authority.hold(context.externalOwner?'external-owner':'operator-hold');this.state.cancel();this.pending=null;}
  const source=context.iogEnabled&&context.iogActive?'iog':context.overnightEnabled&&context.nightActive?'night':null;
  const end=source==='night'?context.nightEndAtMs:context.iogEndAtMs;
  const target=source==='night'?context.nightTargetSoc:context.iogTargetSoc;
  const key=!this.state.intent&&source?source+':'+end+':'+target:null;
  if(!this.state.intent&&key&&!this.authority.state.hold&&!this.authority.completed(key,nowMs)&&this.authority.state.active?.owner!==key)this.token=this.authority.begin(key,nowMs);
  if(!this.state.intent&&!key&&this.authority.state.active)this.authority.finish();
  let result=this.planner.step({gateway,venus,nowMs,context,intent:this.state.intent});
  if(result.reason==='membership-or-readings-invalid')this.socDisplay.clear();
  if(this.state.intent&&['membership-or-readings-invalid','held','external-control-owner'].includes(result.reason)){this.onInvalidate();this.state.cancel();this.pending=null;this.authority.hold(result.reason);}
  if(this.state.intent&&['telemetry-unavailable','iog-stale'].includes(result.reason))this.pauseIntent(result.reason);
  if(this.authority.state.hold||this.state.intent&&!this.authority.allows(this.token)||key&&this.authority.completed(key,nowMs))result={...result,aioW:0,venusW:0,reason:this.pending?'continuity-wait':'authority-held',complete:false,reachable:false};
  result=this.guard.apply(result,{gateway,venus,nowMs,context,intent:this.state.intent});
  if(result.reason==='eco-house-support')this.lastCompletion=null;
  if(result.complete){this.lastCompletion={mode:this.state.intent?.mode||'charge'};if(key&&Number.isFinite(end)&&end>nowMs)this.authority.complete(key,end,nowMs);else this.authority.finish();}
  const signature=JSON.stringify([result.reason,result.aioW,result.venusW,result.complete,this.authority.state.hold]);
  if(signature!==this.savedPlanSignature||nowMs-(this.savedPlanAt??0)>=60000){fs.writeFileSync(this.planFile+'.tmp',JSON.stringify({at:nowMs,result},null,2),{mode:0o600});fs.renameSync(this.planFile+'.tmp',this.planFile);this.savedPlanSignature=signature;this.savedPlanAt=nowMs;}
  this.latest={at:nowMs,result,operation:!this.state.intent&&context.ecoEnabled&&!context.exportActive&&!context.nightActive&&!context.iogActive?'eco':null};this.socDisplay.observe(this.latest,{gateway,venus,context,nowMs});
  if(signature!==this.publicStatusSignature||nowMs-(this.publicStatusAt??0)>=5000){const status={at:nowMs,...require('./user-status').userStatus(this.lastCompletion&&!this.state.intent?{...this.latest,result:{...result,complete:true}}:this.latest,nowMs)};const file=path.join(path.dirname(this.planFile),'status.json');fs.writeFileSync(file+'.tmp',JSON.stringify(status),{mode:0o600});fs.renameSync(file+'.tmp',file);this.publicStatusAt=nowMs;this.publicStatusSignature=signature;}
  if(this.state.intent&&result.complete){this.state.cancel();}
  if(this.state.intent&&(['held','external-control-owner','intent-expired','telemetry-unavailable','membership-or-readings-invalid','guard-time-regression'].includes(result.reason))){this.authority.hold(result.reason);this.state.cancel();this.pending=null;}
  this.refresh();return result;
 }

 refresh(){if(!this.tiles)return;try{const s=this.aioEvidenceProvider();if(s)this.observeAio(s);}catch{}for(const [mode,tile] of Object.entries(this.tiles)){if(mode==='soc'||mode==='aioSoc'){const v=mode==='aioSoc'?this.aioSocDisplay.value(this.now()):this.socLevel(),fault=()=>new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);publish(tile.on,v===null?fault():true);publish(tile.level,v===null?fault():v);}else{publish(tile.on,this.state.intent?.mode===mode);publish(tile.level,this.state.targets[mode]);}}this.onRefresh();}
 resetContinuity(){if(this.planner?.eco)this.planner.eco.last=null;if(this.guard)this.guard.last=null;}
 stop(){clearInterval(this.timer);}
}
module.exports={SiteHomebridge};
