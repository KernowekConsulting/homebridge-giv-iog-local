'use strict';
const fs=require('node:fs'),path=require('node:path');
const {SiteCoordinator,TargetState}=require('./site-coordinator');
const OWNER='givhome-site-shadow-v1';
class SiteHomebridge {
 constructor(log,api,config,{now=Date.now,onInvalidate=()=>{},canControl=()=>true}={}){Object.assign(this,{log,api,config,now,onInvalidate,canControl});this.cached=new Map();this.latest=null;}
 owns(a){return a.context?.siteOwner===OWNER;}
 configureAccessory(a){this.cached.set(a.UUID,a);}
 start(){
  if(!this.config.marstekSitePreviewEnabled){if(this.cached.size)this.api.unregisterPlatformAccessories?.('homebridge-giv-iog-local','GivHomeModbus',[...this.cached.values()]);return;}
  const directory=path.join(this.api.user.storagePath(),'givhome-site-preview');fs.mkdirSync(directory,{recursive:true});
  const siteSettings=require('./site-settings');
  this.authority=new (require('./action-authority').ActionAuthority)(path.join(directory,'authority.json'),siteSettings.identity(this.config),{legacyIdentityMatch:siteSettings.legacyIdentityMatches});
  this.guard=new (require('./proposal-guard').ProposalGuard)();
  this.state=new TargetState(path.join(directory,'targets.json'));
  this.planFile=path.join(directory,'latest-plan.json');
  this.planner=new SiteCoordinator(siteSettings.settings(this.config));
  this.tiles={};const {Service:S,Characteristic:C,Perms}=this.api.hap;
  for(const mode of ['soc','charge','export']){
   const label=mode==='soc'?'Combined SOC':mode==='charge'?'Charge To':'Export To';
   const uuid=this.api.hap.uuid.generate(OWNER+':'+mode),a=this.cached.get(uuid)||new this.api.platformAccessory(label,uuid);
   a.context.siteOwner=OWNER;
   const s=a.getService(S.Lightbulb)||a.addService(S.Lightbulb,a.displayName);
   if(a.context.siteNameRevision!==2){a.displayName=label;s.setCharacteristic(C.Name,label);a.getService(S.AccessoryInformation).setCharacteristic(C.Name,label);a.context.siteNameRevision=2;}
   for(const legacy of s.characteristics.filter(c=>c.UUID===C.ConfiguredName.UUID))s.removeCharacteristic(legacy);
   const on=s.getCharacteristic(C.On),level=s.getCharacteristic(C.Brightness);
   const fault=()=>{throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);};
   level.onGet(()=>{if(mode==='soc'){if(!this.latest||this.now()-this.latest.at>6000||this.latest.result.combinedSoc===null)return fault();return Math.round(this.latest.result.combinedSoc);}return this.state.targets[mode];});
   on.onGet(()=>mode==='soc'?Boolean(this.latest&&this.now()-this.latest.at<=6000&&this.latest.result.combinedSoc!==null):this.state.intent?.mode===mode);
   if(mode==='soc'){for(const c of [on,level])c.setProps({perms:[Perms.PAIRED_READ,Perms.NOTIFY]});}
   else {level.onSet(value=>{const target=Math.round(value);if(target===this.state.targets[mode])return;if(this.lastCompletion?.mode===mode)this.lastCompletion=null;const active=this.state.intent?.mode===mode;const fresh=this.latest&&this.now()-this.latest.at<=6000&&this.latest.result.combinedSoc!==null;if(active){this.onInvalidate();this.authority.hold('target-edited');}this.state.set(mode,target,{preserveIntent:!active});if(active&&fresh){this.token=this.authority.begin(mode,this.now());this.state.start(mode,this.now());}this.refresh();});on.onSet(value=>{if(value){if(!this.canControl())return fault();if(!this.latest||this.now()-this.latest.at>6000||this.latest.result.combinedSoc===null)return fault();this.lastCompletion=null;this.token=this.authority.begin(mode,this.now());this.state.start(mode,this.now());}else if(this.state.intent?.mode===mode){this.onInvalidate();this.authority.hold('manual-cancel');this.state.cancel();}this.refresh();});}
   if(!this.cached.has(uuid))this.api.registerPlatformAccessories('homebridge-giv-iog-local','GivHomeModbus',[a]);this.cached.set(uuid,a);this.tiles[mode]={on,level};
  }
  this.timer=setInterval(()=>{if(this.latest&&this.now()-this.latest.at>6000){this.latest=null;if(this.state.intent||this.authority.state.active){this.onInvalidate();this.authority.hold('telemetry-stale');this.state.cancel();}this.refresh();}},1000);this.timer.unref?.();this.refresh();
 }
 sample({gateway,venus,nowMs,context={}}){
  if(!this.planner)return null;
  if(context.externalOwner||context.emergencyStop||context.automationHold){this.lastCompletion=null;this.authority.hold(context.externalOwner?'external-owner':'operator-hold');this.state.cancel();}
  const source=context.overnightEnabled&&context.nightActive?'night':context.iogEnabled&&context.iogActive?'iog':null;
  const end=source==='night'?context.nightEndAtMs:context.iogEndAtMs;
  const target=source==='night'?context.nightTargetSoc:context.iogTargetSoc;
  const key=!this.state.intent&&source?source+':'+end+':'+target:null;
  if(!this.state.intent&&key&&!this.authority.state.hold&&!this.authority.completed(key,nowMs)&&this.authority.state.active?.owner!==key)this.token=this.authority.begin(key,nowMs);
  if(!this.state.intent&&!key&&this.authority.state.active)this.authority.finish();
  let result=this.planner.step({gateway,venus,nowMs,context,intent:this.state.intent});
  if(this.authority.state.hold||this.state.intent&&!this.authority.allows(this.token)||key&&this.authority.completed(key,nowMs))result={...result,aioW:0,venusW:0,reason:'authority-held',complete:false,reachable:false};
  result=this.guard.apply(result,{gateway,venus,nowMs});
  if(result.complete){this.lastCompletion={mode:this.state.intent?.mode||'charge'};if(key&&Number.isFinite(end)&&end>nowMs)this.authority.complete(key,end,nowMs);else this.authority.finish();}
  const signature=JSON.stringify([result.reason,result.aioW,result.venusW,result.complete,this.authority.state.hold]);
  if(signature!==this.savedPlanSignature||nowMs-(this.savedPlanAt??0)>=60000){fs.writeFileSync(this.planFile+'.tmp',JSON.stringify({at:nowMs,result},null,2),{mode:0o600});fs.renameSync(this.planFile+'.tmp',this.planFile);this.savedPlanSignature=signature;this.savedPlanAt=nowMs;}
  this.latest={at:nowMs,result};
  if(signature!==this.publicStatusSignature||nowMs-(this.publicStatusAt??0)>=5000){const status={at:nowMs,...require('./user-status').userStatus(this.lastCompletion&&!this.state.intent?{...this.latest,result:{...result,complete:true}}:this.latest,nowMs)};const file=path.join(path.dirname(this.planFile),'status.json');fs.writeFileSync(file+'.tmp',JSON.stringify(status),{mode:0o600});fs.renameSync(file+'.tmp',file);this.publicStatusAt=nowMs;this.publicStatusSignature=signature;}
  if(this.state.intent&&(result.complete||['held','external-control-owner','intent-expired','telemetry-unavailable','membership-or-readings-invalid','guard-time-regression'].includes(result.reason))){this.authority.hold(result.reason);this.state.cancel();}
  this.refresh();return result;
 }

 refresh(){if(!this.tiles)return;for(const [mode,tile] of Object.entries(this.tiles)){tile.on.updateValue(mode==='soc'?Boolean(this.latest?.result.combinedSoc!==null&&this.latest):this.state.intent?.mode===mode);if(mode!=='soc')tile.level.updateValue(this.state.targets[mode]);else if(this.latest?.result.combinedSoc!=null)tile.level.updateValue(Math.round(this.latest.result.combinedSoc));}}
 stop(){clearInterval(this.timer);}
}
module.exports={SiteHomebridge};
