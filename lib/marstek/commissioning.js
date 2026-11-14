'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {normaliseDevices,readSnapshot}=require('./venus-e3');
const {CommandClient}=require('./command-client');
function selected(config){const devices=normaliseDevices(config.marstekDevices);const id=config.marstekShadowBatteryId||devices[0]?.id;const device=devices.find(d=>d.id===id);if(!device)throw Error('Add a Venus battery first');return device;}
function signature(config){const d=selected(config);return crypto.createHash('sha256').update(JSON.stringify({id:d.id,host:d.host,port:d.port,unit:d.unitId,output:d.maxDischargeW,input:d.maxChargeW,gatewayHost:config.marstekGatewayHost,gatewaySerial:String(config.marstekGatewaySerial||'').trim().toUpperCase(),aioHost:config.inverterHost,aioSerial:config.inverterSerial,profile:'venus-e3-commission-v1'})).digest('hex');}
function files(storage){const directory=path.join(storage,'givhome-venus-commissioning');fs.mkdirSync(directory,{recursive:true,mode:0o700});return Object.fromEntries(['request','status','certificate','pending','receipt'].map(k=>[k,path.join(directory,k+'.json')]));}
function load(file){try{return JSON.parse(fs.readFileSync(file));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
function save(file,data){const tmp=file+'.'+crypto.randomUUID();try{fs.writeFileSync(tmp,JSON.stringify(data),{mode:0o600,flag:'wx'});fs.renameSync(tmp,file);}finally{try{fs.unlinkSync(tmp);}catch(e){if(e.code!=='ENOENT')throw e;}}}
async function identity(client,model){const m=model||(await readSnapshot(client)).model;const words=await client.readHoldingRegisters(30304,6);if(words.length!==6||!words.every(n=>Number.isInteger(n)&&n>=0&&n<=65535))throw Error('Battery identity is unavailable. Check Modbus access and firmware.');const bytes=Buffer.alloc(12);words.forEach((n,i)=>bytes.writeUInt16BE(n,i*2));const mac=bytes.toString('latin1').trim();if(!/^[0-9a-fA-F]{12}$/.test(mac)||/^(?:0{12}|f{12})$/i.test(mac))throw Error('Battery identity is unavailable. Check Modbus access and firmware.');return {model:m.deviceName,firmware:m.firmware,mac:mac.toLowerCase().match(/../g).join(':')};}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
class Commissioning {
 constructor(config,storage,{now=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),clientFactory=d=>new CommandClient(d),readGateway,before=async()=>{},after=()=>{}}={}){Object.assign(this,{config,now,sleep,clientFactory,readGateway,before,after});this.paths=files(storage);this.busy=false;this.lastId=null;this.cancelled=false;this.ready=false;}
 status(title,detail,extra={}){const value={at:this.now(),heartbeatAt:this.now(),title,detail,busy:this.busy,lastSnapshot:this.lastSnapshot,signature:signature(this.config),...extra};try{save(this.paths.status,value);}catch(error){this.lastStorageError=error.message;}return value;}
 start(){if(this.timer)return;this.cancelled=false;const tick=()=>{try{if(!this.busy){this.task=this.poll().catch(e=>{this.ready=false;this.status('Check needed',e.message);});}const state=load(this.paths.status);if(!state||this.now()-(state.heartbeatAt||0)>=10000)save(this.paths.status,{...(state||{title:'Ready to check',detail:'Save your settings, then check the Gateway and Venus.',signature:signature(this.config)}),heartbeatAt:this.now(),busy:this.busy});}catch(error){this.ready=false;this.lastStorageError=error.message;}};this.timer=setInterval(tick,500);this.timer.unref?.();tick();}
 async poll(){if(this.busy)return;const pending=load(this.paths.pending);if(pending){if(this.now()<(this.nextRecoveryAt||0))return;this.nextRecoveryAt=this.now()+15000;await this.recover(pending);return;}const req=load(this.paths.request);if(!req||req.id===this.lastId||load(this.paths.receipt)?.id===req.id)return;this.lastId=req.id;save(this.paths.receipt,{id:req.id,at:this.now()});if(req.action==='cancel'){this.status('Check cancelled','No new battery test will start.');return;}if(!['check','commission'].includes(req.action)||req.signature!==signature(this.config)||!Number.isFinite(req.at)||req.at>this.now()||this.now()-req.at>30000){this.status('Settings changed','Save your settings, restart Homebridge, then check again.');return;}await this.run(req);}
 valid(req){const current=load(this.paths.request);return !this.cancelled&&current?.id===req.id&&signature(this.config)===req.signature&&this.now()>=req.at&&this.now()-req.at<120000;}
 async controlState(client){const lock=await client.readHoldingRegisters(42000,1),mode=await client.readHoldingRegisters(42010,2),power=await client.readHoldingRegisters(42020,2);return {lock:lock[0],mode:mode[0],target:mode[1],power};}
 async gateway(){if(!this.readGateway)throw Error('Gateway connection is not configured');let g;for(let attempt=0;attempt<3;attempt++){try{g=await this.readGateway();break;}catch(error){if(attempt===2)throw Error('Gateway connection: '+error.message);await this.sleep(500*(attempt+1));}}if(g.serial!==String(this.config.marstekGatewaySerial||'').trim().toUpperCase()||this.now()-g.observedAtMs>6000||g.observedAtMs>this.now())throw Error('Fresh readings from your Gateway are required');return g;}
 async measured(client){this.lastSnapshot=await readSnapshot(client,{now:this.now});return this.lastSnapshot.model;}
 async waitFor(client,predicate,req,{timeout=15000,checkRequest=true}={}){const end=this.now()+timeout;for(let n=0;n<40&&this.now()<end;n++){if(checkRequest&&!this.valid(req))throw Error('Check cancelled or expired');const m=await this.measured(client);if(predicate(m))return m;await this.sleep(500);}throw Error('Battery power did not respond as expected. Check needed before control can be enabled.');}
 async stopAndVerify(client,req){for(const a of [42010,42020,42021])await client.write(a,0,{priority:100,valid:()=>true});const c=await this.controlState(client);if(c.mode||c.power.some(Boolean))throw Error('Battery stop settings were not confirmed');for(let confirmation=0;confirmation<2;confirmation++){await this.waitFor(client,m=>Math.abs(m.acSignedW)<=30&&Math.abs(m.batteryChargeSignedW)<=75,req,{checkRequest:false});await this.sleep(500);}}
 async restore(client,original,req){
  await this.stopAndVerify(client,req);
  for(const [a,v]of [[42011,original.target],[42020,original.power[0]],[42021,original.power[1]],[42000,original.lock]]){
   // Zero is the observed uninitialised factory target, not an operating SOC target.
   // Keep the valid inactive target used by the test; never send an invalid zero target.
   if(a===42011&&v===0)continue;
   await client.write(a,v,{priority:100,valid:()=>true});
  }
  const actual=await this.controlState(client),expected={...original};
  if(original.target===0&&(actual.target===0||actual.target>=10&&actual.target<=100))expected.target=actual.target;
  if(!same(actual,expected))throw Error('Original battery settings could not be verified');
  this.lastRestoration={at:this.now(),original,restored:actual,factoryTargetInitialised:original.target===0&&actual.target!==0};
  save(path.join(path.dirname(this.paths.status),'last-restoration.json'),this.lastRestoration);
 }
 async run(req){this.busy=true;this.ready=false;if(req.action==='commission')save(this.paths.certificate,null);let client,original,binding,succeeded=false,pendingWritten=false;try{
  await this.before(req.action);this.status('Checking connections','Reading your Gateway and Venus. No power change yet.');await this.gateway();client=this.clientFactory(selected(this.config));const model=await this.measured(client);binding=await identity(client,model);if(!same(binding,await identity(client)))throw Error('Battery identity changed during the check');original=await this.controlState(client);
  if(req.action==='check'){this.status('Connections checked','Gateway and Venus identified. Run the battery check to enable control.',{binding});return;}
  if(!this.valid(req))throw Error('Check cancelled or expired');
  const device=selected(this.config);if(device.maxChargeW<100||device.maxDischargeW<100)throw Error('A charging and discharge allowance of at least 100 W is needed for the battery check.');
  if(model.socPercent<25||model.socPercent>90)throw Error('Run the battery check with the Venus between 25% and 90% charged.');
  if(![21930,21947].includes(original.lock)||original.mode!==0||!((original.target>=10&&original.target<=100)||(original.target===0&&original.power.every(x=>x===0)))||original.power.some(x=>!Number.isInteger(x)||x<0||x>2500||x%50))throw Error('Pause other battery controls in the Marstek app, then try again.');
  if(Math.abs(model.acSignedW)>50||Math.abs(model.batteryChargeSignedW)>75)throw Error('The Venus is active. Pause it in the Marstek app before running this check.');
  save(this.paths.pending,{signature:req.signature,binding,original,request:req});pendingWritten=true;
  const valid=()=>this.valid(req);
  for(const [mode,label]of [[1,'charge'],[2,'discharge']]){
   await this.gateway();if(!same(binding,await identity(client)))throw Error('Battery identity changed');this.status('Checking '+label+' response','Applying 100 W briefly, then checking that the battery stops.');
   for(const [a,v]of [[42000,21930],[42011,mode===1?95:20],[mode===1?42020:42021,100],[42010,mode]]){if(!valid())throw Error('Check cancelled or expired');await client.write(a,v,{valid});}
   const m=await this.waitFor(client,m=>{if(Math.abs(m.acSignedW)>400||Math.abs(m.batteryChargeSignedW)>400)throw Error('Power readings exceeded the small test request');return Math.abs(m.acSignedW)>=30&&(mode===1?m.batteryChargeSignedW>30:m.batteryChargeSignedW< -30);},req);
   if(Math.abs(m.acSignedW)<30||Math.abs(m.acSignedW)>400||Math.abs(m.batteryChargeSignedW)>400)throw Error('Power readings did not match the small test request');
   const sign=Math.sign(m.acSignedW)*(mode===1?-1:1);if(mode===1)this.direction=sign===1?'positive':'negative';else if(this.direction!==(sign===1?'positive':'negative'))throw Error('Battery power direction was inconsistent');
   await this.stopAndVerify(client,req);
  }
  await this.restore(client,original,req);if(!this.valid(req)||!same(binding,await identity(client)))throw Error('Check cancelled or battery identity changed');
  save(this.paths.certificate,{schema:1,signature:req.signature,binding,acDischargeSign:this.direction,completedAt:this.now(),tests:['charge-100W','discharge-100W','stop-measured','prestate-restored']});fs.unlinkSync(this.paths.pending);succeeded=true;this.ready=true;this.status('Ready','Battery checks passed. GivHome can use your selected controls.',{ready:true});
 }catch(error){this.status('Check needed',error.message);if(client&&pendingWritten){try{if(same(binding,await identity(client))){await this.restore(client,original,req);fs.unlinkSync(this.paths.pending);}}catch(cleanup){this.status('Check needed','Stopping could not be confirmed. Check the Venus in its app before trying again.');}}
 }finally{client?.close();this.busy=false;this.after(succeeded);if(!succeeded){try{const s=load(this.paths.status);if(s)save(this.paths.status,{...s,busy:false,ready:false});}catch{}}}}
 async recover(pending){this.busy=true;this.ready=false;save(this.paths.certificate,null);let client;try{await this.before();this.status('Recovering interrupted check','Checking the battery before restoring its previous settings.');if(pending.signature!==signature(this.config))throw Error('Settings changed after an interrupted check. Check the previously connected Venus before continuing.');client=this.clientFactory(selected(this.config));if(!same(pending.binding,await identity(client)))throw Error('Battery identity changed after an interrupted check');await this.restore(client,pending.original,pending.request);fs.unlinkSync(this.paths.pending);this.status('Check needed','The interrupted check was stopped. Run the battery check again.');}finally{client?.close();this.busy=false;this.after();}}
 async qualification(client,model){const c=load(this.paths.certificate);if(this.busy||load(this.paths.pending)||!c||c.schema!==1||c.signature!==signature(this.config))return null;if(!same(c.binding,await identity(client,model)))return null;return c;}
 async stop(){this.cancelled=true;clearInterval(this.timer);this.timer=null;await this.task;}
}
module.exports={Commissioning,selected,signature,files,load,save,identity};
