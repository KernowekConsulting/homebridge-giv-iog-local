'use strict';
(function(){
 window.GivHomeMarstekSettings={mount(getConfig,onChange){
  const root=document.createElement('section');root.className='givhome-venus-settings';root.hidden=true;document.body.appendChild(root);
  const copy=()=>JSON.parse(JSON.stringify(getConfig()));
  let controls=[],settings;
  function valid(){return controls.every(input=>input.disabled||input.checkValidity());}
  async function save(change){const next=copy();change(next);await onChange(next,{fromMarstek:true});setEnabled();if(!valid())homebridge.disableSaveButton();}
  function field(parent,label,type,value,change,{required=false,min,max,options,description}={}){
   const wrap=document.createElement('div');wrap.className='form-group mb-3';const caption=document.createElement('label');caption.textContent=label;caption.className='d-block';
   const input=document.createElement(type==='select'?'select':'input');input.className=type==='checkbox'?'ml-2':'form-control';if(type!=='select')input.type=type;
   if(options)for(const [value,text] of options){const option=document.createElement('option');option.value=String(value);option.textContent=text;input.appendChild(option);}
   if(type==='checkbox')input.checked=Boolean(value);else input.value=value??'';
   input.required=required;if(min!==undefined)input.min=min;if(max!==undefined)input.max=max;if(type==='number')input.step='1';
   input.onchange=()=>save(c=>change(c,type==='checkbox'?input.checked:type==='number'||type==='select'?Number(input.value):input.value));
   caption.appendChild(input);wrap.appendChild(caption);if(description){const note=document.createElement('p');note.className='small text-muted';note.textContent=description;wrap.appendChild(note);}parent.appendChild(wrap);controls.push(input);return input;
  }
  let enabledInput;
  function setEnabled(){const active=getConfig().marstekIntegrationEnabled===true;settings.hidden=!active;for(const c of controls){c.disabled=c!==enabledInput&&!active;if(c.requiredWhen)c.required=c.requiredWhen();}}
  function render(){
   root.innerHTML='';controls=[];const c=getConfig();const heading=document.createElement('h5');heading.textContent='Marstek Integration';root.appendChild(heading);
   enabledInput=field(root,'I have a Marstek Venus battery','checkbox',c.marstekIntegrationEnabled,(n,v)=>n.marstekIntegrationEnabled=v);
   settings=document.createElement('div');root.appendChild(settings);
   field(settings,'Venus Local API port','number',c.marstekLocalApiPort??30000,(n,v)=>n.marstekLocalApiPort=v,{required:true,min:1,max:65535});
   field(settings,'Gateway IP address','text',c.marstekGatewayHost,(n,v)=>n.marstekGatewayHost=v,{required:true});
   field(settings,'Expected Gateway serial number','text',c.marstekGatewaySerial,(n,v)=>n.marstekGatewaySerial=v,{required:true});
   (c.marstekDevices||[]).forEach((d,i)=>{
    const battery=document.createElement('fieldset');battery.className='card p-3 mb-3';const legend=document.createElement('legend');legend.textContent=d.name||'Venus battery';battery.appendChild(legend);settings.appendChild(battery);
    const change=key=>(n,v)=>n.marstekDevices[i][key]=v;
    field(battery,'Use this Venus','checkbox',d.enabled!==false,change('enabled'));
    field(battery,'Apple Home name','text',d.name||'Garage Venus',change('name'));
    const host=field(battery,'Battery IP address','text',d.host,change('host'),{required:true,description:'Reserve this IP address for Venus in your router so it stays the same.'});host.requiredWhen=()=>getConfig().marstekDevices[i]?.enabled!==false;
    field(battery,'Venus output limit','select',d.dischargeLimitW??(d.maxDischargeW===2500&&d.higherDischargeLimitConfirmed?2500:800),change('dischargeLimitW'),{options:[[800,'800 W'],[2500,'2.5 kW']],description:'Choose the limit configured on Venus. This does not change the battery setting.'});
    field(battery,'Charging limit (W)','number',d.maxChargeW??2500,change('maxChargeW'),{required:true,min:0,max:2500});
    const remove=document.createElement('button');remove.type='button';remove.className='btn btn-secondary';remove.textContent='Remove battery';remove.onclick=async()=>{await save(n=>n.marstekDevices.splice(i,1));render();};battery.appendChild(remove);
   });
   const add=document.createElement('button');add.type='button';add.className='btn btn-secondary mb-3';add.textContent='Add Venus battery';add.onclick=async()=>{await save(n=>{n.marstekDevices=n.marstekDevices||[];let id=1;while(n.marstekDevices.some(d=>d.id==='venus-'+id))id++;n.marstekDevices.push({id:'venus-'+id,enabled:true,name:'Venus battery',host:'',dischargeLimitW:800,maxChargeW:2500});});render();};settings.appendChild(add);
   field(settings,'Enable battery control','checkbox',c.marstekControlEnabled,(n,v)=>n.marstekControlEnabled=v,{description:'GivHome takes control after the battery check passes. Venus Manual schedules do not run while GivHome controls it.'});
   field(settings,'Cheap Overnight for Venus','checkbox',c.marstekOvernightEnabled!==false,(n,v)=>n.marstekOvernightEnabled=v);
   field(settings,'Pause Venus automation','checkbox',c.marstekAutomationHold,(n,v)=>n.marstekAutomationHold=v,{description:'Pauses automatic Venus plans. Monitoring continues.'});
   field(settings,'AIO reserve (%)','number',c.marstekSiteAioReserve??20,(n,v)=>n.marstekSiteAioReserve=v,{required:true,min:0,max:99});
   field(settings,'Venus reserve (%)','number',c.marstekSiteVenusReserve??20,(n,v)=>n.marstekSiteVenusReserve=v,{required:true,min:0,max:99});
   setEnabled();
  }
  render();return {setVisible(active){root.hidden=!active;if(active){render();if(!valid())homebridge.disableSaveButton();}},valid};
 }};
}());
