import {buildTimetable,mergeAircraftAssignments} from './timetable.mjs';
import {routePlans} from './dispatch.mjs';

const routeKey=f=>[f.origin,f.destination].sort().join('|');
export function mergeServiceRows(rows){
 const groups=new Map();
 for(const r of rows){
  const key=JSON.stringify([r.number,r.origin,r.destination,r.departure,r.arrival,r.arrivalDayOffset,r.durationMinutes,...(!r.timezoneKnown||r.number==='未编号'?[r.key]:[])]);
  if(!groups.has(key))groups.set(key,{...r,key,days:[],weeklyFlights:0,registrations:[],scheduleKeys:[],assignments:[],equipment:[]});
  const target=groups.get(key);
  target.days=[...new Set([...target.days,...r.days])].sort();target.weeklyFlights+=r.weeklyFlights;
  target.registrations=[...new Set([...target.registrations,...r.registrations])].sort();target.scheduleKeys=[...new Set([...target.scheduleKeys,...r.scheduleKeys])];
  target.assignments=mergeAircraftAssignments(target.assignments,r.assignments);
  for(const e of r.equipment||[{type:r.type,classes:r.classes,days:r.days}]){
   let variant=target.equipment.find(v=>v.type===e.type&&v.classes===e.classes);
   if(!variant){variant={type:e.type,classes:e.classes,days:[]};target.equipment.push(variant);}
   variant.days=[...new Set([...variant.days,...e.days])].sort();
  }
  target.equipment.sort((a,b)=>a.type.localeCompare(b.type)||a.classes.localeCompare(b.classes));
  target.type=[...new Set(target.equipment.map(e=>e.type))].join(' / ');
  target.classes=[...new Set(target.equipment.map(e=>e.classes))].join(' / ');
 }
 return [...groups.values()];
}
export function scheduledOccurrence(row,flights,now,assignment=null){
 const keys=assignment?.scheduleKeys||row.scheduleKeys;
 const candidates=flights.filter(f=>f.origin===row.origin&&f.destination===row.destination&&(!assignment||f.aircraftId===assignment.aircraftId)&&keys.includes([f.scheduleId||f.id,f.aircraftId,f.direction||''].join('|'))).sort((a,b)=>Date.parse(a.departure)-Date.parse(b.departure));
 return candidates.find(f=>Date.parse(f.departure)<=+now&&Date.parse(f.arrival)>+now)||candidates.find(f=>Date.parse(f.departure)>+now)||candidates.at(-1)||null;
}
export function flightContext(f,snapshot){
 const flights=snapshot?.flights||[],aircraft=snapshot?.aircraft||[],airports=snapshot?.airports||[];
 const rows=mergeServiceRows(buildTimetable(flights,aircraft,airports));
 const numbered=f.number?flights.filter(x=>x.number===f.number):flights.filter(x=>x.scheduleId===f.scheduleId&&x.direction===f.direction);
 const numberIds=new Set(numbered.map(x=>x.aircraftId)),routeIds=new Set(flights.filter(x=>routeKey(x)===routeKey(f)).map(x=>x.aircraftId));
 const numberRows=rows.filter(r=>f.number?r.number===f.number:r.scheduleKeys.some(k=>numbered.some(x=>k===[x.scheduleId||x.id,x.aircraftId,x.direction||''].join('|'))));
 const routeRows=rows.filter(r=>routeKey(r)===routeKey(f)),tailRows=mergeServiceRows(buildTimetable(flights.filter(x=>x.aircraftId===f.aircraftId),aircraft,airports));
 const weekly=rs=>rs.reduce((n,r)=>n+r.weeklyFlights,0);
 return {number:{rows:numberRows,weeklyLegs:weekly(numberRows),aircraft:aircraft.filter(a=>numberIds.has(a.id))},route:{rows:routeRows,weeklyLegs:weekly(routeRows),aircraft:aircraft.filter(a=>routeIds.has(a.id)),plan:routePlans(flights,aircraft).get(routeKey(f)),record:snapshot?.routes?.find(r=>routeKey(r)===routeKey(f))},tail:{weeklyLegs:weekly(tailRows),rows:tailRows}};
}
