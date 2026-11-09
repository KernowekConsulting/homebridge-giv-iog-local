'use strict';
function userStatus(record,now=Date.now()){
 if(!record||!Number.isFinite(record.at)||now-record.at>90000||record.at>now)return {title:'Waiting for the battery',detail:'GivHome will update this when fresh readings are available.'};
 const p=record.result||{},r=p.reason||'';
 if(p.combinedSoc===null)return {title:'Battery unavailable',detail:'Check the battery connection. Your target is saved.'};
 if(p.complete||r==='target-reached')return {title:'Target reached',detail:'The action has finished.'};
 if(r==='authority-held'||r==='held')return {title:'Paused',detail:'Your target is saved. Switch the control on when you want to continue.'};
 if(r==='import-budget-required')return {title:'Waiting for setup',detail:'Set the site import allowance before using charging plans.'};
 if(r==='reserve-or-headroom')return {title:'Keeping your reserve',detail:'There is no spare energy or export allowance available right now.'};
 if(r==='iog-stale')return {title:'Waiting for Octopus',detail:'GivHome needs an up-to-date charging schedule.'};
 if(p.aioW<0||p.venusW<0)return {title:'Charging plan active',detail:'GivHome is working towards your chosen target.'};
 if(p.aioW>0||p.venusW>0)return {title:'Export plan active',detail:'GivHome is working towards your chosen target, keeping your reserve.'};
 return {title:'Ready',detail:'Choose a target in Apple Home, then switch the control on.'};
}
module.exports={userStatus};
