import airportCatalog from '../server/data/airports.json' with {type:'json'};
import {haversine} from '../server/geometry.mjs';
import {estimateGameFlightMinutes,turnaroundMinutes} from '../server/game-rules.mjs';
import {airportTraffic,airportTrafficSource,routeReferences} from './route-market-reference.mjs';
import {aircraftAvailability,aircraftTrialBases,bestWeekdays,checkRotationSlot,directTrialRotation,eligibleForRotation,LONG_HAUL_KM,plannerHomeBase,weeklySpacing} from './schedule-assistant.mjs';
import {equipmentFit} from './schedule-equipment.mjs';

const DAY = 86400, WEEK = 7*DAY;
const DAYS = [0,1,2,3,4,5,6];
const EMPTY_DAYS = new Set();
const EMPTY_MARKET = {rotations:0,coverage:0,load:null,schedules:[],departures:new Map()};
const pair = (a,b) => [a,b].sort().join('|');
const mod = (n,m) => ((n%m)+m)%m;
const markets = new Map(airportCatalog.map(row=>[row.id,{
  id:row.id, iata:row.iata_code, name:row.airport_name, city:row.city, country:row.country,
  lat:row.latitude, lon:row.longitude, utcOffsetSeconds:row.timezone_offset, maxAircraftCode:row.max_aircraft,
  domestic:row.operations_limit==='domestic', exceptions:new Set(row.exceptions.split(',')),
  distanceLimit:Number(row.range_limit), index:(row.economy_index+row.tourism_index)/2,
}]));

function allowsMarket(airport, other, distanceKm) {
  if (airport.exceptions.has(other.iata)) return true;
  return (!airport.domestic || airport.country===other.country) &&
    (!Number.isFinite(airport.distanceLimit) || distanceKm<=airport.distanceLimit);
}

function routeInventory(snapshot) {
  const routePairs = new Set((snapshot.routes||[]).map(row=>pair(row.origin,row.destination)));
  const byPair = new Map();
  const observed = new Map();
  const assignmentKey = (scheduleId,aircraftId) => JSON.stringify([scheduleId,aircraftId]);
  for (const flight of snapshot.flights||[]) {
    if (!flight.scheduleId || !Number.isFinite(flight.weeklyPassengers) || flight.weeklyPassengers<0) continue;
    observed.set(assignmentKey(flight.scheduleId,flight.aircraftId),flight.weeklyPassengers);
  }
  const fleet = new Map(snapshot.aircraft.map(aircraft=>[aircraft.id,aircraft]));
  const airports = new Map(snapshot.airports.map(airport=>[airport.id,airport]));
  for (const row of snapshot.weeklySchedules) {
    const key = pair(row.origin,row.destination);
    routePairs.add(key);
    if (!byPair.has(key)) byPair.set(key,{rotations:0,measured:0,seats:0,passengers:0,schedules:[],departures:new Map()});
    const market = byPair.get(key);
    market.schedules.push(row);
    const start = row.departureSeconds-airports.get(row.origin).utcOffsetSeconds;
    const returnStart = start+(row.outboundMinutes+row.turnaroundMinutes)*60;
    for (const assignment of row.assignments) {
      market.rotations+=assignment.days.length;
      const seats=fleet.get(assignment.aircraftId)?.capacity;
      const passengers=observed.get(assignmentKey(row.id,assignment.aircraftId));
      if (seats>0 && passengers!==undefined) {
        market.measured+=assignment.days.length;
        market.seats+=seats*assignment.days.length;
        market.passengers+=passengers;
      }
      for (const [origin,time] of [[row.origin,start],[row.destination,returnStart]]) {
        if (!market.departures.has(origin)) market.departures.set(origin,[]);
        for (const day of assignment.days) market.departures.get(origin).push(mod(time+day*DAY,WEEK));
      }
    }
  }
  for (const route of byPair.values()) {
    route.load = route.seats ? route.passengers/route.seats : null;
    route.coverage = route.rotations ? route.measured/route.rotations : 0;
  }
  return {routePairs,byPair};
}

export function buildExpansionIndex(snapshot) {
  const {routePairs,byPair}=routeInventory(snapshot);
  const airports=new Map(markets);
  for (const airport of snapshot.airports) airports.set(airport.id,{...markets.get(airport.id),...airport});
  const shared=new Set((snapshot.codeshares?.agreements||[]).filter(row=>row.role==='marketing')
    .map(row=>pair(row.origin,row.destination)));
  const partnerFlights=new Map();
  for (const flight of snapshot.codeshares?.flights||[]) {
    const minutes=(Date.parse(flight.arrival)-Date.parse(flight.departure))/60000;
    if (!flight.scheduleId || !(minutes>0)) continue;
    const key=pair(flight.origin,flight.destination);
    if (!partnerFlights.has(key)) partnerFlights.set(key,new Map());
    const schedules=partnerFlights.get(key);
    const scheduleKey=JSON.stringify([flight.operatorId,flight.scheduleId]);
    if (!schedules.has(scheduleKey)) schedules.set(scheduleKey,new Map());
    schedules.get(scheduleKey).set(flight.origin,minutes);
  }
  return {airports,routePairs,byPair,shared,partnerFlights};
}

const routeHasDemand = market => market?.coverage>=0.75 && market.load>=0.8;
const scheduledDays = row => row.assignments.reduce((sum,assignment)=>sum+assignment.days.length,0);

function gameTiming(index,base,candidate) {
  const {airport,distanceKm,market}=candidate;
  const destination=airport.id;
  const defaultTurn=turnaroundMinutes(distanceKm);
  const saved=market?.schedules.slice().sort((a,b)=>Number(a.isStopover)-Number(b.isStopover) ||
    Number(b.origin===base)-Number(a.origin===base) || scheduledDays(b)-scheduledDays(a))[0];
  if (saved) {
    const sameDirection=saved.origin===base;
    return {outboundMinutes:sameDirection?saved.outboundMinutes:saved.inboundMinutes,
      inboundMinutes:sameDirection?saved.inboundMinutes:saved.outboundMinutes,
      turnaroundMinutes:sameDirection&&!saved.isStopover?saved.turnaroundMinutes:defaultTurn,source:'schedule'};
  }
  for (const legs of index.partnerFlights.get(pair(base,destination))?.values()||[]) {
    if (legs.has(base) && legs.has(destination)) return {outboundMinutes:legs.get(base),inboundMinutes:legs.get(destination),
      turnaroundMinutes:defaultTurn,source:'codeshare'};
  }
  const origin=index.airports.get(base);
  return {outboundMinutes:estimateGameFlightMinutes(origin,airport),inboundMinutes:estimateGameFlightMinutes(airport,origin),
    turnaroundMinutes:defaultTurn,source:'estimate'};
}

function avoidsExistingDepartures(match, market, minimumSeconds) {
  if (!market) return true;
  return match.legs.every(leg=>(market.departures.get(leg.origin)||[]).every(departure=>{
    const difference=mod(leg.start-departure,WEEK);
    return Math.min(difference,WEEK-difference)>=minimumSeconds;
  }));
}

function daylightPenalty(rotation, airports) {
  return rotation.legs.reduce((penalty,leg)=>{
    const departure=mod(leg.start+airports.get(leg.origin).utcOffsetSeconds,DAY)/3600;
    const arrival=mod(leg.end+airports.get(leg.destination).utcOffsetSeconds,DAY)/3600;
    return penalty+Number(departure<6 || departure>=23)+Number(arrival<6 || arrival>=23.5);
  },0);
}

function hasOvernightDeparture(rotation,airports,distanceKm) {
  const longHaul=distanceKm>=LONG_HAUL_KM;
  return rotation.legs.some(leg=>{
    const hour=mod(leg.start+airports.get(leg.origin).utcOffsetSeconds,DAY)/3600;
    return longHaul ? hour>=2 && hour<5 : hour<6 || hour>=23.5;
  });
}

function chooseDeparture(context, candidate) {
  const {airports,available,base,minimum,maxTrips,allowOvernight}=context;
  const {airport,distanceKm,market,timing}=candidate;
  const headway=(distanceKm>=LONG_HAUL_KM?120:90)*60;
  const offset=airports.get(base).utcOffsetSeconds;
  const servedDays=new Set((market?.departures.get(base)||[]).map(seconds=>Math.floor(mod(seconds+offset,WEEK)/DAY)));
  let best=null;
  for (let minute=0;minute<1440;minute+=15) {
    const rotation=directTrialRotation(airports,base,airport.id,minute*60,distanceKm,timing);
    if (!eligibleForRotation(available,rotation)) return null;
    if (!allowOvernight && hasOvernightDeparture(rotation,airports,distanceKm)) continue;
    const matches=DAYS.map(day=>checkRotationSlot({airports},available,rotation,day,minimum))
      .filter(match=>match && avoidsExistingDepartures(match,market,headway))
      .map(match=>({...match,routeDay:match.day}));
    if (!matches.length || matches.length<(best?.matches.length||1)) continue;
    const selected=bestWeekdays(matches,minimum,EMPTY_DAYS,servedDays,maxTrips);
    const spacing=weeklySpacing(selected.map(match=>match.day));
    const buffer=Math.min(120,...selected.flatMap(match=>[match.before??Infinity,match.after??Infinity]).map(n=>n/60));
    const fillsDays=market?selected.filter(match=>!servedDays.has(match.day)).length:0;
    const score=selected.length*1000-spacing.penalty*6-daylightPenalty(rotation,airports)*7+buffer/8+fillsDays*5;
    if (!best || score>best.score) best={rotation,matches:selected,score};
  }
  return best;
}

export function recommendExpansion(assistant, index, aircraft, {
  trialBase, mode='new', preference='balanced', maxTrips=3, minimum=15, query='', demandOnly=true, allowOvernight=false,
}={}) {
  if (assistant.status!=='ready') return {plans:[],base:''};
  const trialBases=aircraftTrialBases(assistant,aircraft);
  const base=plannerHomeBase(aircraft)||(trialBases?.includes(trialBase)?trialBase:'');
  if (!assistant.bases.includes(base)) return {plans:[],base:''};
  const available=aircraftAvailability(assistant,aircraft,undefined,trialBase);
  const from=index.airports.get(base);
  if (!available || !from?.exceptions || !Number.isFinite(from.utcOffsetSeconds)) return {plans:[],base};
  const search=query.trim();
  const exactCode=/^[A-Z]{3}$/.test(search) && index.airports.has(search)?search:null;
  const term=search.toLowerCase();
  const equipment=assistant.equipment.get(aircraft.id);
  const linkedDestinations=new Set();
  for (const rotation of assistant.allRotations.values()) {
    if (rotation.origin===base && rotation.execution.operatingDays.size) {
      for (const destination of rotation.path.slice(2)) linkedDestinations.add(destination);
    }
  }
  const candidates=[];
  for (const airport of index.airports.values()) {
    if (!airport.exceptions || !Number.isFinite(airport.utcOffsetSeconds) || airport.id===base ||
      airport.city===from.city && airport.country===from.country) continue;
    const key=pair(base,airport.id);
    const isExisting=index.routePairs.has(key);
    const market=mode==='extra'?(index.byPair.get(key)||EMPTY_MARKET):null;
    if (mode==='extra' ? !isExisting || demandOnly&&!routeHasDemand(market) : isExisting) continue;
    if (exactCode ? airport.id!==exactCode : term && ![airport.id,airport.city,airport.name,airport.country]
      .some(value=>value?.toLowerCase().includes(term))) continue;
    const distanceKm=haversine(from,airport);
    if (!Number.isFinite(distanceKm) || distanceKm<200 || distanceKm>available.model.range ||
      !allowsMarket(from,airport,distanceKm) || !allowsMarket(airport,from,distanceKm)) continue;
    const reference=routeReferences.get(key);
    const traffic=airportTraffic[airport.id];
    const codeshare=index.shared.has(key);
    const hasStopover=linkedDestinations.has(airport.id);
    const atOtherBase=assistant.bases.find(other=>other!==base&&index.byPair.get(pair(other,airport.id))?.rotations);
    const haulMatch=preference==='long' && distanceKm>=LONG_HAUL_KM || preference==='short' && distanceKm<LONG_HAUL_KM;
    const gameScore=Number.isFinite(airport.index)?Math.max(0,airport.index-50)*0.55:0;
    const marketScore=mode==='extra' ? (market.load??0)*65*market.coverage+Math.min(16,market.rotations/2) :
      (reference?42:0)+(traffic?Math.min(23,traffic/3_000_000):0)+(atOtherBase?5:0)-(codeshare?10:0);
    const routeEquipment=assistant.routeEquipment.get(key);
    const fit=mode==='extra' && routeEquipment?.size ? equipmentFit(equipment,routeEquipment,routeEquipment) : null;
    const productScore=fit ? fit.score*16 : equipment?.size==='wide'&&distanceKm<1000&&(traffic??0)<15_000_000&&!reference?-8:0;
    candidates.push({airport,distanceKm,market,reference,traffic,codeshare,hasStopover,atOtherBase,fit,haulMatch,
      rank:marketScore+gameScore+productScore});
  }
  const byRank=(a,b)=>Number(b.haulMatch)-Number(a.haulMatch) || b.rank-a.rank || a.airport.id.localeCompare(b.airport.id);
  candidates.sort(byRank);
  const plans=[];
  for (const candidate of candidates.slice(0,72)) {
    const {airport,distanceKm}=candidate;
    const route={origin:base,from,to:airport,distanceKm,assignedTails:new Set()};
    if (!eligibleForRotation(available,{origin:base,root:route,chain:[route]})) continue;
    const timing=gameTiming(index,base,candidate);
    const departure=chooseDeparture({airports:index.airports,available,base,minimum,maxTrips,allowOvernight},{...candidate,timing});
    if (!departure&&!term) continue;
    const trips=departure?.matches.length||0;
    const rank=candidate.rank+trips*9+Math.min(14,trips*(departure?.rotation.flightMinutes||0)/240);
    plans.push({...candidate,...departure,timing,rank,
      trafficSource:candidate.traffic?airportTrafficSource:null, minimum});
  }
  plans.sort(byRank);
  return {plans,base};
}
