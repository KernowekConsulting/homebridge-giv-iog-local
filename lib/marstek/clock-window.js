'use strict';
const formats=new Map(),ends=new Map();
function clockWindow(nowMs,startText,endText,timeZone='Europe/London') {
 const parse=s=>{if(typeof s!=='string'||!/^\d{2}:\d{2}$/.test(s))throw Error('Invalid charging clock');const [h,m]=s.split(':').map(Number);if(h>23||m>59)throw Error('Invalid charging clock');return h*60+m;};
 const start=parse(startText),end=parse(endText);if(start===end||!Number.isFinite(nowMs))throw Error('Ambiguous charging window');
 if(!formats.has(timeZone))formats.set(timeZone,new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}));
 const parts=ms=>Object.fromEntries(formats.get(timeZone).formatToParts(ms).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
 const within=p=>{const m=p.hour*60+p.minute;return start<end ? m>=start&&m<end : m>=start||m<end;};
 const p=parts(nowMs);if(!within(p))return {active:false,endAtMs:null,occurrenceId:null};
 const anchor=new Date(Date.UTC(p.year,p.month-1,p.day,12));if(start>end&&p.hour*60+p.minute<end)anchor.setUTCDate(anchor.getUTCDate()-1);
 const key=`${timeZone}:${anchor.toISOString().slice(0,10)}:${startText}-${endText}`;
 let endAtMs=ends.get(key);
 if(!endAtMs){for(let t=Math.floor(nowMs/60000)*60000+60000;t<=nowMs+26*3600000;t+=60000){if(!within(parts(t))){endAtMs=t;break;}}if(!endAtMs)throw Error('Charging window end unresolved');if(ends.size>=16)ends.delete(ends.keys().next().value);ends.set(key,endAtMs);}
 return {active:true,endAtMs,occurrenceId:key};
}
module.exports={clockWindow};
