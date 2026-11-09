'use strict';
(function(){
 window.GivHomeCommissioning={mount(config){
  const panel=document.createElement('section');panel.className='card mt-3 p-3';
  panel.innerHTML='<h5>Connect your Venus</h5><p>Save your settings and restart Homebridge first. Check the connections, then run the battery check once during installation.</p><p>The battery check briefly charges and discharges at 100 W and checks that the battery stops between tests. Start with the Venus idle and between 25% and 90% charged. Pause other Venus schedules or controllers in its app first.</p><button type="button" class="btn btn-primary">Check connections</button> <button type="button" class="btn btn-primary" disabled>Run battery check</button> <button type="button" class="btn btn-secondary" disabled>Cancel</button><p role="status" aria-live="polite" class="mt-2"></p>';
  panel.hidden=config.marstekIntegrationEnabled!==true;document.body.appendChild(panel);const buttons=panel.querySelectorAll('button'),status=panel.querySelector('[role="status"]');let closed=false,dirty=false;
  async function refresh(){if(closed||dirty)return;try{const s=await homebridge.request('/marstek/commissioning-status');status.textContent=s.title+'. '+s.detail;buttons[0].disabled=Boolean(s.busy||s.offline);buttons[1].disabled=Boolean(s.busy||s.offline||!['Connections checked','Ready'].includes(s.title));buttons[2].disabled=!s.busy;}catch{status.textContent='Waiting for Homebridge. Save and restart, then try again.';}}
  for(const [i,action]of ['check','commission','cancel'].entries())buttons[i].onclick=async()=>{buttons[i].disabled=true;try{await homebridge.request('/marstek/commissioning',{action});status.textContent=action==='cancel'?'Stopping the check…':'Check requested…';}catch(e){status.textContent=e.message||String(e);}await refresh();};
  if(!panel.hidden)void refresh();const timer=setInterval(()=>{if(!panel.hidden)void refresh();},2000);window.addEventListener('unload',()=>{closed=true;clearInterval(timer);});
  return {update(next){dirty=true;panel.hidden=next.marstekIntegrationEnabled!==true;if(!panel.hidden){buttons[0].disabled=true;buttons[1].disabled=true;status.textContent='Save your changes and restart Homebridge before running setup checks.';}}};
 }};
}());
