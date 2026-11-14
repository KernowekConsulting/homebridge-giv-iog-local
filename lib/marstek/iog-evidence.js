'use strict';
// Use the same confirmed cached dispatch/grace end as the established AIO policy.
// Failed HTTP attempts neither erase a known active slot nor refresh its evidence.
function evidence(state,{nowMs,protectedEndAtMs,active,pollSeconds=30}){
 const fetchedAtMs=state.lastSuccessfulPollMs??(state.lastPollOk?state.lastPollMs:null);
 const valid=Number.isFinite(fetchedAtMs)&&fetchedAtMs>0&&fetchedAtMs<=nowMs;
 const base=Math.max(90000,pollSeconds*2000);
 const knownActive=valid&&active&&Number.isFinite(protectedEndAtMs)&&protectedEndAtMs>nowMs;
 const freshForMs=knownActive?Math.max(base,protectedEndAtMs-fetchedAtMs):base;
 return {fetchedAtMs,freshForMs,fresh:valid&&(knownActive||nowMs-fetchedAtMs<base)};
}
module.exports={evidence};
