'use strict';
const {SiteCoordinator}=require('./site-coordinator');
function analyse(records){
 const valid=records.filter(r=>r.quality==='validated-profile'),gaps=[];let regressions=0;
 for(let i=1;i<records.length;i++){const gap=records[i].startedAtMs-records[i-1].startedAtMs;if(gap<0)regressions++;else gaps.push(gap);}
 const quantile=(values,q)=>values.length?[...values].sort((a,b)=>a-b)[Math.floor((values.length-1)*q)]:null;
 return {records:records.length,valid:valid.length,rejected:records.length-valid.length,regressions,medianIntervalMs:quantile(gaps,.5),maxGapMs:gaps.length?Math.max(...gaps):null,p95SpanMs:quantile(valid.map(r=>r.spanMs),.95),errors:records.reduce((out,r)=>{for(const e of r.errors||[])out[e]=(out[e]||0)+1;return out;},{})};
}
function replay(compact,{venusSoc=50,mode='assist'}={}){
 const planner=new SiteCoordinator({importLimitW:12000});return compact.rows.map(([t,grid,aio,pv,load,soc,span])=>{
 const input={nowMs:t+span,gateway:{observedAtMs:t,gridExportW:grid,aioDischargeW:aio,solarW:pv,householdLoadW:load,onlineCount:1,units:[{socPercent:soc}]},venus:{observedAtMs:t,socPercent:venusSoc,acDischargeW:0,acDirectionQualified:true},context:{exportActive:mode==='assist'},intent:mode==='charge'?{mode:'charge',target:100,deadlineMs:t+3600000}:null};
 return {gatewayReal:true,venusSynthetic:true,exportIntentSynthetic:true,input,decision:planner.step(input)};
 });
}
module.exports={analyse,replay};
