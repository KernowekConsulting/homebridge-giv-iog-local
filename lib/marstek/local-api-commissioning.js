'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {load,save,selected}=require('./commissioning');
const {LocalApiClient}=require('./local-api-client');
const {identity,mode,sameBattery}=require('./local-api-monitor');
function signature(config){const d=selected(config);return crypto.createHash('sha256').update(JSON.stringify({profile:'venus-local-api-timed-v2',id:d.id,host:d.host,port:config.marstekLocalApiPort??30000,output:d.maxDischargeW,input:d.maxChargeW,gatewayHost:config.marstekGatewayHost,gatewaySerial:config.marstekGatewaySerial,aioHost:config.inverterHost,aioSerial:config.inverterSerial})).digest('hex');}
function files(storage){const dir=path.join(storage,'givhome-venus-api-commissioning');fs.mkdirSync(dir,{recursive:true,mode:0o700});return Object.fromEntries(['request','status','certificate','receipt','pending','binding'].map(k=>[k,path.join(dir,k+'.json')]));}
class LocalApiCommissioning{
 constructor(config,storage,{now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),clientFactory=d=>new LocalApiClient({host:d.host,port:config.marstekLocalApiPort??30000}),readGateway,before=async()=>{},after=()=>{}}={}){Object.assign(this,{config,storage,now,sleep,clientFactory,readGateway,before,after});this.paths=files(storage);this.busy=false;this.ready=false;this.lastId=null;this.cancelled=false;}
 status(title,detail,extra={}){const value={at:this.now(),heartbeatAt:this.now(),title,detail,busy:this.busy,timingTrial:this.timingTrial,signature:signature(this.config),...extra};save(this.paths.status,value);return value;}
 start(){if(this.timer)return;this.cancelled=false;const tick=()=>{if(!this.busy)this.task=this.poll().catch(e=>this.status('Check needed',e.message));const old=load(this.paths.status),current=signature(this.config);if(!old||old.signature!==current||this.now()-(old.heartbeatAt||0)>=10000)save(this.paths.status,{...(old?.signature===current?old:{title:'Ready to check',detail:'Enable Local API in the Marstek app, then check the connection.',signature:current,ready:false}),heartbeatAt:this.now(),busy:this.busy});};this.timer=setInterval(tick,500);this.timer.unref?.();tick();}
 async poll(){const pending=load(this.paths.pending);if(pending){if(this.now()<(this.nextRecoveryAt||0))return;this.nextRecoveryAt=this.now()+15000;await this.recover(pending);return;}const req=load(this.paths.request);if(!req||req.id===this.lastId||load(this.paths.receipt)?.id===req.id)return;this.lastId=req.id;save(this.paths.receipt,{id:req.id,at:this.now()});if(req.action==='cancel'){this.status('Check cancelled','No new battery check will start.');return;}if(!['check','commission'].includes(req.action)||req.signature!==signature(this.config)||!Number.isFinite(req.at)||this.now()-req.at>30000||req.at>this.now())throw Error('Save your settings and restart before checking the battery.');await this.run(req);}
 valid(req){return !this.cancelled&&load(this.paths.request)?.id===req.id&&this.now()-req.at<300000&&this.now()>=req.at;}
 async reliableRead(client,method){
  if(typeof client.setTimedPower!=='function')return client[method]();
  let error;for(let n=0;n<3;n++){if(this.cancelled)throw Error('Check cancelled');try{return await client[method]({timeoutMs:15000,expiresAtMs:this.now()+20000,valid:()=>!this.cancelled});}catch(e){error=e;if(e.code!=='ETIMEDOUT')throw e;await this.sleep(1500*2**n);}}throw error;
 }
 async measured(client,req,{power=null}={}){const end=this.now()+15000;let previous=null;for(let n=0;n<8&&this.now()<end;n++){if(req&&!this.valid(req))throw Error('Check cancelled');const r=await this.reliableRead(client,'getMode'),value=r.result.ongrid_power;if(!Number.isFinite(value)||Math.abs(value)>(power===null&&typeof client.setTimedPower==='function'?3000:400))throw Error('Unexpected power during the small battery check');this.lastSnapshot={at:this.now(),...r.result};if(power===null||power===0&&Math.abs(value)<=30&&previous!==null&&Math.abs(previous)<=30||power!==0&&Math.abs(value)>=30&&Math.sign(value)===Math.sign(power))return {reply:r,powerW:value};previous=value;await this.sleep(250);}throw Error('Battery power response was not confirmed');}
 referenceBinding(){
  for(const file of [this.paths.certificate,this.paths.binding]){
   const saved=load(file);
   if(saved?.signature===signature(this.config)&&saved.binding?.mac)return saved.binding;
  }
  return null;
 }
 async zero(client){if(typeof client.setTimedPower==='function')return new (require('./timed-action').TimedAction)(client,{now:this.now,sleep:this.sleep}).stop();const end=this.now()+15000;const reply=await client.setPower(0,{valid:()=>this.now()<end,countdownS:1,expiresAtMs:end,priority:100});if(reply.result.set_result!==true)throw Error('Battery stop was not acknowledged');return this.measured(client,null,{power:0});}
 async run(req){this.busy=true;this.ready=false;let client,success=false,attempted=false,phase='Connection check';try{
  await this.before(req.action);
  this.status('Checking connections','Reading the Gateway and Venus Local API.');
  client=this.clientFactory(selected(this.config));
  const binding=identity(await this.reliableRead(client,client.discoverDevice?'discoverDevice':'getDevice'));
  const selectedBinding=this.referenceBinding();
  const legacy=load(path.join(this.storage,'givhome-venus-commissioning','certificate.json'));
  if(selectedBinding&&!sameBattery(selectedBinding,binding)||!selectedBinding&&legacy?.binding?.mac&&!sameBattery(legacy.binding,binding)){
   client.holdWrites?.();
   throw Error('A different Venus answered at the configured IP address. Verify the IP or set up the replacement as a new battery.');
  }
  const explicitE3=name=>/^(?:venus[ _-]*e[ ._-]*3(?:\.0)?|vnse3-0)$/i.test(String(name||''));
  if(!explicitE3(binding.model)&&![selectedBinding,legacy?.binding].some(old=>sameBattery(old,binding)&&explicitE3(old.model)))throw Error('The API model is ambiguous. An identified Venus E 3.0 is required before control checks.');
  client.adoptDiscoveredSource?.(binding.src,binding);
  if(req.action==='commission')client.allowCommissioningWrites?.();
  let initial=await this.measured(client,req);
  await require('./commissioning').Commissioning.prototype.gateway.call(this);
  if(req.action==='check'){this.status('Connections checked','Venus identified. Run the battery check before using API control.',{binding,initial:this.lastSnapshot});return;}
  save(this.paths.binding,{signature:signature(this.config),binding});
  save(this.paths.certificate,null);initial=await this.measured(client,req);if(!['Manual','Passive'].includes(mode(initial.reply.result.mode))||(typeof client.setTimedPower!=='function'&&Math.abs(initial.powerW)>50)||!Number.isFinite(initial.reply.result.bat_soc)||initial.reply.result.bat_soc<25||initial.reply.result.bat_soc>(typeof client.setTimedPower==='function'?99:90))throw Error('Start with the Venus idle, between 25% and 90%, in Manual or Passive mode.');
  save(this.paths.pending,{at:this.now(),signature:signature(this.config),binding,initial:this.lastSnapshot});attempted=true;
  if(typeof client.setTimedPower==='function'){
   const action=new (require('./timed-action').TimedAction)(client,{now:this.now,sleep:this.sleep});
   const valid=()=>this.valid(req);
   phase='Passive mode at zero power';this.status('Checking takeover','Establishing Passive mode at zero power.');await action.stop();
   for(const power of [-100,100]){phase=power<0?'100 W charging':'100 W discharging';this.status('Checking the battery',power<0?'Checking timed charging at 100 W.':'Checking timed discharging at 100 W.');await action.set(power,this.now()+120000,{valid});phase='Stop after '+phase;await action.stop();}
   phase='Battery timer expiry';this.status('Checking expiry','Checking that timed discharge ends without renewal.');await action.set(100,this.now()+60000,{valid});await this.sleep(62000);const expired=await this.measured(client,req,{power:0});if(mode(expired.reply.result.mode)!=='Passive')throw Error('Timed expiry did not leave Passive mode');await action.stop();
   this.timingTrial={timedAction:true,maxActionMs:120000,retries:3};
  }else{
  for(const power of [-100,100]){if(!this.valid(req))throw Error('Check cancelled');this.status('Checking the battery',power<0?'Briefly charging at 100 W.':'Briefly discharging at 100 W.');const ack=await client.setPower(power,{valid:()=>this.valid(req),countdownS:5});if(ack.result.set_result!==true)throw Error('Battery test command rejected');await this.measured(client,req,{power});await this.zero(client);}
  // This is a device-side expiry test, without a software zero during the interval.
  const ack=await client.setPower(100,{valid:()=>this.valid(req),countdownS:5});if(ack.result.set_result!==true)throw Error('Countdown test rejected');await this.measured(client,req,{power:100});await this.sleep(6500);const expired=await this.measured(client,req,{power:0});if(mode(expired.reply.result.mode)!=='Passive')throw Error('Countdown leaves another operating mode; automatic API control remains blocked');await this.zero(client);
  this.status('Checking response timing','Checking that power commands fit within the control window.');
  await client.getMode();const feedbackDeadline=this.now()+14000;
  try{let feedback;for(let n=0;n<3;n++){
   const expiresAtMs=Math.min(feedbackDeadline,this.now()+8000);
   const set=await client.setPower(100,{valid:()=>this.valid(req)&&this.now()<feedbackDeadline,expiresAtMs});
   if(set.result.set_result!==true)throw Error('Setpoint rejected');
   feedback=await client.getMode({valid:()=>this.valid(req),expiresAtMs:feedbackDeadline});
   if(Number.isFinite(feedback.result.ongrid_power)&&feedback.result.ongrid_power>=30)break;
  }
  this.timingTrial={deadline:feedbackDeadline,observedAt:this.now(),powerW:feedback?.result.ongrid_power,commandLeaseMs:8000,nativeCountdownMaxS:5};
  if(this.now()>=feedbackDeadline||!Number.isFinite(feedback?.result.ongrid_power)||feedback.result.ongrid_power<30||mode(feedback.result.mode)!=='Passive')throw Error('Command expired before feedback');
  }catch(error){throw Error('Local API response timing does not fit paced renewal. Automatic API control remains off.');}
  await this.zero(client);
  }
  phase='Final identity check';
  const finalReply=await this.reliableRead(client,'getDevice'),finalIdentity=identity(finalReply);if(JSON.stringify(binding)!==JSON.stringify(finalIdentity))throw Error('Venus identity changed during the check');if(!this.valid(req))throw Error('Check cancelled');
  save(this.paths.certificate,{schema:1,signature:signature(this.config),binding,bindingObservedAtMs:finalReply.sentAtMs??this.now(),acDischargeSign:'positive',completedAt:this.now(),transport:'local-api',policyRevision:'priority-20261111',requestQuietMs:client.session?.quietMs??0,timingTrial:this.timingTrial,tests:[...(typeof client.setTimedPower==='function'?['timed-action-v1']:[]),'lease-budget-feedback','charge-100W','discharge-100W','stop-measured','native-countdown-measured'],expiryMode:'Passive'});fs.unlinkSync(this.paths.pending);success=true;this.ready=true;this.status('Ready','Local API battery checks passed. GivHome can use your selected controls.',{ready:true});
 }catch(error){
  const evidence=error.timedEvidence;
  const detail=evidence?
   (evidence.acknowledged?'command accepted':evidence.rejected?'command rejected':'no command acknowledgement')+
   (Number.isFinite(evidence.observedW)?', '+evidence.observedW+' W measured':', no usable power reading'):
   error.message;
  let stop='';
  if(client&&attempted){
   try{await this.zero(client);if(load(this.paths.pending))fs.unlinkSync(this.paths.pending);stop=' Stop confirmed.';}
   catch{stop=' Stop could not be confirmed. Check the Venus in its app.';}
  }
  this.status('Check needed',phase+': '+detail+'.'+stop,{failedPhase:phase,evidence});
 }finally{client?.close();this.busy=false;const state=load(this.paths.status);if(state)save(this.paths.status,{...state,busy:false,ready:success});this.after(success);}}
 async recover(pending){this.busy=true;this.ready=false;let client;try{await this.before('recovery');save(this.paths.certificate,null);if(pending.signature!==signature(this.config))throw Error('Settings changed after an interrupted API check. Check the previous Venus in its app.');client=this.clientFactory(selected(this.config));const current=identity(await this.reliableRead(client,client.discoverDevice?'discoverDevice':'getDevice'));if(JSON.stringify(current)!==JSON.stringify(pending.binding))throw Error('Venus identity changed after an interrupted check');client.adoptDiscoveredSource?.(current.src,current);client.allowCommissioningWrites?.();await this.zero(client);fs.unlinkSync(this.paths.pending);this.status('Check needed','The interrupted API check has stopped. Run the battery check again.');}catch(error){this.status('Check needed','Stopping could not be confirmed: '+error.message);}finally{client?.close();this.busy=false;const state=load(this.paths.status);if(state)save(this.paths.status,{...state,busy:false,ready:false});this.after(false);}}
 qualificationState(model){
  const c=load(this.paths.certificate),fail=reason=>({certificate:null,reason});
  if(this.busy||load(this.paths.pending))return fail('commissioning-active');
  if(!c||c.schema!==1||c.transport!=='local-api'||c.policyRevision!=='priority-20261111'||!c.tests?.includes('lease-budget-feedback'))return fail('certificate-unqualified');
  if(c.signature!==signature(this.config)||c.requestQuietMs!==model.requestQuietMs)return fail('settings-mismatch');
  if(JSON.stringify(c.binding)!==JSON.stringify(model.binding))return fail(sameBattery(c.binding,model.binding)?'firmware-changed':'identity-mismatch');
  if(!Number.isFinite(model.identityAtMs)||this.now()-model.identityAtMs>require('./local-api-monitor').IDENTITY_MAX_AGE_MS||model.identityAtMs>this.now())return fail('identity-stale');
  return {certificate:c,reason:null};
 }
 async qualification(_client,model){const state=this.qualificationState(model);if(typeof _client?.setTimedPower==='function'&&!state.certificate?.tests?.includes('timed-action-v1'))state.certificate=null;this.lastQualification=state;return state.certificate;}
 reportIdentityIssue(reason){
  if(this.busy)return;
  const details={
   'firmware-changed':'Venus firmware or API identity changed. Readings are available. Run the battery check to restore control.',
   'identity-mismatch':'A different Venus answered at the configured IP address. Verify the IP or set up the replacement as a new battery.'
  };
  if(load(this.paths.status)?.identityIssue===reason)return;
  this.ready=false;
  this.status('Check needed',details[reason]||'Battery or settings changed. Run the connection and battery checks again.',{identityIssue:reason,ready:false});
 }
 recoverRuntimeStatus(){
  if(this.busy)return;
  const state=load(this.paths.status);
  const legacy='Battery stopping could not be confirmed. Check its connection and app before continuing.';
  if(state?.runtimeFault==='stop-unconfirmed'||(!state?.runtimeFault&&state?.detail===legacy)){
   this.status('Ready','Venus connection and control recovered.',{ready:true});
  }
 }
 async stop(){this.cancelled=true;clearInterval(this.timer);this.timer=null;await this.task;}
}
module.exports={LocalApiCommissioning,signature,files,load,save};
