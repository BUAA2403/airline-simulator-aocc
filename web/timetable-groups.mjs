import {airlineBases,baseLabel} from '../server/bases.mjs';
import {buildTimetable,mergeAircraftAssignments} from './timetable.mjs';

import {REGIONS,destinationRegion} from './regions.mjs';
export {REGIONS,destinationRegion} from './regions.mjs';

// Join only explicit native child schedules, on the same aircraft and assigned
// days. Similar numbers or connecting airports alone never establish a stopover.
export function groupTimetable(rows,{hub='',hubs=[],preferredBase='',airports=[],aircraft=[]}={}){
 const bases=airlineBases({hub,hubs},airports),baseSet=new Set(bases),fleet=new Map(aircraft.map(a=>[a.id,a]));
 const stations=new Map(airports.flatMap(a=>[[a.id,a],[a.iata,a]])),assignments=new Map();
 for(const row of rows){
  const key=row.assignmentKey||row.key;
  if(!assignments.has(key))assignments.set(key,[]);assignments.get(key).push(row);
 }
 const nodes=[...assignments.values()].map(legs=>({legs,out:legs.find(r=>r.direction==='out')||legs[0]}));
 const byTask=new Map(nodes.map(n=>[JSON.stringify([n.out.scheduleId,n.out.aircraftId]),n]));
 const parents=new Map(),children=new Map();
 for(const n of nodes){
  const child=n.out.childScheduleId&&byTask.get(JSON.stringify([n.out.childScheduleId,n.out.aircraftId]));
  if(child&&child!==n&&n.out.destination===child.out.origin&&!parents.has(child)&&JSON.stringify([...n.out.scheduledDays].sort())===JSON.stringify([...child.out.scheduledDays].sort())){
   children.set(n,child);parents.set(child,n);
  }
 }
 const combined=new Map(),visited=new Set();
 const publish=root=>{
  if(visited.has(root))return;
  const chain=[];let node=root;
  while(node&&!visited.has(node)){chain.push(node);visited.add(node);node=children.get(node);}
  let path=[chain[0].out.origin,...chain.map(n=>n.out.destination)];
  let legs=[...chain.flatMap(n=>n.legs.filter(r=>r.direction!=='in').map(r=>({...r,legLabel:'去程'}))),...chain.slice().reverse().flatMap(n=>n.legs.filter(r=>r.direction==='in').map(r=>({...r,legLabel:'返程'})))];
  const rawHome=fleet.get(root.out.aircraftId)?.homeBase,home=stations.get(rawHome)?.id||rawHome;
  const startBase=baseSet.has(path[0]),endBase=baseSet.has(path.at(-1));
  const preferred=baseSet.has(preferredBase)&&[path[0],path.at(-1)].includes(preferredBase)?preferredBase:null;
  const orient=preferred?preferred===path.at(-1)&&path[0]!==preferred:endBase&&(!startBase||home===path.at(-1)&&home!==path[0]);
  if(orient){path.reverse();legs=[...legs.filter(r=>r.legLabel==='返程').map(r=>({...r,legLabel:'去程'})),...legs.filter(r=>r.legLabel==='去程').map(r=>({...r,legLabel:'返程'}))];}
  const base=path[0],destination=path.at(-1),extension=!baseSet.has(base),region=destinationRegion(stations.get(destination));
  const signature=JSON.stringify([path,legs.map(r=>[r.number,r.origin,r.destination,r.departure,r.arrival,r.arrivalDayOffset,r.type,r.classes,r.durationMinutes,r.days])]);
  if(!combined.has(signature))combined.set(signature,{key:signature,base,baseOrder:bases.indexOf(base),baseLabel:baseLabel(base,bases[0]),destination,path,baseCity:stations.get(base)?.city||base,destinationCity:stations.get(destination)?.city||destination,extension,region,legs:legs.map(r=>({...r,days:[...r.days],registrations:[...r.registrations],scheduleKeys:[...r.scheduleKeys]}))});
  else legs.forEach((r,i)=>{const target=combined.get(signature).legs[i];target.weeklyFlights+=r.weeklyFlights;target.assignments=mergeAircraftAssignments(target.assignments||[],r.assignments||[]);target.registrations=[...new Set([...target.registrations,...r.registrations])].sort();target.scheduleKeys=[...new Set([...target.scheduleKeys,...r.scheduleKeys])];});
 };
 for(const n of nodes.filter(n=>!parents.has(n)))publish(n);
 for(const n of nodes)publish(n); // Retain malformed/cyclic or incomplete chains.
 return [...combined.values()].sort((a,b)=>Number(a.extension)-Number(b.extension)||(a.baseOrder??0)-(b.baseOrder??0)||a.base.localeCompare(b.base)||REGIONS.indexOf(a.region)-REGIONS.indexOf(b.region)||a.destination.localeCompare(b.destination)||a.legs[0].departure.localeCompare(b.legs[0].departure));
}
export function buildRoundTrips(flights,aircraft,airports,{hub='',hubs=[],preferredBase='',basis='local'}={}){
 return groupTimetable(buildTimetable(flights,aircraft,airports,{basis,splitAssignments:true}),{hub,hubs,preferredBase,airports,aircraft});
}
export function filterRoundTrips(groups,{base='',region='',destination='',type='',query=''}={}){
 const q=query.trim().toLowerCase();
 return groups.filter(g=>(!base||(base==='extensions'?g.extension:g.base===base&&!g.extension))&&(!region||g.region===region)&&(!destination||g.destination===destination)&&(!type||g.legs.some(r=>r.type===type))&&[...g.path,g.baseCity,g.destinationCity,...g.legs.flatMap(r=>[r.number,r.type,r.originCity,r.destinationCity,...r.registrations])].join(' ').toLowerCase().includes(q));
}
export function groupDestinations(groups){
 const destinations=new Map();
 for(const g of groups){
  const key=JSON.stringify([g.base,g.destination]);
  if(!destinations.has(key))destinations.set(key,{...g,key,rotations:[]});
  destinations.get(key).rotations.push(g);
 }
 return [...destinations.values()];
}
// Compact the publication only, after filtering native assignments. Each leg
// keeps its own equipment weekdays, including returns across local midnight.
export function compactRotations(groups){
 const merged=new Map();
 for(const g of groups){
  const key=JSON.stringify([g.path,g.legs.map(r=>[r.number,r.origin,r.destination,r.departure,r.arrival,r.arrivalDayOffset,r.durationMinutes,r.legLabel,...(!r.timezoneKnown?[r.key]:[])])]);
  if(!merged.has(key))merged.set(key,{...g,key,legs:g.legs.map(r=>({...r,days:[],weeklyFlights:0,registrations:[],scheduleKeys:[],assignments:[],equipment:[]}))});
  g.legs.forEach((r,i)=>{
   const target=merged.get(key).legs[i];
   target.days=[...new Set([...target.days,...r.days])].sort();target.weeklyFlights+=r.weeklyFlights;target.assignments=mergeAircraftAssignments(target.assignments,r.assignments||[]);
   target.registrations=[...new Set([...target.registrations,...r.registrations])].sort();target.scheduleKeys=[...new Set([...target.scheduleKeys,...r.scheduleKeys])];
   for(const e of r.equipment||[{type:r.type,classes:r.classes,days:r.days}]){
    let variant=target.equipment.find(v=>v.type===e.type&&v.classes===e.classes);
    if(!variant){variant={type:e.type,classes:e.classes,days:[]};target.equipment.push(variant);}
    variant.days=[...new Set([...variant.days,...e.days])].sort();
   }
   target.equipment.sort((a,b)=>a.type.localeCompare(b.type)||a.classes.localeCompare(b.classes));
   target.type=[...new Set(target.equipment.map(e=>e.type))].join(' / ');
   target.classes=[...new Set(target.equipment.map(e=>e.classes))].join(' / ');
  });
 }
 return [...merged.values()];
}
export const roundTripRows=groups=>groups.flatMap(g=>g.legs.map(r=>({...r,publicationKey:g.key,destinationKey:JSON.stringify([g.base,g.destination]),path:g.path.join(' → '),via:g.path.slice(1,-1).join(' / '),destinationService:!!g.destinationService,section:`${g.extension?'其他始发':g.baseLabel||g.base+' 主基地'} · ${g.region}`,base:g.base,region:g.region,route:`${g.base} ↔ ${g.destination}`,legLabel:r.legLabel})));
