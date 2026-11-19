import {position,haversine} from '../server/geometry.mjs';
export const DAY_MS=86400000,WEEK_MS=DAY_MS*7;
export const weekDay=t=>'周'+'日一二三四五六'[new Date(t).getUTCDay()];
export const clockText=t=>new Date(t).toISOString().slice(11,16);
export const minutesText=m=>{const n=Math.round(m);return n<60?`${n}分钟`:`${Math.floor(n/60)}小时${n%60?`${n%60}分`:''}`;};
export function buildAircraftWeek(flights,aircraftId,now,{offsetSeconds=0}={}){
 const offset=Number.isFinite(offsetSeconds)?offsetSeconds*1000:0,t=+new Date(now)+offset;
 const midnight=Math.floor(t/DAY_MS)*DAY_MS,start=midnight-((new Date(t).getUTCDay()+6)%7)*DAY_MS-offset,end=start+WEEK_MS,seen=new Set();
 const tasks=[];
 for(const f of flights){
  const departure=Date.parse(f.departure),arrival=Date.parse(f.arrival);
  if(f.aircraftId!==aircraftId||!Number.isFinite(departure)||!Number.isFinite(arrival)||arrival<=departure||departure>=end||arrival<=start)continue;
  const key=JSON.stringify([f.scheduleId||f.id,f.aircraftId,f.direction,f.origin,f.destination,departure,arrival]);
  if(seen.has(key))continue;seen.add(key);
  tasks.push({...f,start:departure,end:arrival,durationMinutes:(arrival-departure)/60000,carryIn:departure<start,carryOut:arrival>end});
 }
 tasks.sort((a,b)=>a.start-b.start||a.end-b.end||a.id.localeCompare(b.id));
 const issues=[];
 for(let i=0;i<tasks.length;i++){
  const task=tasks[i],previous=tasks[i-1];
  task.index=i;task.groundMinutes=previous?Math.max(0,(task.start-previous.end)/60000):null;
  if(previous&&previous.end>task.start)issues.push({type:'overlap',from:previous.id,to:task.id});
  if(previous&&previous.destination!==task.origin)issues.push({type:'gap',from:previous.id,to:task.id});
 }
 const departures=tasks.filter(f=>!f.carryIn),flightMinutes=tasks.reduce((sum,f)=>sum+(Math.min(end,f.end)-Math.max(start,f.start))/60000,0);
 return {start,end,offset,tasks,departures:departures.length,flightMinutes,utilization:flightMinutes/(7*1440),airports:[...new Set(tasks.flatMap(f=>[f.origin,f.destination]))],issues};
}
export function timelineSegments(week){
 return Array.from({length:7},(_,day)=>{
  const start=week.start+day*DAY_MS,end=start+DAY_MS;
  return {day,start,segments:week.tasks.filter(f=>f.start<end&&f.end>start).map(f=>({task:f,left:(Math.max(start,f.start)-start)/DAY_MS,width:(Math.min(end,f.end)-Math.max(start,f.start))/DAY_MS,continuesBefore:f.start<start,continuesAfter:f.end>end}))};
 });
}
export function replayFrame(week,cursor,airports){
 const t=Math.max(week.start,Math.min(week.end,cursor)),active=week.tasks.find(f=>f.start<=t&&f.end>t);
 const previous=week.tasks.filter(f=>f.end<=t).sort((a,b)=>b.end-a.end)[0],next=week.tasks.find(f=>f.start>t);
 if(active){
  const origin=airports[active.origin],destination=airports[active.destination],progress=(t-active.start)/(active.end-active.start);
  const valid=origin&&destination&&[origin.lat,origin.lon,destination.lat,destination.lon].every(Number.isFinite);
  return {phase:'airborne',task:active,next,progress,location:null,coordinates:valid?position(origin,destination,progress):null,distanceKm:valid?haversine(origin,destination):null};
 }
 const location=previous?.destination||next?.origin||null,station=airports[location];
 return {phase:!week.tasks.length?'empty':t>=Math.max(...week.tasks.map(f=>f.end))?'complete':'ground',task:previous||next||null,next,progress:previous?1:0,location,coordinates:station&&Number.isFinite(station.lat)&&Number.isFinite(station.lon)?{lat:station.lat,lon:station.lon,heading:0}:null};
}
export function advanceReplay(week,cursor,deltaMs,{skipGround=true}={}){
 let t=Math.max(week.start,Math.min(week.end,cursor)),remaining=Math.max(0,deltaMs);
 const limit=Math.min(week.end,week.tasks.length?Math.max(...week.tasks.map(f=>f.end)):week.end);
 for(let i=0;i<=week.tasks.length*2+2&&remaining>0;i++){
  const active=week.tasks.find(f=>f.start<=t&&f.end>t);
  if(!active){
   const next=week.tasks.find(f=>f.start>t);
   if(!next)return limit;
   if(skipGround)t=next.start;
   else{const spend=Math.min(remaining,next.start-t);t+=spend;remaining-=spend;}
  }else{const spend=Math.min(remaining,active.end-t);t+=spend;remaining-=spend;}
 }
 return Math.min(limit,t);
}
