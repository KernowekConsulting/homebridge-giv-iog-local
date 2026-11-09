'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{ResponsivePlant}=require('./responsive-plant'),{userStatus}=require('../lib/marstek/user-status');
test('fresh charging plans increase SOC, export reduces it, stale plans expire',()=>{const p=new ResponsivePlant({speed:30});const plan={at:1000,result:{shadowOnly:true,leaseUntilMs:6000,aioW:-2000,venusW:-1000}};for(let i=0;i<20;i++)p.step(plan,1000);assert.ok(p.aSoc>60&&p.vSoc>60);const before=p.aSoc;plan.result.aioW=2000;plan.result.venusW=800;for(let i=0;i<30;i++)p.step(plan,1000);assert.ok(p.aSoc<before);for(let i=0;i<50;i++)p.step(plan,10000);assert.ok(Math.abs(p.aPower)<.1);});
test('reserve and full bounds are respected under accelerated simulation',()=>{const p=new ResponsivePlant({speed:30});for(let i=0;i<20000;i++)p.step({at:0,result:{shadowOnly:true,leaseUntilMs:5000,aioW:6000,venusW:800}},0);assert.equal(p.aSoc,20);assert.equal(p.vSoc,20);});
test('ordinary feedback avoids registers, watts and ownership internals',()=>{for(const reason of ['authority-held','import-budget-required','target-reached','iog-stale']){const s=userStatus({at:1000,result:{reason,combinedSoc:50}},1000);assert.ok(s.title);assert.doesNotMatch(s.detail,/register|generation|lease|journal/i);}assert.equal(userStatus(null).title,'Waiting for the battery');});
test('responsive plant and planner reach a charge target, then an export target',()=>{const {SiteCoordinator}=require('../lib/marstek/site-coordinator'),{ProposalGuard}=require('../lib/marstek/proposal-guard');const p=new ResponsivePlant({speed:30}),planner=new SiteCoordinator({importLimitW:10000}),guard=new ProposalGuard();let now=10000,mode='charge',completedCharge=false,completedExport=false;for(let i=0;i<1200;i++){const sample={nowMs:now,gateway:{observedAtMs:now,onlineCount:1,units:[{socPercent:p.aSoc}],gridExportW:p.aPower+p.vPower-700,aioDischargeW:p.aPower},venus:{observedAtMs:now,socPercent:p.vSoc,acDischargeW:p.vPower,acDirectionQualified:true},intent:{mode,target:mode==='charge'?70:60,deadlineMs:now+100000}};const r=guard.apply(planner.step(sample),sample);if(r.complete){if(mode==='charge'){completedCharge=true;mode='export';}else{completedExport=true;break;}}p.step({at:now,result:r},now,2);now+=2000;}assert.equal(completedCharge,true);assert.equal(completedExport,true);});

test('normal-speed sampled control completes both targets with bounded rounding error',()=>{
 const {SiteCoordinator}=require('../lib/marstek/site-coordinator'),{ProposalGuard}=require('../lib/marstek/proposal-guard');
 const p=new ResponsivePlant({speed:1}),planner=new SiteCoordinator({importLimitW:10000}),guard=new ProposalGuard();
 let now=10000;const completed=[];
 for(const [mode,target] of [['charge',70],['export',60]]){
  let done=false;
  for(let i=0;i<14400;i++){
   const sample={nowMs:now,gateway:{observedAtMs:now,onlineCount:1,units:[{socPercent:p.gatewayWords.get(1801)}],gridExportW:p.aPower+p.vPower-700,aioDischargeW:p.aPower},venus:{observedAtMs:now,socPercent:p.venusWords.get(34002)/10,acDischargeW:p.vPower,acDirectionQualified:true},intent:{mode,target,deadlineMs:now+3600000}};
   const r=guard.apply(planner.step(sample),sample);
   p.step({at:now,result:r},now,2);now+=2000;
   if(r.complete){for(let j=0;j<30;j++){p.step(null,now);now+=1000;}done=true;break;}
  }
  assert.ok(done,mode+' completed');const physical=(p.aSoc*13.5+p.vSoc*5.12)/18.62;
  assert.ok(Math.abs(physical-target)<.65,mode+' physical target error '+Math.abs(physical-target));completed.push({mode,target,physical,elapsedSeconds:(now-10000)/1000});
 }
 console.log('Normal-speed model:',JSON.stringify(completed));
});
test('normal-speed simulation rejects invalid settings and decays safely after lost feed',()=>{
 assert.throws(()=>new ResponsivePlant({speed:0}));assert.throws(()=>new ResponsivePlant({initialSoc:101}));
 const p=new ResponsivePlant({speed:1});p.step({at:1000,result:{shadowOnly:true,leaseUntilMs:6000,aioW:6000,venusW:800}},1000);
 const before=p.aSoc;for(let i=0;i<40;i++)p.step(null,10000+i*1000);
 assert.ok(Math.abs(p.aPower)<.01);assert.ok(before-p.aSoc<.02);
});
