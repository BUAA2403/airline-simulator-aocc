const CLASS_LABELS = {wide:'宽体',narrow:'窄体',regional:'支线'};
const REGIONAL = new Set(['ATR','CRJ','ERJ','E135']);
const CABINS = [['first','F'],['biz','J'],['premEco','W'],['eco','Y']];

export function equipmentProfile(aircraft, model) {
  if (!Number.isFinite(model?.cabin_width)) return null;
  const size = model.cabin_width >= 4.5 ? 'wide' : REGIONAL.has(model.aircraft_class) ? 'regional' : 'narrow';
  const cabins = CABINS.every(([key])=>Number.isFinite(aircraft.cabins?.[key]?.numSeats)) ?
    Object.fromEntries(CABINS.filter(([key])=>aircraft.cabins[key].numSeats>0).map(([key,code])=>[code,aircraft.cabins[key].seatProduct])) : null;
  const classSeats = cabins?Object.fromEntries(CABINS.map(([key])=>[key,aircraft.cabins[key].numSeats])):null;
  return {type:aircraft.type, family:model.aircraft_class, size, sizeLabel:CLASS_LABELS[size],
    capacity:aircraft.capacity>0?aircraft.capacity:null, cabins, classSeats};
}

export function publishedExecution(chain, fleet) {
  const tails = new Map();
  for (const [sector, schedule] of chain.entries()) {
    for (const {aircraftId, days} of schedule.assignments) {
      if (!tails.has(aircraftId)) tails.set(aircraftId,new Map());
      const byDay = tails.get(aircraftId);
      for (const day of days) {
        if (!byDay.has(day)) byDay.set(day,new Set());
        byDay.get(day).add(sector);
      }
    }
  }
  const assignments = [], operatingDays = new Set(), occupiedDays = new Set();
  for (const [aircraftId, byDay] of tails) {
    const aircraft = fleet.get(aircraftId), grouped = new Map();
    for (const [day, indexes] of byDay) {
      occupiedDays.add(day);
      if (indexes.size===chain.length) operatingDays.add(day);
      const signature = [...indexes].join(',');
      if (!grouped.has(signature)) grouped.set(signature,{aircraftId, registration:aircraft?.registration,
        type:aircraft?.type, days:[], sectors:indexes.size===chain.length?[]:[...indexes].map(i=>chain[i].origin+' ↔ '+chain[i].destination)});
      grouped.get(signature).days.push(day);
    }
    for (const assignment of grouped.values()) {
      assignment.days.sort((a,b)=>a-b);
      assignments.push(assignment);
    }
  }
  assignments.sort((a,b)=>a.days[0]-b.days[0] || (a.registration||'').localeCompare(b.registration||''));
  return {assignments, operatingDays, occupiedDays};
}

export function addEquipmentSamples(target, execution, equipment) {
  for (const assignment of execution.assignments) {
    const profile = equipment.get(assignment.aircraftId);
    // A partial stopover is evidence about its segments, not the through service.
    if (!profile || assignment.sectors.length) continue;
    const count = target.get(profile) || 0;
    target.set(profile,count+assignment.days.length);
  }
  return target;
}

function cabinSimilarity(a,b) {
  if (!a || !b) return null;
  const classes = CABINS.map(([,code])=>code).filter(code=>Object.hasOwn(a,code)||Object.hasOwn(b,code));
  if (!classes.length) return null;
  const shared = classes.filter(code=>Object.hasOwn(a,code)&&Object.hasOwn(b,code));
  const products = shared.filter(code=>a[code] && b[code]);
  const productMatch = products.length ? products.filter(code=>a[code]===b[code]).length/products.length : 0.5;
  return (shared.length/classes.length)*0.75 + productMatch*0.25;
}

export function productDistance(a,b) {
  const size = a.size===b.size?0:0.42;
  const seats = a.capacity&&b.capacity ? 0.40*Math.abs(a.capacity-b.capacity)/Math.max(a.capacity,b.capacity) : 0;
  const classes = a.cabins&&b.cabins ? new Set([...Object.keys(a.cabins),...Object.keys(b.cabins)]) : null;
  const missing = classes?.size ? [...classes].filter(code=>Object.hasOwn(a.cabins,code)!==Object.hasOwn(b.cabins,code)).length/classes.size : 0;
  return size+seats+0.18*missing;
}

export function equipmentFit(candidate, service, route) {
  const reference = service.size ? service : route;
  if (!candidate || !reference.size) return {source:null, score:0, candidate};
  const source = service.size ? 'service' : 'route';
  let score = 0, total = 0, sameSize = 0, cabinKnown = 0, cabinTotal = 0, seatKnown = 0, seatTotal = 0;
  const sizes = new Map(), capacities = [];
  for (const [profile, count] of reference) {
    const comparable = candidate.size===profile.size;
    const capacityRatio = candidate.capacity && profile.capacity ? Math.min(candidate.capacity,profile.capacity)/Math.max(candidate.capacity,profile.capacity) : null;
    const cabin = cabinSimilarity(candidate.cabins,profile.cabins);
    const family = candidate.type===profile.type ? 0.2 : candidate.family===profile.family ? 0.12 : 0;
    score += count*((comparable?0.55:-0.55)+family+(capacityRatio===null?0:(2*capacityRatio-1)*0.12)+(cabin===null?0:(2*cabin-1)*0.18));
    total += count;
    if (comparable) sameSize += count;
    if (cabin!==null) { cabinKnown += count; cabinTotal += cabin*count; }
    sizes.set(profile.sizeLabel,(sizes.get(profile.sizeLabel)||0)+count);
    if (profile.capacity) {capacities.push(profile.capacity);seatKnown+=count;seatTotal+=profile.capacity*count;}
  }
  const sizeMatch = sameSize/total;
  const cabinFit = cabinKnown ? cabinTotal/cabinKnown : null;
  const types = [...sizes].sort((a,b)=>b[1]-a[1]);
  return {source, score:score/total*(source==='service'?1:0.75), sizeMatch, cabinFit, candidate,
    referenceMix:types.map(([size,count])=>({size, share:Math.round(count/total*100)})),
    capacityRatio:candidate.capacity&&seatKnown?candidate.capacity/(seatTotal/seatKnown):null,
    referenceCapacity:capacities.length?[Math.min(...capacities),Math.max(...capacities)]:null};
}
