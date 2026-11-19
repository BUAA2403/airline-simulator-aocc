import {aircraftAvailability,canOperateRotation,checkRotationSlot,eligibleForRotation,GAME_CONNECTION_MINUTES,matchesConflict,rotationNeighbors,rotationSlot} from './schedule-assistant.mjs';
import {productDistance} from './schedule-equipment.mjs';

const CABINS=['first','biz','premEco','eco'];
const MATERIAL_DIFFERENCE=0.11;
const IMPROVEMENT=0.025;
const demandKey = (scheduleId,aircraftId) => JSON.stringify([scheduleId,aircraftId]);
const seatSpan = duties => {
  const seats = duties.map(duty=>duty.profile.capacity).filter(Number.isFinite);
  return seats.length?[Math.min(...seats),Math.max(...seats)]:null;
};
const productKey = profile => profile.size+':'+profile.capacity;
const similarCapacity = (a,b)=>a.size===b.size&&Math.abs(a.capacity-b.capacity)/Math.max(a.capacity,b.capacity)<=0.17;

export function buildConsistencyIndex(assistant,flights) {
  const services = new Map(), reports=[], demand = new Map();
  if (assistant.status!=='ready') return {reports,services,demand};
  for (const flight of flights) {
    if (!flight.scheduleId || !flight.cabinPlan || flight.isCodeshare) continue;
    const key = demandKey(flight.scheduleId,flight.aircraftId);
    if (!demand.has(key)) demand.set(key,{});
    const expected = demand.get(key);
    for (const cabin of CABINS) {
      const average = flight.cabinPlan[cabin]?.averagePassengers;
      if (Number.isFinite(average)&&average>=0) expected[cabin]=Math.max(expected[cabin]??0,Math.ceil(average));
    }
  }
  for (const rotation of assistant.allRotations.values()) {
    const duties = [];
    for (const day of rotation.execution.operatingDays) {
      const active = rotation.execution.assignments.filter(a=>a.days.includes(day));
      if (active.length!==1||active[0].sectors.length) continue;
      const aircraft = assistant.fleet.get(active[0].aircraftId), profile = assistant.equipment.get(active[0].aircraftId);
      if (!aircraft||!profile?.capacity) continue;
      duties.push({day,aircraft,profile});
    }
    if (!duties.length) continue;
    duties.sort((a,b)=>a.day-b.day);
    const products = new Map();
    for (const duty of duties) {
      const key=productKey(duty.profile);
      if(!products.has(key)) products.set(key,{key,profile:duty.profile,days:[]});
      products.get(key).days.push(duty.day);
    }
    const ranked = [...products.values()].map(option=>({...option,
      distance:duties.reduce((sum,duty)=>sum+productDistance(duty.profile,option.profile),0)}))
      .sort((a,b)=>a.distance-b.distance||b.days.length-a.days.length||b.profile.capacity-a.profile.capacity);
    const options=[];
    for(const option of ranked) if(!options.some(other=>similarCapacity(option.profile,other.profile))) options.push(option);
    const spread = Math.max(0,...duties.flatMap(a=>duties.map(b=>productDistance(a.profile,b.profile))));
    const service = {rotation,duties,options,spread,seatSpan:seatSpan(duties)};
    services.set(rotation.id,service);
    if (spread>=MATERIAL_DIFFERENCE) reports.push(service);
  }
  return {services,demand,reports:reports.sort((a,b)=>b.spread-a.spread||
    b.seatSpan[1]-b.seatSpan[0]-(a.seatSpan[1]-a.seatSpan[0])||a.rotation.root.outboundNumber.localeCompare(b.rotation.root.outboundNumber))};
}

export function consistencyTargets(assistant,service) {
  const options=service.options.slice();
  const available=new Map();
  for(const [id,profile] of assistant.equipment){
    if(!profile?.capacity||!profile.classSeats||!canOperateRotation(assistant.fleet.get(id),service.rotation)) continue;
    const key=productKey(profile);
    if(!available.has(key)) available.set(key,{key,profile,days:[],count:0});
    available.get(key).count++;
  }
  const alternatives=[...available.values()].sort((a,b)=>b.count-a.count||
    productDistance(a.profile,options[0].profile)-productDistance(b.profile,options[0].profile));
  for(const option of alternatives) {
    if(!options.some(existing=>similarCapacity(existing.profile,option.profile))) options.push(option);
    if(options.length>=service.options.length+3) break;
  }
  return options;
}

// Use the game's per-cabin weekly average when available. For a missing
// estimate, preserve the old number of configured seats in that cabin.
function protectsCabins(index,rotation,duty,replacement) {
  if (!replacement.classSeats) return false;
  return rotation.chain.every(row=>{
    const forecast = index.demand.get(demandKey(row.id,duty.aircraft.id));
    return CABINS.every(cabin=>{
      const required = forecast?.[cabin]??duty.profile.classSeats?.[cabin];
      return Number.isFinite(required)&&replacement.classSeats[cabin]>=required;
    });
  });
}

export function consistencyAdvice(assistant,index,service,targetKey,minimum=GAME_CONNECTION_MINUTES) {
  const {rotation,duties}=service, options=targetKey?consistencyTargets(assistant,service):service.options;
  const target=options.find(option=>option.key===targetKey)||options[0];
  const targetDays=duties.filter(duty=>productDistance(duty.profile,target.profile)<MATERIAL_DIFFERENCE).length;
  const available = new Map(), released = new Map();
  const regular = aircraft=>{
    if (!available.has(aircraft.id)) available.set(aircraft.id,aircraftAvailability(assistant,aircraft));
    return available.get(aircraft.id);
  };
  const afterRelease = (duty,rotation)=>{
    const key = JSON.stringify([duty.aircraft.id,rotation.id,duty.day]);
    if (!released.has(key)) released.set(key,aircraftAvailability(assistant,duty.aircraft,{rotation,day:duty.day}));
    return released.get(key);
  };
  const results=[];
  for (const duty of duties) {
    const distance=productDistance(duty.profile,target.profile);
    if (distance<MATERIAL_DIFFERENCE) continue;
    const primarySlot=rotationSlot(rotation,duty.day,assistant.airports);
    const ideas=[];
    let capacityOptions=0;
    for (const [id,replacement] of assistant.equipment) {
      if (!replacement?.capacity||id===duty.aircraft.id||!similarCapacity(replacement,target.profile)) continue;
      const improvement=distance-productDistance(replacement,target.profile);
      if (improvement<IMPROVEMENT) continue;
      const tail=assistant.fleet.get(id), availability=regular(tail);
      if (!eligibleForRotation(availability,rotation)||!protectsCabins(index,rotation,duty,replacement)) continue;
      capacityOptions++;
      const represent=(match,swap=null)=>{
        const revised = duties.map(item=>item===duty ? {...item,profile:replacement} : item);
        const [previous,next]=rotationNeighbors(afterRelease(duty,rotation),primarySlot);
        ideas.push({tail,profile:replacement,match,improvement,swap,releasedMatch:{...primarySlot,origin:rotation.origin,previous,next},seatSpan:seatSpan(revised),
          targetDays:revised.filter(item=>productDistance(item.profile,target.profile)<MATERIAL_DIFFERENCE).length});
      };
      const direct=checkRotationSlot(assistant,availability,rotation,duty.day,minimum);
      if (direct) {represent(direct);continue;}
      for (const task of assistant.tasksByTail.get(id)||[]) {
        const other=index.services.get(task.schedule.id);
        if (!other||other.rotation.id===rotation.id||other.rotation.origin!==rotation.origin) continue;
        const otherDuty=other.duties.find(item=>item.day===task.day&&item.aircraft.id===id);
        if (!otherDuty||!matchesConflict(primarySlot,rotationSlot(other.rotation,task.day,assistant.airports),minimum)) continue;
        const baseline=other.options[0].profile;
        if (productDistance(duty.profile,baseline)>productDistance(otherDuty.profile,baseline)+IMPROVEMENT||
          !protectsCabins(index,other.rotation,otherDuty,duty.profile)) continue;
        const intoPrimary=checkRotationSlot(assistant,afterRelease(otherDuty,other.rotation),rotation,duty.day,minimum);
        if (!intoPrimary) continue;
        const intoOther=checkRotationSlot(assistant,afterRelease(duty,rotation),other.rotation,otherDuty.day,minimum);
        if (intoOther) represent(intoPrimary,{rotation:other.rotation,day:otherDuty.day,match:intoOther});
      }
    }
    ideas.sort((a,b)=>b.improvement-a.improvement||+!!a.swap-+!!b.swap||
      Math.min(b.match.before??Infinity,b.match.after??Infinity)-Math.min(a.match.before??Infinity,a.match.after??Infinity)||
      a.tail.registration.localeCompare(b.tail.registration));
    results.push({duty,ideas:ideas.slice(0,3),blocked:!ideas.length?(capacityOptions?'schedule':'capacity'):null});
  }
  return {target,results,targetDays};
}
