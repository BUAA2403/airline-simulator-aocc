import aircraftTypes from '../server/data/aircraft-types.json' with {type:'json'};
import {airlineBases} from '../server/bases.mjs';
import {addEquipmentSamples,equipmentFit,equipmentProfile,publishedExecution} from './schedule-equipment.mjs';

const DAY = 86400, WEEK = DAY * 7;
const DAYS = [0, 1, 2, 3, 4, 5, 6];
export const GAME_CONNECTION_MINUTES = 5;
export const LONG_HAUL_KM = 4000;
export const HAUL_OPTIONS = {balanced:'均衡',long:'优先长途',short:'优先短途'};
const PRODUCT_WEIGHT_MINUTES = 75;
const SPACING_WEIGHT_MINUTES = 12;
const ROUTE_SPACING_WEIGHT_MINUTES = 6;
const modelByName = new Map(aircraftTypes.map(model => [model.aircraft_model, model]));
// The game uses these representative models' wingspans for its airport categories.
const airportLimits = new Map(Object.entries({A388:'Airbus A380-800', B748:'Boeing 747-8',
  B77W:'Boeing 777-9', B764:'Boeing 767-400ER', A321:'Boeing 737 MAX 10', CRJX:'Embraer E195-E2'})
  .map(([code, model]) => [code, modelByName.get(model)?.wingspan]));
const mod = (value, period) => ((value % period) + period) % period;
const localDay = seconds => mod(Math.floor(seconds / DAY), 7);
const byStart = (a, b) => a.start - b.start || b.end - a.end;
const mapList = (map, key, value) => {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
};

export function scheduleLocalStamp(utcSeconds, offsetSeconds = 0) {
  const local = utcSeconds + offsetSeconds;
  const mins = Math.floor(mod(local, DAY) / 60);
  return `周${'一二三四五六日'[localDay(local)]} ${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

function readSchedule(row, airports) {
  const from = airports.get(row.origin), to = airports.get(row.destination);
  const {departureSeconds, outboundMinutes, inboundMinutes, turnaroundMinutes, distanceKm} = row;
  if (!row.id || !from || !to || from === to || ![from.utcOffsetSeconds, to.utcOffsetSeconds, departureSeconds,
    outboundMinutes, inboundMinutes, turnaroundMinutes, distanceKm].every(Number.isFinite) ||
    Math.abs(departureSeconds) > WEEK || outboundMinutes <= 0 || inboundMinutes <= 0 || turnaroundMinutes < 0 || distanceKm <= 0) return null;
  const flightSeconds = (outboundMinutes + inboundMinutes) * 60;
  const duration = flightSeconds + turnaroundMinutes * 60;
  if (duration >= WEEK || !row.assignments.every(a => a.aircraftId && a.days.every(d => DAYS.includes(d)))) return null;
  const start = departureSeconds - from.utcOffsetSeconds;
  const inStart = start + (outboundMinutes + turnaroundMinutes) * 60;
  return {...row, from, to, start, end:start + duration, duration, flightSeconds,
    assignedTails:new Set(row.assignments.map(a => a.aircraftId)),
    occupied:new Set(row.assignments.flatMap(a => a.days)),
    legs:[{number:row.outboundNumber, origin:row.origin, destination:row.destination, start, end:start + outboundMinutes * 60},
      {number:row.inboundNumber, origin:row.destination, destination:row.origin, start:inStart, end:start + duration}]};
}

function readRotation(root, schedules, parents) {
  const chain = [root], seen = new Set([root.id]);
  let row = root;
  while (row.childScheduleId) {
    const child = schedules.get(row.childScheduleId);
    if (!child || seen.has(child.id) || parents.get(child.id).length !== 1 || child.origin !== row.destination ||
      child.start < row.legs[0].end || child.end > row.legs[1].start) return null;
    chain.push(child);
    seen.add(child.id);
    row = child;
  }
  if ((root.isStopover && chain.length === 1) || chain.some(s => s.legs.some(leg => !leg.number))) return null;
  const legs = [...chain.map(s => s.legs[0]), ...chain.slice().reverse().map(s => s.legs[1])];
  return {id:root.id, root, chain, legs, origin:root.origin, destination:row.destination,
    path:[root.origin, ...chain.map(s => s.destination)],
    distanceKm:chain.reduce((sum,s)=>sum+s.distanceKm,0),
    flightMinutes:chain.reduce((sum, s) => sum + s.flightSeconds / 60, 0)};
}

// Dates here are seconds from a synthetic Monday. Wrapping keeps the same rules
// for every game week and exposes the preceding Sunday and following Monday.
function interval(schedule, day, native = false) {
  const start = mod((native ? schedule.departureSeconds : schedule.start) + day * DAY, WEEK);
  return {start, end:start + schedule.duration, origin:schedule.origin, schedule};
}

function intervalIndex(windows) {
  const sorted = windows.flatMap(window => [-WEEK, 0, WEEK, 2 * WEEK].map(shift => ({...window,
    start:window.start + shift, end:window.end + shift}))).sort(byStart);
  const lastEnding = [];
  for (const [index, window] of sorted.entries()) {
    const prev = lastEnding[index - 1];
    lastEnding.push(!prev || window.end > prev.end ? window : prev);
  }
  return {sorted, lastEnding};
}

function adjacent({sorted, lastEnding}, start) {
  let low = 0, high = sorted.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (sorted[mid].start < start) low = mid + 1;
    else high = mid;
  }
  return [lastEnding[low - 1], sorted[low]];
}

const numberDay = (leg, day, airports) => `${leg.number}|${localDay(leg.start + day * DAY + airports.get(leg.origin).utcOffsetSeconds)}`;
const routeKey = path => [path.join('|'),path.slice().reverse().join('|')].sort()[0];
const outboundDay = (rotation,day)=>localDay(rotation.root.departureSeconds+day*DAY);
const stationCode = value => typeof value==='string' && value.trim().toUpperCase()!=='EMPTY' ? value.trim() : '';
export const plannerHomeBase = aircraft => stationCode(aircraft?.homeBase);

export function buildScheduleAssistant(snapshot) {
  if (!Array.isArray(snapshot?.weeklySchedules)) return {status:'unavailable'};
  if (!snapshot.weeklySchedulesComplete) return {status:'incomplete'};
  const airports = new Map(snapshot.airports.map(a => [a.id, a]));
  const rows = snapshot.weeklySchedules.map(row => readSchedule(row, airports));
  const schedules = new Map(rows.filter(Boolean).map(row => [row.id, row]));
  if (schedules.size !== rows.length) return {status:'incomplete'};
  const parents = new Map(), tasksByTail = new Map(), numbersInUse = new Set();
  for (const schedule of schedules.values()) {
    if (schedule.childScheduleId) mapList(parents, schedule.childScheduleId, schedule.id);
    for (const {aircraftId, days} of schedule.assignments) {
      for (const day of days) mapList(tasksByTail, aircraftId, {schedule, day});
    }
    for (const day of schedule.occupied) {
      for (const leg of schedule.legs) numbersInUse.add(numberDay(leg, day, airports));
    }
  }
  const fleet = new Map(snapshot.aircraft.map(aircraft=>[aircraft.id,aircraft]));
  const equipment = new Map(snapshot.aircraft.map(aircraft=>[aircraft.id,equipmentProfile(aircraft,modelByName.get(aircraft.type))]));
  const rotations = [], allRotations = new Map(), routeEquipment = new Map(), routeOperatingDays = new Map();
  for (const schedule of schedules.values()) {
    if (parents.has(schedule.id)) continue;
    const rotation = readRotation(schedule, schedules, parents);
    if (!rotation) continue;
    const execution = publishedExecution(rotation.chain,fleet);
    const key = routeKey(rotation.path);
    const forward=rotation.path.join('|'), reverse=rotation.path.slice().reverse().join('|');
    if(!routeOperatingDays.has(forward)) routeOperatingDays.set(forward,new Set());
    if(!routeOperatingDays.has(reverse)) routeOperatingDays.set(reverse,new Set());
    for(const day of execution.operatingDays){
      routeOperatingDays.get(forward).add(outboundDay(rotation,day));
      const reverseLeg=rotation.legs[rotation.chain.length];
      routeOperatingDays.get(reverse).add(localDay(reverseLeg.start+day*DAY+airports.get(reverseLeg.origin).utcOffsetSeconds));
    }
    if (!routeEquipment.has(key)) routeEquipment.set(key,new Map());
    addEquipmentSamples(routeEquipment.get(key),execution,equipment);
    const openDays = DAYS.filter(day => !execution.occupiedDays.has(day) &&
      rotation.legs.every(leg => !numbersInUse.has(numberDay(leg, day, airports))));
    const service = {...rotation,execution,equipment:addEquipmentSamples(new Map(),execution,equipment),routeKey:key,routeDirection:forward};
    allRotations.set(service.id,service);
    if (openDays.length) rotations.push({...service, slots:openDays.map(day=>rotationSlot(service,day,airports))});
  }
  const bases = airlineBases(snapshot.airline,snapshot.airports).filter(base=>airports.has(base));
  return {status:'ready', airports, bases, rotations, allRotations, tasksByTail, equipment, routeEquipment, routeOperatingDays, fleet};
}

export function rotationSlot(rotation, day, airports) {
  return {id:`${rotation.id}:${day}`,day,utc:interval(rotation.root,day),native:interval(rotation.root,day,true),
    numberDays:rotation.legs.filter(leg=>leg.number).map(leg=>numberDay(leg,day,airports))};
}

export function directTrialRotation(airports, origin, destination, departureSeconds, distanceKm, {outboundMinutes,inboundMinutes,turnaroundMinutes}) {
  const root = readSchedule({id:`new:${origin}:${destination}:${departureSeconds}`,origin,destination,
    departureSeconds,distanceKm,outboundMinutes,inboundMinutes,turnaroundMinutes,
    outboundNumber:'',inboundNumber:'',assignments:[]},airports);
  if (!root) return null;
  return {id:root.id,root,chain:[root],origin,destination,flightMinutes:outboundMinutes+inboundMinutes,legs:root.legs};
}

function mayFly(rotation, model, aircraft) {
  const {root, chain} = rotation;
  // Adding a tail starts at its assigned hub. An existing assignment can be
  // extended in place, including a base-to-base flight entered in reverse.
  const homeBase = plannerHomeBase(aircraft);
  if (homeBase && !root.assignedTails.has(aircraft.id) && homeBase !== root.origin) return false;
  const airportAllows = airport => airport.maxAircraftCode === 'AT76' ? model.aircraft_class === 'ATR' :
    model.wingspan <= airportLimits.get(airport.maxAircraftCode);
  return chain.every(row => row.distanceKm <= model.range && airportAllows(row.from) && airportAllows(row.to));
}

// An empty, unbased tail can start at a configured base in a trial only.
// Never relocate a tail whose station or existing weekly duties are known.
export function aircraftTrialBases(assistant, aircraft) {
  if (assistant.status!=='ready' || !aircraft || plannerHomeBase(aircraft) || assistant.tasksByTail.has(aircraft.id)) return null;
  const station = stationCode(aircraft.location);
  return assistant.bases.filter(base=>!station||station===base);
}

export function aircraftAvailability(assistant, aircraft, released, trialBase) {
  const model = modelByName.get(aircraft?.type);
  if (assistant.status !== 'ready' || !aircraft || !model || aircraft.status === 'maintenance') return null;
  const tasks = (assistant.tasksByTail.get(aircraft.id)||[]).filter(({schedule,day})=>!released || day!==released.day || !released.rotation.chain.some(row=>row.id===schedule.id));
  const knownStation = stationCode(aircraft.location) || plannerHomeBase(aircraft) ||
    (trialBase&&aircraftTrialBases(assistant,aircraft)?.includes(trialBase)?trialBase:'');
  const utcIndex = intervalIndex(tasks.map(({schedule, day}) => interval(schedule, day)));
  const nativeIndex = intervalIndex(tasks.map(({schedule, day}) => interval(schedule, day, true)));
  return {model,aircraft,knownStation,hasTasks:!!tasks.length,utcIndex,nativeIndex};
}

export function eligibleForRotation(available,rotation) {
  return !!available && mayFly(rotation,available.model,available.aircraft) && (available.hasTasks||available.knownStation===rotation.origin);
}

export function canOperateRotation(aircraft,rotation) {
  const model=modelByName.get(aircraft?.type);
  return !!model&&aircraft.status!=='maintenance'&&mayFly(rotation,model,aircraft);
}

export function rotationNeighbors(available,slot) {
  return available?adjacent(available.utcIndex,slot.utc.start):[];
}

function availableSlot(available,rotation,slot,minimumMinutes) {
  const buffer = Math.max(minimumMinutes,GAME_CONNECTION_MINUTES)*60;
  const [previous,next] = adjacent(available.utcIndex,slot.utc.start);
  if ((previous&&previous.origin!==rotation.origin)||(next&&next.origin!==rotation.origin)) return null;
  const before = previous?slot.utc.start-previous.end:null, after = next?next.start-slot.utc.end:null;
  if ((before!==null&&before<buffer)||(after!==null&&after<buffer)) return null;
  const [nativePrev,nativeNext] = adjacent(available.nativeIndex,slot.native.start);
  if ((nativePrev&&slot.native.start-nativePrev.end<GAME_CONNECTION_MINUTES*60)||
    (nativeNext&&nativeNext.start-slot.native.end<GAME_CONNECTION_MINUTES*60)) return null;
  const delta = slot.utc.start-rotation.root.start;
  return {...slot,origin:rotation.origin,flightMinutes:rotation.flightMinutes,before,after,previous,next,
    legs:rotation.legs.map(leg=>({...leg,start:leg.start+delta,end:leg.end+delta}))};
}

export function checkRotationSlot(assistant,available,rotation,day,minimumMinutes=GAME_CONNECTION_MINUTES) {
  if (!eligibleForRotation(available,rotation)) return null;
  return availableSlot(available,rotation,rotationSlot(rotation,day,assistant.airports),minimumMinutes);
}

export function recommendForAircraft(assistant, aircraft, minimumMinutes = GAME_CONNECTION_MINUTES, trialBase) {
  const trialBases = aircraftTrialBases(assistant,aircraft);
  if (trialBases && !trialBases.includes(trialBase)) return [];
  const available = aircraftAvailability(assistant,aircraft,undefined,trialBase);
  if (!available) return [];
  const {model} = available;
  const candidateEquipment = assistant.equipment.get(aircraft.id) || equipmentProfile(aircraft,model);
  const recommendations = [];
  for (const rotation of assistant.rotations) {
    if (!eligibleForRotation(available,rotation)) continue;
    const matches = rotation.slots.map(slot=>availableSlot(available,rotation,slot,minimumMinutes)).filter(Boolean)
      .map(match=>({...match,routeDay:outboundDay(rotation,match.day)}));
    if (!matches.length) continue;
    const existingDays = rotation.execution.operatingDays;
    const routeDays = assistant.routeOperatingDays.get(rotation.routeDirection);
    const suggestedMatches = bestWeekdays(matches,minimumMinutes,existingDays,routeDays);
    const operatedDays = rotation.execution.operatingDays.size;
    const fit = equipmentFit(candidateEquipment,rotation.equipment,assistant.routeEquipment.get(rotation.routeKey));
    recommendations.push({...rotation,matches,suggestedMatches,operatedDays,fit,routeDays,fillsWeek:operatedDays+suggestedMatches.length===7,
      extraMinutes:suggestedMatches.length * rotation.flightMinutes,
      spacingGain:spacingImprovement(existingDays,suggestedMatches),
      routeSpacingGain:spacingImprovement(routeDays,suggestedMatches,'routeDay'),
      narrowestSeconds:Math.min(...suggestedMatches.flatMap(match => [match.before, match.after].filter(v => v !== null)))});
  }
  return recommendations.sort((a, b) => +b.fillsWeek - +a.fillsWeek || b.operatedDays - a.operatedDays ||
    b.suggestedMatches.length - a.suggestedMatches.length || quality(b) - quality(a) ||
    a.root.outboundNumber.localeCompare(b.root.outboundNumber, undefined, {numeric:true}));
}

const quality = row => row.extraMinutes + Math.min(row.narrowestSeconds / 60, 60) + PRODUCT_WEIGHT_MINUTES * row.fit.score +
  SPACING_WEIGHT_MINUTES*row.spacingGain+ROUTE_SPACING_WEIGHT_MINUTES*row.routeSpacingGain;

export function weeklySpacing(days) {
  const sorted = [...new Set(days)].sort((a,b)=>a-b);
  if (!sorted.length) return {longest:null,penalty:0};
  const gaps = sorted.map((day,i)=>(sorted[i+1]??sorted[0]+7)-day);
  return {longest:Math.max(...gaps),penalty:gaps.reduce((sum,gap)=>sum+gap*gap,0)-49/sorted.length};
}

function spacingImprovement(existing,matches,dayKey='day') {
  return weeklySpacing(existing).penalty-weeklySpacing([...existing,...matches.map(match=>match[dayKey])]).penalty;
}

function overlaps(a, b, gap) {
  return [-WEEK, 0, WEEK].some(shift => a.start < b.end + shift + gap && a.end + gap > b.start + shift);
}

export function matchesConflict(a, b, minimumMinutes = GAME_CONNECTION_MINUTES) {
  return a.id !== b.id && (overlaps(a.utc, b.utc, Math.max(minimumMinutes, GAME_CONNECTION_MINUTES) * 60) ||
    overlaps(a.native, b.native, GAME_CONNECTION_MINUTES * 60) || a.numberDays.some(key => b.numberDays.includes(key)));
}

export function extendTrial(picked, candidates, minimumMinutes = GAME_CONNECTION_MINUTES) {
  const result = [...picked], ids = new Set(picked.map(match => match.id));
  for (const match of candidates) {
    if (ids.has(match.id) || result.some(other => matchesConflict(match, other, minimumMinutes))) continue;
    result.push(match);
    ids.add(match.id);
  }
  return result;
}

export function matchesHaul(rotation,preference) {
  return preference==='short'?rotation.distanceKm<LONG_HAUL_KM:preference==='long'&&rotation.distanceKm>=LONG_HAUL_KM;
}

export function recommendTrial(rows, picked = [], minimumMinutes = GAME_CONNECTION_MINUTES, preference='balanced') {
  const spacingScore=(rotation,match)=>SPACING_WEIGHT_MINUTES*spacingImprovement(rotation.execution.operatingDays,[match])+
    ROUTE_SPACING_WEIGHT_MINUTES*spacingImprovement(rotation.routeDays,[match],'routeDay');
  const candidates = rows.flatMap(rotation=>rotation.matches.slice().sort((a,b)=>spacingScore(rotation,b)-spacingScore(rotation,a))
    .map(match=>({...match,rotation})));
  const priority = plan=>plan.filter(match=>matchesHaul(match.rotation,preference)).length;
  const byFlightTime = candidates.slice().sort((a,b)=>b.flightMinutes-a.flightMinutes);
  const byEnd = candidates.slice().sort((a,b)=>a.utc.end-b.utc.end || b.flightMinutes-a.flightMinutes);
  const byDuration = candidates.slice().sort((a,b)=>(a.utc.end-a.utc.start)-(b.utc.end-b.utc.start) || b.flightMinutes-a.flightMinutes);
  const byProduct = candidates.slice().sort((a,b)=>b.rotation.fit.score-a.rotation.fit.score || b.flightMinutes-a.flightMinutes);
  const orders = [candidates,byFlightTime,byEnd,byDuration,byProduct].map(order=>preference==='balanced'?order:
    order.slice().sort((a,b)=>+matchesHaul(b.rotation,preference)-+matchesHaul(a.rotation,preference)));
  // Try the best-ranked and longest individual matches as alternatives before
  // filling the rest of the week. This avoids locking into one greedy order.
  const seeds = new Set([...orders[0].slice(0,18),...orders[1].slice(0,18),...orders[4].slice(0,12)]);
  let best = [...picked], bestScore = trialScore(best), bestPriority=priority(best);
  const consider = (seed, order) => {
    const plan = extendTrial(seed,order,minimumMinutes), score = trialScore(plan), preferred=priority(plan);
    if (preferred>bestPriority || preferred===bestPriority&&score>bestScore) { best = plan; bestScore = score;bestPriority=preferred; }
  };
  for (const order of orders) consider(picked,order);
  for (const seed of seeds) {
    if (picked.some(match=>match.id===seed.id || matchesConflict(match,seed,minimumMinutes))) continue;
    consider([...picked,seed],orders[0]);
    consider([...picked,seed],orders[1]);
  }
  return best;
}

function trialScore(plan) {
  const groups = new Map(), routes=new Map();
  let score = 0;
  for (const match of trialWithConnections(plan)) {
    const {id, operatedDays, fit} = match.rotation;
    mapList(groups,id,match);
    mapList(routes,match.rotation.routeDirection,match);
    score += match.flightMinutes + operatedDays * 15 + Math.min(match.before ?? Infinity,match.after ?? Infinity,1800)/60 +
      PRODUCT_WEIGHT_MINUTES * fit.score;
  }
  for (const matches of groups.values()) {
    const {operatedDays,execution} = matches[0].rotation;
    if (matches.length+operatedDays===7) score+=240;
    score+=SPACING_WEIGHT_MINUTES*spacingImprovement(execution.operatingDays,matches);
  }
  for(const matches of routes.values())score+=ROUTE_SPACING_WEIGHT_MINUTES*spacingImprovement(matches[0].rotation.routeDays,matches,'routeDay');
  return score;
}

export function trialWithConnections(trial) {
  const index = intervalIndex(trial.map(match=>({...match.utc, schedule:match.rotation.root})));
  return trial.map(match=>{
    const [previous] = adjacent(index,match.utc.start);
    const [,next] = adjacent(index,match.utc.start+1);
    const closerPrevious = previous && (!match.previous || previous.end > match.previous.end);
    const closerNext = next && (!match.next || next.start < match.next.start);
    return {...match,
      previous:closerPrevious?previous:match.previous, before:closerPrevious?match.utc.start-previous.end:match.before,
      next:closerNext?next:match.next, after:closerNext?next.start-match.utc.end:match.after};
  });
}

export function bestWeekdays(matches, minimumMinutes, existingDays,routeDays, maxCount = 7) {
  let best = [], bestSpacing = weeklySpacing(existingDays), bestRoute=0;
  function visit(index, chosen) {
    if (chosen.length + matches.length - index < best.length) return;
    if (index === matches.length || chosen.length === maxCount) {
      const spacing = weeklySpacing([...existingDays,...chosen.map(match=>match.day)]);
      const route=spacingImprovement(routeDays,chosen,'routeDay');
      if (chosen.length>best.length || chosen.length===best.length&&
        (spacing.longest<bestSpacing.longest || spacing.longest===bestSpacing.longest&&
        (spacing.penalty<bestSpacing.penalty || spacing.penalty===bestSpacing.penalty&&route>bestRoute))) {
        best=chosen;
        bestSpacing=spacing;
        bestRoute=route;
      }
      return;
    }
    const match = matches[index];
    if (!chosen.some(other => matchesConflict(match, other, minimumMinutes))) visit(index + 1, [...chosen, match]);
    visit(index + 1, chosen);
  }
  visit(0, []);
  return best;
}
