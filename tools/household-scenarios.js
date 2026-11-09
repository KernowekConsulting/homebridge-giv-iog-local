'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const hb=require.resolve('homebridge');let entry;try{entry=require.resolve('@homebridge/hap-nodejs',{paths:[path.dirname(hb)]});}catch{entry=require.resolve('hap-nodejs',{paths:[path.dirname(hb)]});}const hap=require(entry),{SiteHomebridge}=require('../lib/marstek/site-homebridge');
const event=(at,type,value)=>({at,type,value});
const scenarios=[
 {name:'Late home, plug in the car, then lower tomorrow’s target',events:[event(0,'target',90),event(2,'charge'),event(120,'ev',7200),event(300,'target',65),event(302,'charge'),event(700,'ev',0)]},
 {name:'Forecast optimism meets clouds and cooking',pv:3500,events:[event(0,'target',70),event(2,'charge'),event(180,'pv',100),event(182,'load',4200),event(400,'load',700),event(600,'pv',4000)]},
 {name:'Two people disagree about selling battery energy',events:[event(0,'target',90),event(2,'charge'),event(100,'exportTarget',35),event(102,'export'),event(104,'charge'),event(106,'offCharge'),event(200,'export')]},
 {name:'Phone slider sends On before its new percentage',events:[event(0,'charge'),event(2,'target',75),event(120,'charge'),event(122,'target',75)]},
 {name:'Home automation and a person keep changing their minds',events:[event(0,'charge'),event(10,'export'),event(12,'charge'),event(14,'export'),event(16,'offExport'),event(120,'charge')]},
 {name:'A kettle finishes during peak export, then the sun returns',aioSoc:90,venusSoc:90,peak:true,load:1600,events:[event(160,'load',100),event(300,'pv',3500),event(500,'peak',false)]},
 {name:'Router restarts while charging, user tries again too soon',events:[event(0,'charge'),event(120,'network',false),event(130,'charge'),event(180,'network',true),event(182,'charge')]},
 {name:'Battery goes missing while an export target is active',aioSoc:90,venusSoc:80,events:[event(0,'export'),event(180,'member',false),event(182,'charge'),event(300,'member',true),event(304,'charge')]},
 {name:'Homebridge restarts mid-action and a person resumes later',events:[event(0,'target',85),event(2,'charge'),event(240,'restart'),event(360,'charge')]},
 {name:'Manual inverter control takes precedence over Home automation',events:[event(0,'charge'),event(200,'external',true),event(240,'external',false),event(300,'charge')]},
 {name:'User wants to sell everything, reserves prevent that',aioSoc:21,venusSoc:21,events:[event(0,'exportTarget',0),event(2,'export')]},
 {name:'Emergency Stop then a competing automation asks to charge',events:[event(0,'charge'),event(120,'emergency',true),event(122,'charge'),event(180,'emergency',false),event(240,'charge')]},
 {name:'Short IOG opportunity overlaps the overnight schedule',night:true,iog:true,events:[event(120,'night',false),event(300,'iogFresh',false),event(400,'iogFresh',true),event(600,'iog',false)]},
 {name:'No import allowance has been commissioned',importLimit:0,events:[event(0,'charge'),event(100,'ev',7200)]},
 {name:'Repeated old readings while the household changes load',events:[event(0,'charge'),event(120,'repeat',true),event(140,'load',5000),event(200,'repeat',false),event(204,'charge')]}
];
function rng(seed){let n=seed>>>0;return()=>{n=(1664525*n+1013904223)>>>0;return n/4294967296;};}
async function runScenario(def,{seed=1,seconds=900}={}){
 const random=rng(seed),directory=fs.mkdtempSync(path.join(os.tmpdir(),'givhome-household-'));let ui,now=Date.parse('2026-11-05T00:00:00Z');
 const env={load:def.load??700,pv:def.pv??0,ev:0,network:true,member:true,repeat:false,peak:!!def.peak,night:!!def.night,iog:!!def.iog,iogFresh:true,external:false,emergency:false};
 const responseSeconds=2+random()*3,commandDelaySeconds=2+2*Math.floor(random()*3);
 let aSoc=def.aioSoc??45,vSoc=def.venusSoc??40,aPower=0,vPower=0,lastObservation=now-2000,previous=null,lease=0,targetA=0,targetV=0;
 const queue=[],events=[],timeline=[],failures=[];let chargeWh=0,exportWh=0,importWh=0,maxImport=0,maxExport=0,heldSteps=0,rejectedInteractions=0,exportOverCapSeconds=0,importOverBudgetSeconds=0;
 class Accessory extends hap.Accessory{constructor(name,id){super(name,id);this.context={};}}
 const api={hap,platformAccessory:Accessory,user:{storagePath:()=>directory},registerPlatformAccessories(){},unregisterPlatformAccessories(){}};
 const start=()=>{ui=new SiteHomebridge({debug(){}},api,{marstekSitePreviewEnabled:true,marstekGatewaySerial:'GW2412G068',marstekShadowBatteryId:'sim-venus',marstekDevices:[{id:'sim-venus',host:'127.0.0.1'}],marstekSiteImportLimitW:def.importLimit??12000},{now:()=>now});ui.start();};start();
 const freshSample=()=>({nowMs:now,gateway:{observedAtMs:lastObservation,onlineCount:env.member?1:0,units:[{socPercent:aSoc}],gridExportW:aPower+vPower+env.pv-env.load-env.ev,aioDischargeW:aPower,solarW:env.pv,householdLoadW:env.load},venus:{observedAtMs:lastObservation,socPercent:vSoc,acDischargeW:vPower,acDirectionQualified:true},context:{emergencyStop:env.emergency,externalOwner:env.external,exportActive:env.peak,overnightEnabled:env.night,nightActive:env.night,nightTargetSoc:80,nightEndAtMs:Date.parse('2026-11-05T06:00:00Z'),iogEnabled:env.iog,iogActive:env.iog,iogFresh:env.iogFresh,iogFetchedAtMs:now,iogMode:'charge',iogTargetSoc:100,iogEndAtMs:now+60000}});
 try{
  // Receive one good observation before accepting the first household interaction.
  lastObservation=now;ui.sample(freshSample());
  for(let t=0;t<seconds;t+=2){
   now=Date.parse('2026-11-05T00:00:00Z')+t*1000;
   for(const e of def.events.filter(e=>e.at===t)){
    try{switch(e.type){case 'target':await ui.tiles.charge.level.handleSetRequest(e.value);break;case 'exportTarget':await ui.tiles.export.level.handleSetRequest(e.value);break;case 'charge':await ui.tiles.charge.on.handleSetRequest(true);break;case 'export':await ui.tiles.export.on.handleSetRequest(true);break;case 'offCharge':await ui.tiles.charge.on.handleSetRequest(false);break;case 'offExport':await ui.tiles.export.on.handleSetRequest(false);break;case 'restart':ui.stop();start();break;default:env[e.type]=e.value;}
     events.push({...e,outcome:'accepted'});
    }catch(error){rejectedInteractions++;events.push({...e,outcome:'rejected',reason:String(error.hapStatus||error.message||error)});}
   }
   // Bounded seeded domestic noise changes demand without assuming a typical day.
   const jitter=Math.round((random()-.5)*100),load=Math.max(0,env.load+jitter);
   if(env.network&&!env.repeat){lastObservation=now;previous=freshSample();}
   const s=previous?{...previous,nowMs:now,context:freshSample().context}:freshSample();
   const plan=ui.sample(s);
   if(plan.leaseUntilMs>now){queue.push({due:t+commandDelaySeconds,plan,generation:ui.authority.state.generation});}else{targetA=0;targetV=0;lease=now;}
   while(queue.length&&queue[0].due<=t){const q=queue.shift();if(q.plan.leaseUntilMs>now&&q.generation===ui.authority.state.generation){targetA=q.plan.aioW;targetV=q.plan.venusW;lease=q.plan.leaseUntilMs;}}
   if(now>=lease){targetA=0;targetV=0;}
   // Plant assumptions: 1–2 s command delay, 3 s response, no proven physical watchdog.
   const desiredA=env.peak?6000:targetA;
   const gate=(p,soc,reserve)=>p>0&&soc<=reserve?0:p<0&&soc>=100?0:p;
   aPower+=(gate(desiredA,aSoc,20)-aPower)*2/responseSeconds;vPower+=(gate(targetV,vSoc,20)-vPower)*2/responseSeconds;
   const delta=(power,capacity)=>power<0?-power*2*.92/3600/(capacity*1000)*100:-power*2/.94/3600/(capacity*1000)*100;
   aSoc=Math.max(0,Math.min(100,aSoc+delta(aPower,13.5)));vSoc=Math.max(0,Math.min(100,vSoc+delta(vPower,5.12)));
   const grid=aPower+vPower+env.pv-load-env.ev;
   if(grid>6000)exportOverCapSeconds+=2;
   if((def.importLimit??12000)>0&&-grid>(def.importLimit??12000))importOverBudgetSeconds+=2;
   importWh+=Math.max(0,-grid)*2/3600;exportWh+=Math.max(0,grid)*2/3600;chargeWh+=(Math.max(0,-aPower)+Math.max(0,-vPower))*2/3600;maxImport=Math.max(maxImport,-grid);maxExport=Math.max(maxExport,grid);
   const checks=[];
   if(![plan.aioW,plan.venusW,aSoc,vSoc].every(Number.isFinite))checks.push('nonfinite-state');
   if(plan.venusW>800||plan.venusW < -2500||Math.abs(plan.aioW)>6000)checks.push('power-envelope');
   if((plan.combinedSoc===null||ui.authority.state.hold)&&(plan.aioW!==0||plan.venusW!==0))checks.push('held-owner-proposes-power');
   if(now-lastObservation>6000&&(plan.aioW!==0||plan.venusW!==0))checks.push('stale-proposal');
   if(plan.venusW>0&&vSoc<19.99)checks.push('venus-reserve-proposal');
   if(plan.aioW>0&&aSoc<19.99)checks.push('aio-reserve-proposal');
   if(checks.length)failures.push({second:t,checks});
   if(ui.authority.state.hold)heldSteps++;
   if(t%30===0)timeline.push({second:t,aSoc,vSoc,gridW:Math.round(grid),planAioW:plan.aioW,planVenusW:plan.venusW,reason:plan.reason,owner:ui.authority.state.active?.owner||null,hold:ui.authority.state.hold});
  }
  return {name:def.name,seed,seconds,assumptions:{syntheticHousehold:true,syntheticDevices:true,capacityKwh:[13.5,5.12],chargeEfficiency:.92,dischargeEfficiency:.94,deviceResponseSeconds:responseSeconds,commandDelaySeconds,simulatedLeaseExpiry:true,exportIsAdvisory:true},events,metrics:{finalAioSoc:aSoc,finalVenusSoc:vSoc,chargeKwh:chargeWh/1000,importKwh:importWh/1000,exportKwh:exportWh/1000,maxImportW:maxImport,maxExportW:maxExport,heldSteps,rejectedInteractions,exportOverCapSeconds,importOverBudgetSeconds},limitations:exportOverCapSeconds?['Independent AIO/PV can exceed the site cap even when Venus assistance is zero; physical coordinated curtailment required.']:[],failures,timeline};
 }finally{ui.stop();fs.rmSync(directory,{recursive:true,force:true});}
}
async function runAll({seeds=[1,42,2026]}={}){const results=[];for(const def of scenarios)for(const seed of seeds)results.push(await runScenario(def,{seed}));return {syntheticOnly:true,results,failedRuns:results.filter(r=>r.failures.length).length};}
if(require.main===module)runAll().then(report=>{if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2));else console.log(JSON.stringify(report,null,2));if(report.failedRuns)process.exitCode=1;}).catch(error=>{console.error(error);process.exitCode=1;});
module.exports={scenarios,runScenario,runAll};
