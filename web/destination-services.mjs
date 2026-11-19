import {buildRoundTrips,destinationRegion,REGIONS} from './timetable-groups.mjs';
import {buildTimetable} from './timetable.mjs';
const task=f=>[f.scheduleId||f.id,f.aircraftId,f.direction||''].join('|');

// Publish a base-origin service to every station on an explicitly linked route.
// Through services use real consecutive occurrences on the SAME aircraft.
export function buildDestinationServices(flights,aircraft,airports,{hub='',hubs=[],preferredBase='',basis='local'}={}){
 const native=buildRoundTrips(flights,aircraft,airports,{hub,hubs,preferredBase,basis});
 const stations=new Map(airports.flatMap(a=>[[a.id,a],[a.iata,a]])),index=new Map(),activities=new Map();
 for(const f of flights){const k=task(f);if(!index.has(k))index.set(k,[]);index.get(k).push(f);if(!activities.has(f.aircraftId))activities.set(f.aircraftId,new Map());activities.get(f.aircraftId).set([k,f.departure,f.arrival].join('|'),f);}
 for(const list of index.values())list.sort((a,b)=>Date.parse(a.departure)-Date.parse(b.departure));
 for(const [plane,records] of activities)activities.set(plane,[...records.values()].sort((a,b)=>Date.parse(a.departure)-Date.parse(b.departure)));
 const through=(parts,path,label)=>{
  if(parts.length<=1)return parts;
  const sequences=parts.map(r=>r.scheduleKeys.flatMap(k=>index.get(k)||[]));
  const synthetic=[];
  for(const first of sequences[0]){
   const chain=[first];
   for(const candidates of sequences.slice(1)){
    const previous=chain.at(-1),arrival=Date.parse(previous.arrival);
    const next=(activities.get(first.aircraftId)||[]).find(f=>Date.parse(f.departure)>=arrival);
    if(!next||next.origin!==previous.destination||Date.parse(next.departure)-arrival>604800000||!candidates.some(f=>task(f)===task(next)&&f.departure===next.departure))break;
    chain.push(next);
   }
   if(chain.length!==parts.length)continue;
   const last=chain.at(-1),numbers=[...new Set(chain.map(f=>f.number).filter(Boolean))];
   synthetic.push({...first,id:`through:${path.join('-')}:${first.id}`,scheduleId:`through:${path.join('-')}:${first.scheduleId||first.id}`,childScheduleId:'',number:numbers.join(' / '),destination:last.destination,arrival:last.arrival,componentScheduleKeys:chain.map(task)});
  }
  const rows=buildTimetable(synthetic,aircraft,airports,{basis});
  // Incomplete/misaligned source occurrences remain visible as their real legs;
  // never fabricate a next-week connection or omit a published flight.
  return rows.length?rows.map(r=>({...r,legLabel:label})):parts;
 };
 const result=[];
 for(const g of native){
  if(g.path.length<3){result.push(g);continue;}
  for(let end=1;end<g.path.length;end++){
   const path=g.path.slice(0,end+1),edges=path.slice(1).map((d,i)=>[path[i],d]);
   const out=g.legs.filter(r=>r.legLabel==='去程'&&edges.some(([o,d])=>r.origin===o&&r.destination===d));
   const back=g.legs.filter(r=>r.legLabel==='返程'&&edges.some(([o,d])=>r.origin===d&&r.destination===o));
   const destination=path.at(-1);
   result.push({...g,key:JSON.stringify([g.key,path]),destinationService:true,path,destination,destinationCity:stations.get(destination)?.city||destination,region:destinationRegion(stations.get(destination)),legs:[...through(out,path,'去程'),...through(back,[...path].reverse(),'返程')]});
  }
 }
 return result.sort((a,b)=>Number(a.extension)-Number(b.extension)||(a.baseOrder??0)-(b.baseOrder??0)||a.base.localeCompare(b.base)||REGIONS.indexOf(a.region)-REGIONS.indexOf(b.region)||a.destination.localeCompare(b.destination)||a.legs[0].departure.localeCompare(b.legs[0].departure));
}
