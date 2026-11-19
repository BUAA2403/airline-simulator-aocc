import {position} from '../server/geometry.mjs';
export function flightCountdown(f,now,rate=1){
 const target=Date.parse(f.status==='airborne'?f.arrival:f.departure);
 if(!Number.isFinite(target)||!Number.isFinite(+now)||rate<=0)return '—';
 const seconds=Math.max(0,Math.ceil((target-(+now))/(rate*1000))),minutes=Math.floor(seconds/60);
 return `${minutes}:${String(seconds%60).padStart(2,'0')}`;
}
export function advanceFlight(f,airports,now){
 if(f.positionSource!=='schedule')return f;
 const t=+now,start=Date.parse(f.departure),end=Date.parse(f.arrival),a=airports[f.origin],b=airports[f.destination];
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return {...f,progress:null,lat:null,lon:null};
 const progress=Math.max(0,Math.min(1,(t-start)/(end-start))),status=t<start?'scheduled':t<end?'airborne':'arrived';
 return {...f,status,progress,...(status==='airborne'&&a&&b?position(a,b,progress):{lat:null,lon:null,heading:null})};
}
export function dispatchAlerts(aircraft,flights,now=Date.now(),turnaroundThreshold=5){
 const alerts=[];
 for(const a of aircraft){
  const legs=flights.filter(f=>f.aircraftId===a.id&&Date.parse(f.arrival)>now&&Date.parse(f.departure)<now+86400000).sort((a,b)=>Date.parse(a.departure)-Date.parse(b.departure));
  for(let i=1;i<legs.length;i++){
   const p=legs[i-1],f=legs[i],gap=(Date.parse(f.departure)-Date.parse(p.arrival))/60000;
   if(gap<0)alerts.push({id:`overlap:${p.id}:${f.id}`,severity:'critical',tail:a.registration,flightId:f.id,title:'排班重叠',detail:`${p.number} / ${f.number} 重叠 ${Math.ceil(-gap)} 分钟`});
   else if(p.destination!==f.origin)alerts.push({id:`gap:${p.id}:${f.id}`,severity:'warning',tail:a.registration,flightId:f.id,title:'航段衔接不连续',detail:`前班抵达 ${p.destination}，后班始发 ${f.origin}`});
   else if(gap<turnaroundThreshold)alerts.push({id:`turn:${p.id}:${f.id}`,severity:'warning',tail:a.registration,flightId:f.id,title:'短过站',detail:`${p.number} → ${f.number}，过站 ${Math.round(gap)} 分钟（关注阈值 ${turnaroundThreshold} 分钟）`});
  }
  if(!legs.length)alerts.push({id:`idle:${a.id}`,severity:'info',tail:a.registration,title:'未来 24 小时无任务',detail:'可检查飞机是否已完成排班；这是任务提示，不是故障报告。'});
 }
 return alerts.sort((a,b)=>({critical:0,warning:1,info:2}[a.severity]-{critical:0,warning:1,info:2}[b.severity]));
}
export function routePlans(flights,aircraft){
 const capacities=new Map(aircraft.map(a=>[a.id,a.capacity])),seen=new Set(),plans=new Map();
 for(const f of flights){
  if(!f.scheduleId)continue;
  const assignment=`${f.scheduleId}:${f.aircraftId}`;
  if(seen.has(assignment))continue;
  seen.add(assignment);
  const key=[f.origin,f.destination].sort().join('|');
  const p=plans.get(key)||{profit:0,pax:0,seats:0,profitKnown:true,paxKnown:true,seatsKnown:true};
  p.profitKnown&&=Number.isFinite(f.weeklyProfit);p.paxKnown&&=Number.isFinite(f.weeklyPassengers);
  const capacity=capacities.get(f.aircraftId),days=f.scheduledDays?.length;
  p.seatsKnown&&=Number.isFinite(capacity)&&days>0;
  p.profit+=f.weeklyProfit||0;p.pax+=f.weeklyPassengers||0;p.seats+=(capacity||0)*(days||0);plans.set(key,p);
 }
 return new Map([...plans].map(([key,p])=>[key,{weeklyProfit:p.profitKnown?p.profit:null,weeklyPax:p.paxKnown?p.pax:null,weeklySeats:p.seatsKnown?p.seats:null,loadFactor:p.paxKnown&&p.seatsKnown&&p.seats>0?p.pax/p.seats:null}]));
}
export function csvText(rows){
 return '\ufeff'+rows.map(row=>row.map(v=>{const text=typeof v==='number'&&Number.isFinite(v)?String(v):String(v??'').replace(/^[=+@\-]/,"'$&");return `"${text.replaceAll('"','""')}"`;}).join(',')).join('\r\n');
}
export function downloadCsv(name,rows){
 const url=URL.createObjectURL(new Blob([csvText(rows)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
