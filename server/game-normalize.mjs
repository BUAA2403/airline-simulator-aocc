import { readFileSync } from 'node:fs';
import { haversine } from './geometry.mjs';
import { validateSnapshot, number } from './normalize.mjs';
import {cabinConfiguration} from './cabin.mjs';
import {turnaroundMinutes} from './game-rules.mjs';
export {turnaroundMinutes} from './game-rules.mjs';

// Reference constants are extracted from the user-supplied Android 1.30.6 APK.
// See research/apk/READONLY-DATA-RESEARCH.md for the bytecode evidence.
const referenceAirports = JSON.parse(readFileSync(new URL('./data/airports.json', import.meta.url), 'utf8'));
const airportById = new Map(referenceAirports.flatMap(a => [[String(a.id), a], [a.iata_code, a], [a.icao_code, a]]));
const DAY = 86400000, WEEK = DAY * 7;
const str = x => x == null ? '' : String(x);
const round = x => Math.round(x * 100) / 100;
const assignmentObject = value => {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return null; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
};
const validDays = value => Array.isArray(value)
  ? [...new Set(value.filter(d => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6))]
  : [];

/** Convert native weekly schedules into UTC-day operations.
 * Aircraft positions are schedule estimates, never measured live telemetry.
 * Financial balances, condition, and seat capacity remain null when unavailable.
 */
export function normalizeGame({ master, player, aircraft = [], flights = [], routes = [] }, now = new Date(), options = {}) {
  if (Array.isArray(master)) master = master[0];
  if (Array.isArray(player)) player = player[0];
  if (!player?.uid) throw new Error('游戏 player 数据缺少 uid，无法确认航司');
  if (![aircraft, flights, routes].every(Array.isArray)) throw new Error('游戏数据格式错误：机队、航班、航线必须为数组');
  if ([aircraft, flights, routes].some(x => x.length > 100000)) throw new Error('游戏数据超过单表 100000 条限制');
  const realTime=+new Date(now);
  const time = options.operationalTime?+new Date(options.operationalTime):realTime;
  if (!Number.isFinite(time)) throw new Error('无效的运行时间');
  const current = new Date(time);
  const utcMidnight = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate());
  const monday = utcMidnight - ((current.getUTCDay() + 6) % 7) * DAY;
  const uid = str(player.uid);
  const owned = rows => rows.filter(row => row && str(row.uid) === uid);
  aircraft = owned(aircraft);
  flights = owned(flights);
  routes = owned(routes);
  const usedAirports = new Set(), generated = [], weeklySchedules = [], notes = [
    '航班由游戏周班表实时换算；星期一为 0，出发时间为始发地本地秒数，飞行时长为分钟。',
    '地图位置为班表与大圆航迹推算，未接入游戏遥测；游戏客户端的航路绕飞与显示错峰未复现。',
    '座位数量按安装包内原生客舱算法计算；载客为游戏保存的周预估，单航段显示周均分摊，不冒充实际登机人数。',
    '周计划利润及旅客缓存直接汇总游戏保存的周估算，不再乘频次或往返次数；旅客缓存是单向周口径，单班均值除以执飞天数；不是实际经营流水。'
  ];
  const problems = new Map();
  const issue = label => problems.set(label, (problems.get(label) || 0) + 1);
  const aircraftMap = new Map(aircraft.map(a => [str(a.aircraftId), a]));
  const cabinMap=new Map(aircraft.map(a=>{try{return [str(a.aircraftId),cabinConfiguration(a)];}catch{return [str(a.aircraftId),{capacity:null,cabins:null,capacitySource:'unavailable'}];}}));
  const rawFlightMap = new Map(flights.map(f => [str(f.flightId), f]));
  const weeklyMinutes = new Map(), assignedCounts = new Map(), routeFrequency = new Map();
  let weeklyLegs = 0, assignmentCount = 0, plannedProfit = 0, plannedPax = 0, profitKnown = 0, paxKnown = 0;
  let weeklySchedulesComplete = true;
  const scheduleIssue = label => { weeklySchedulesComplete = false; issue(label); };
  const flightNumber = n => n == null || n === '' || !Number.isInteger(Number(n)) || Number(n) < 0 ? '' : `${str(player.airlineCode)}${str(n)}`;
  const addAirport = code => {
    const airport = airportById.get(str(code));
    if (airport) usedAirports.add(airport.id);
    return airport;
  };
  for (const a of aircraft) addAirport(a.hubAirport);
  const hubList = Array.isArray(player.hubAirports) ? player.hubAirports : [];
  hubList.forEach(addAirport);

  for (const row of flights) {
    const baseId = str(row.flightId), origin = addAirport(row.originAirport), destination = addAirport(row.destinationAirport);
    const daily = number(row.departureDailyTimestamp), outbound = number(row.outboundFlightDuration), inbound = number(row.inboundFlightDuration);
    if (!baseId || !origin || !destination) { scheduleIssue('机场或航班标识缺失'); continue; }
    if (daily === -1 || daily === null) continue; // Native unscheduled sentinel.
    // Child stopover departure may exceed 86400; preserving that day is essential.
    if (Math.abs(daily) > 7 * 86400 || outbound === null || outbound <= 0 || outbound > 2880 || inbound === null || inbound <= 0 || inbound > 2880) {
      scheduleIssue('时间字段超出可验证范围'); continue;
    }
    const offset = number(row.turnaroundOffset) ?? 0;
    const distanceKm = haversine({lat:origin.latitude,lon:origin.longitude}, {lat:destination.latitude,lon:destination.longitude});
    const turnaround = turnaroundMinutes(distanceKm, offset);
    if (turnaround < 0 || turnaround > 7 * 24 * 60) { scheduleIssue('过站时间无效'); continue; }
    if (row.childStopoverFlightId && !rawFlightMap.has(str(row.childStopoverFlightId))) issue('经停子航班缺失');
    const assignments = assignmentObject(row.aircraftAssignments);
    if (!assignments) { scheduleIssue('机队分配 JSON 无效'); continue; }
    const schedule = {id:baseId, origin:origin.id, destination:destination.id, departureSeconds:daily,
      outboundMinutes:outbound, inboundMinutes:inbound, turnaroundMinutes:turnaround, distanceKm,
      outboundNumber:flightNumber(row.outboundFlightNumber), inboundNumber:flightNumber(row.inboundFlightNumber),
      childScheduleId:str(row.childStopoverFlightId), isStopover:row.isStopover===true, assignments:[]};
    weeklySchedules.push(schedule);
    const routeKey = [origin.id, destination.id].sort().join('|');
    for (const [key, assignment] of Object.entries(assignments)) {
      if (!assignment || typeof assignment !== 'object' || Array.isArray(assignment)) { scheduleIssue('机队分配格式无效'); continue; }
      const aircraftId = str(assignment.aircraftId || key);
      const days = validDays(assignment.dowList);
      if (!Array.isArray(assignment.dowList) || new Set(assignment.dowList).size !== days.length || !aircraftId) weeklySchedulesComplete = false;
      schedule.assignments.push({aircraftId, days});
      if (!aircraftMap.has(aircraftId)) { issue('航班分配的飞机未在当前机队'); continue; }
      if (!days.length) continue;
      assignmentCount++;
      // Native validateAndUpdateFlightData (39999) stores weeklyFlightProfit /
      // weeklyFlightPax directly in these assignment fields. They are already
      // weighted by dowList. Pax is one-direction weekly (24099/35484),
      // so divide by operating days, NOT the number of round-trip legs.
      const nativeProfit = number(assignment.flightProfit);
      if (nativeProfit !== null) { plannedProfit += nativeProfit; profitKnown++; }
      const cabinPax = ['ecoPax','premEcoPax','bizPax','firstPax'].map(k => number(assignment[k]));
      if (cabinPax.every(n => n !== null && n >= 0)) { plannedPax += cabinPax.reduce((a,b) => a+b,0); paxKnown++; }
      const legs = days.length * 2;
      weeklyLegs += legs;
      assignedCounts.set(aircraftId, (assignedCounts.get(aircraftId) || 0) + legs);
      weeklyMinutes.set(aircraftId, (weeklyMinutes.get(aircraftId) || 0) + days.length * (outbound + inbound));
      routeFrequency.set(routeKey, (routeFrequency.get(routeKey) || 0) + legs / 7);
      for (const dow of days) for (const week of [-1, 0, 1]) {
        const departure = monday + week * WEEK + dow * DAY + (daily - origin.timezone_offset) * 1000;
        const returnDeparture = departure + (outbound + turnaround) * 60000;
        for (const leg of [
          {direction:'out',start:departure,duration:outbound,from:origin,to:destination,num:row.outboundFlightNumber},
          {direction:'in',start:returnDeparture,duration:inbound,from:destination,to:origin,num:row.inboundFlightNumber}
        ]) {
          const end = leg.start + leg.duration * 60000;
          generated.push({
            id: `${baseId}:${aircraftId}:${dow}:${leg.direction}:${Math.floor(departure / DAY)}`,
            number: flightNumber(leg.num),
            aircraftId, origin:leg.from.id, destination:leg.to.id,
            departure:new Date(leg.start).toISOString(), arrival:new Date(end).toISOString(),
            status: time < leg.start ? 'scheduled' : time >= end ? 'arrived' : 'airborne',
            positionSource:'schedule', passengers:null, revenue:null,
            scheduleId:baseId,childScheduleId:rawFlightMap.has(str(row.childStopoverFlightId))?str(row.childStopoverFlightId):'',direction:leg.direction,scheduledDays:days,turnaroundMinutes:turnaround,
            plannedPassengers:cabinPax.every(n=>n!==null)?round(cabinPax.reduce((a,b)=>a+b,0)/days.length):null,
            passengerSource:'weekly-average',weeklyPassengers:cabinPax.every(n=>n!==null)?cabinPax.reduce((a,b)=>a+b,0):null,
            weeklyProfit:nativeProfit===null?null:nativeProfit*1000,
            cabinPlan:Object.fromEntries(['eco','premEco','biz','first'].map((k,n)=>[k,{weeklyPassengers:cabinPax[n],averagePassengers:cabinPax[n]===null?null:round(cabinPax[n]/days.length),fare:number(assignment[`${k}Price`])}])),
            _start:leg.start, _end:end
          });
        }
      }
    }
  }
  generated.sort((a,b) => a._start - b._start || a.id.localeCompare(b.id));
  const grouped = new Map();
  for (const f of generated) {
    if (!grouped.has(f.aircraftId)) grouped.set(f.aircraftId, []);
    grouped.get(f.aircraftId).push(f);
  }
  const normalizedAircraft = aircraft.map(a => {
    const aircraftId = str(a.aircraftId), schedule = grouped.get(aircraftId) || [];
    const airborne = schedule.filter(f => f._start <= time && f._end > time);
    const next = schedule.find(f => f._start > time);
    const previous = schedule.findLast(f => f._end <= time);
    if (airborne.length > 1) issue('同一飞机同时有多个班表任务');
    return {id:aircraftId, registration:str(a.registration), type:str(a.aircraftModel),
      status:airborne.length === 1 ? 'airborne' : airborne.length > 1 ? 'unknown' : assignedCounts.has(aircraftId) ? 'scheduled' : 'idle',
      location:airborne.length ? '' : (previous?.destination || next?.origin || str(a.hubAirport)),homeBase:addAirport(a.hubAirport)?.id||str(a.hubAirport),
      flightId:airborne.length === 1 ? airborne[0].id : '',
      ...cabinMap.get(aircraftId),condition:null,deliveryDate:a.deliveryDate,isFullyScheduled:!!a.isFullyScheduled,
      nextFlightId:next?.id||'',weeklyFlightMinutes:weeklyMinutes.get(aircraftId)||0,
      utilization:weeklyMinutes.has(aircraftId) ? round(weeklyMinutes.get(aircraftId) / (7 * 1440) * 100) : 0};
  });
  const normalizedRoutes = routes.map(r => {
    const a = addAirport(r.originAirport), b = addAirport(r.destinationAirport);
    const key = [a?.id || str(r.originAirport), b?.id || str(r.destinationAirport)].sort().join('|');
    return {id:str(r.routeId), origin:a?.id || str(r.originAirport), destination:b?.id || str(r.destinationAirport),
      flightsPerDay:round(routeFrequency.get(key) || 0), distanceKm:null, loadFactor:null, revenue:null, cost:null};
  });
  // Flights may exist before a player_route_data entry is persisted.
  const routeKeys = new Set(normalizedRoutes.map(r => [r.origin,r.destination].sort().join('|')));
  for (const [key,frequency] of routeFrequency) if (!routeKeys.has(key)) {
    const [origin,destination] = key.split('|');
    normalizedRoutes.push({id:`schedule:${key}`,origin,destination,flightsPerDay:round(frequency),distanceKm:null,loadFactor:null,revenue:null,cost:null});
  }
  for (const [label,count] of problems) notes.push(`${label}：${count} 条；请检查游戏班表或数据版本。`);
  const gameDollars = amount => Number.isFinite(amount * 1000) ? round(amount * 1000) : null;
  // goldBalance belongs to the shared MasterPlayer, not an individual airline.
  // Native StaticResourceDisplay (28505) presents this amount with a "$ ... K" suffix.
  const masterOwnsAirline = Array.isArray(master?.playerUidList) && master.playerUidList.some(id => str(id) === uid);
  const gold = masterOwnsAirline ? number(master.goldBalance) : null;
  const accountCash = gold !== null && gold >= 0 ? gameDollars(gold) : null;
  if (accountCash !== null) notes.push('集团共享现金来自 MasterPlayer.goldBalance × 1000，单位为游戏美元；由账户下所有子航司共用。');
  const economicsComplete = problems.size === 0;
  const normalizedAirports = [...usedAirports].map(id => airportById.get(id)).filter(Boolean).map(a => ({id:a.id,iata:a.iata_code,name:a.airport_name,city:a.city,country:a.country,lat:a.latitude,lon:a.longitude,utcOffsetSeconds:a.timezone_offset,maxAircraftCode:a.max_aircraft}));
  const visibleFlights = options.fullCycle?generated.filter(f=>f._start>=monday-DAY&&f._start<monday+WEEK*2):generated.filter(f => f._start >= utcMidnight-DAY && f._start < utcMidnight + DAY*7 || f._start < utcMidnight && f._end > time);
  const snapshot = {
    schemaVersion:1,capturedAt:new Date(realTime).toISOString(),timing:options.timing,
    airline:{id:uid,name:str(player.airlineName || '未命名航司'),code:str(player.airlineCode),hub:str(hubList[0] || aircraft[0]?.hubAirport),hubs:[...new Set((hubList.length?hubList:[aircraft[0]?.hubAirport]).filter(Boolean).map(code=>addAirport(code)?.id||str(code)))],cash:null,currency:'USD'},
    airports:normalizedAirports,aircraft:normalizedAircraft,flights:visibleFlights,routes:normalizedRoutes,
    weeklySchedules,weeklySchedulesComplete,
    metrics:{weeklyScheduledLegs:weeklyLegs,scheduledAssignments:assignmentCount,gameFlightRows:flights.length,
      normalizationIssues:[...problems.values()].reduce((a,b)=>a+b,0), accountCash,seatDataCoverage:normalizedAircraft.filter(a=>a.capacity!==null).length,
      weeklyPlannedProfit:economicsComplete && profitKnown === assignmentCount ? gameDollars(plannedProfit) : null,
      weeklyPlannedPassengers:economicsComplete && paxKnown === assignmentCount ? round(plannedPax) : null},
    provenance:{source:'game',notes}
  };
  return validateSnapshot(snapshot, 'game', new Date(time));
}
