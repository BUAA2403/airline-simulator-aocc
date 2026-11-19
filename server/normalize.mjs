import {airlineBases} from './bases.mjs';
import { haversine, position } from './geometry.mjs';

export const number = v => v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);
export const first = (...v) => v.find(x => x !== undefined && x !== null);
const id = v => v === undefined || v === null ? '' : String(v);
const timestamp = v => { if (v === null || v === undefined || v === '') return null; const d = new Date(typeof v === 'number' && v < 1e12 ? v * 1000 : v); return Number.isFinite(d.getTime()) ? d.toISOString() : null; };
const list = (v, label) => { if (!Array.isArray(v)) throw new Error(`${label} 必须为数组`); if (v.length > 100000) throw new Error(`${label} 超过 100000 条上限`); return v; };

export function validateSnapshot(input, source = 'import', now = new Date()) {
  const s = input?.snapshot ?? input;
  if (!s || typeof s !== 'object' || !s.airline || !Array.isArray(s.aircraft) || !Array.isArray(s.flights) || !Array.isArray(s.routes) || !Array.isArray(s.airports)) throw new Error('不支持此 JSON：请导入 AOCC 导出的 snapshot（需包含 airline、airports、aircraft、flights、routes）');
  const airports = list(s.airports, 'airports').map(a => {
    const lat = number(a.lat), lon = number(a.lon);
    if (lat === null || lon === null || Math.abs(lat)>90 || Math.abs(lon)>180) throw new Error(`机场 ${id(a.id || a.iata)} 坐标无效`);
    return { id: id(a.id || a.iata), iata: id(a.iata || a.id), name: id(a.name), city: id(a.city), country: id(a.country), lat, lon,utcOffsetSeconds:number(a.utcOffsetSeconds),maxAircraftCode:id(a.maxAircraftCode) };
  });
  const aircraft = list(s.aircraft, 'aircraft').map(a => ({ id: id(a.id), registration: id(a.registration),homeBase:id(a.homeBase), type: id(a.type), status: id(a.status || 'unknown'), location: id(a.location), flightId: id(a.flightId), capacity: number(a.capacity), condition: number(a.condition), utilization: number(a.utilization),cabins:a.cabins??null,capacitySource:id(a.capacitySource),nextFlightId:id(a.nextFlightId),weeklyFlightMinutes:number(a.weeklyFlightMinutes),deliveryDate:timestamp(a.deliveryDate),isFullyScheduled:!!a.isFullyScheduled }));
  const airportMap = new Map(airports.flatMap(a => [[a.id,a],[a.iata,a]]));
  const flights = list(s.flights, 'flights').map(f => {
    const departure = timestamp(f.departure), arrival = timestamp(f.arrival), start = departure && Date.parse(departure), end = arrival && Date.parse(arrival);
    const a = airportMap.get(id(f.origin)), b = airportMap.get(id(f.destination));
    const progress = start && end && end > start ? Math.max(0, Math.min(1, (now.getTime()-start)/(end-start))) : number(f.progress);
    const supplied = number(f.lat)!==null && number(f.lon)!==null && Math.abs(number(f.lat))<=90 && Math.abs(number(f.lon))<=180;
    const estimated = !supplied && a && b && progress!==null ? position(a,b,progress) : {};
    return { id:id(f.id), number:id(f.number), aircraftId:id(f.aircraftId), origin:id(f.origin), destination:id(f.destination), departure, arrival, status: id(f.status || (progress === null ? 'unknown' : progress<=0 ? 'scheduled' : progress>=1 ? 'arrived' : 'airborne')), lat:supplied ? number(f.lat) : estimated.lat ?? null, lon:supplied ? number(f.lon) : estimated.lon ?? null, heading:supplied ? number(f.heading) : estimated.heading ?? null, progress, positionSource:supplied ? (f.positionSource === 'schedule' ? 'schedule' : 'game') : 'schedule', passengers:number(f.passengers), revenue:number(f.revenue),scheduleId:id(f.scheduleId),childScheduleId:id(f.childScheduleId),direction:id(f.direction),scheduledDays:Array.isArray(f.scheduledDays)?f.scheduledDays:[],turnaroundMinutes:number(f.turnaroundMinutes),plannedPassengers:number(f.plannedPassengers),passengerSource:id(f.passengerSource),weeklyPassengers:number(f.weeklyPassengers),weeklyProfit:number(f.weeklyProfit),cabinPlan:f.cabinPlan??null };
  });
  const routes = list(s.routes, 'routes').map(r => { const a=airportMap.get(id(r.origin)),b=airportMap.get(id(r.destination)); return { id:id(r.id), origin:id(r.origin), destination:id(r.destination), flightsPerDay:number(r.flightsPerDay), distanceKm:number(r.distanceKm) ?? (a&&b ? haversine(a,b) : null), loadFactor:number(r.loadFactor), revenue:number(r.revenue), cost:number(r.cost) }; });
  for (const [name, rows] of [['airports',airports],['aircraft',aircraft],['flights',flights],['routes',routes]]) { const ids=rows.map(r=>r.id); if(ids.some(x=>!x) || new Set(ids).size!==ids.length) throw new Error(`${name} 包含缺失或重复的 id`); }
  const result = { schemaVersion:1, timing:s.timing?{mode:s.timing.mode==='realtime'?'realtime':'accelerated',potionState:s.timing.potionState==='known'?'known':'unavailable',potions:Array.isArray(s.timing.potions)?s.timing.potions.slice(0,1000).map(p=>({start:timestamp(p.start),end:timestamp(p.end)})).filter(p=>p.start&&p.end):[]}:null, capturedAt:timestamp(s.capturedAt) || now.toISOString(), airline:{id:id(s.airline.id), name:id(s.airline.name || '未命名航司'), code:id(s.airline.code), hub:airlineBases(s.airline,airports)[0]||'',hubs:airlineBases(s.airline,airports), cash:number(s.airline.cash), currency:id(s.airline.currency || 'USD')}, airports, aircraft, flights, routes, metrics:Object.fromEntries(Object.entries(s.metrics || {}).filter(([k,v]) => /^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(k) && (v===null || typeof v==='number' && Number.isFinite(v)))), provenance:{source,notes:Array.isArray(s.provenance?.notes) ? s.provenance.notes.filter(x=>typeof x==='string').slice(0,20) : []} };
  if (Array.isArray(s.weeklySchedules)) {
    result.weeklySchedulesComplete = s.weeklySchedulesComplete === true;
    result.weeklySchedules = list(s.weeklySchedules, 'weeklySchedules').map(row => ({
      id:id(row.id), origin:id(row.origin), destination:id(row.destination),
      departureSeconds:number(row.departureSeconds), outboundMinutes:number(row.outboundMinutes), inboundMinutes:number(row.inboundMinutes),
      turnaroundMinutes:number(row.turnaroundMinutes), distanceKm:number(row.distanceKm),
      outboundNumber:id(row.outboundNumber), inboundNumber:id(row.inboundNumber),
      childScheduleId:id(row.childScheduleId), isStopover:row.isStopover===true,
      assignments:list(row.assignments, 'weeklySchedules.assignments').map(a => ({aircraftId:id(a.aircraftId), days:list(a.days, 'weeklySchedules.assignments.days')}))
    }));
  }
  if(s.codeshares){
    const c=s.codeshares;
    const agreements=list(c.agreements||[], 'codeshares.agreements').filter(a=>a&&[id(a.operatingUid),id(a.marketingUid)].includes(result.airline.id)).map(a=>({id:id(a.id),operatingFlightId:id(a.operatingFlightId),operatingUid:id(a.operatingUid),marketingUid:id(a.marketingUid),role:id(a.operatingUid)===result.airline.id?'operating':'marketing',origin:id(a.origin),destination:id(a.destination),marketingOutboundFlightNumber:number(a.marketingOutboundFlightNumber),marketingInboundFlightNumber:number(a.marketingInboundFlightNumber),weeklyOperatingProfit:number(a.weeklyOperatingProfit),weeklyMarketingProfit:number(a.weeklyMarketingProfit)}));
    const normalized=validateSnapshot({airline:s.airline,airports:c.airports||[],aircraft:c.aircraft||[],flights:c.flights||[],routes:c.routes||[]},source,now);
    const partnerIds=new Set(agreements.flatMap(a=>[a.operatingUid,a.marketingUid]).filter(uid=>uid!==result.airline.id));
    result.codeshares={status:c.status==='available'?'available':'unavailable',agreements,partners:list(c.partners||[],'codeshares.partners').filter(p=>partnerIds.has(id(p.id))).map(p=>({id:id(p.id),name:id(p.name),code:id(p.code)})),airports:normalized.airports,routes:normalized.routes,aircraft:normalized.aircraft.map((a,i)=>({...a,operatorId:id(c.aircraft[i].operatorId),operatorName:id(c.aircraft[i].operatorName),operatorCode:id(c.aircraft[i].operatorCode)})),flights:normalized.flights.map((f,i)=>({...f,isCodeshare:true,operatingNumber:id(c.flights[i].operatingNumber),operatorId:id(c.flights[i].operatorId),operatorName:id(c.flights[i].operatorName),operatorCode:id(c.flights[i].operatorCode),marketingNumbers:Array.isArray(c.flights[i].marketingNumbers)?c.flights[i].marketingNumbers.filter(n=>typeof n==='string').slice(0,100):[],codeshareIds:Array.isArray(c.flights[i].codeshareIds)?c.flights[i].codeshareIds.filter(n=>typeof n==='string').slice(0,100):[]}))};
  }
  return result;

}
