import test from 'node:test';import assert from 'node:assert/strict';
import {advanceFlight,dispatchAlerts,routePlans} from '../web/dispatch.mjs';
import {cabinConfiguration} from '../server/cabin.mjs';
import {normalizeGame} from '../server/game-normalize.mjs';
const airports={A:{lat:0,lon:170},B:{lat:0,lon:-170}};
const leg={id:'f',aircraftId:'a',origin:'A',destination:'B',departure:'2026-10-17T00:00:00Z',arrival:'2026-10-17T02:00:00Z',positionSource:'schedule',status:'scheduled'};
test('a flight takes off, moves across the dateline and lands without a new network snapshot',()=>{
 assert.equal(advanceFlight(leg,airports,new Date('2026-10-16T23:59:59Z')).status,'scheduled');
 const p=advanceFlight(leg,airports,new Date('2026-10-17T01:00:00Z'));
 assert.equal(p.status,'airborne');assert.equal(p.progress,.5);assert.ok(Math.abs(Math.abs(p.lon)-180)<.001);
 const next=advanceFlight(leg,airports,new Date('2026-10-17T01:00:30Z'));assert.notEqual(next.lon,p.lon);
 const landed=advanceFlight({...leg,heading:90},airports,new Date('2026-10-17T02:00:00Z'));assert.equal(landed.status,'arrived');assert.equal(landed.lat,null);assert.equal(landed.heading,null);
});
test('measured positions are never overwritten by the schedule clock',()=>{const f={...leg,positionSource:'game',lat:4,lon:8};assert.equal(advanceFlight(f,airports,new Date()),f);});
test('rotation checks distinguish overlap, airport discontinuity and idle aircraft',()=>{
 const flights=[{...leg,number:'PL1'}, {...leg,id:'f2',number:'PL2',departure:'2026-10-17T01:00:00Z',arrival:'2026-10-17T03:00:00Z'}];
 const a=dispatchAlerts([{id:'a',registration:'B-1'},{id:'idle',registration:'B-2'}],flights,Date.parse('2026-10-17T00:30:00Z'));
 assert.ok(a.some(x=>x.title==='排班重叠'));assert.ok(a.some(x=>x.tail==='B-2'&&x.severity==='info'));
 const gap=dispatchAlerts([{id:'a'}],[leg,{...flights[1],departure:'2026-10-17T04:00:00Z',arrival:'2026-10-17T06:00:00Z'}],Date.parse('2026-10-17T00:30:00Z'));
 assert.ok(gap.some(x=>x.title==='航段衔接不连续'));
});
const mixed={aircraftModel:'Airbus A330-300',ecoRatio:.6593457134754211,ecoProduct:'standard',ecoConfigType:'dense',ecoPitch:31,bizRatio:.09330021860227318,bizProduct:'staggered',firstRatio:.16490271194820377,firstProduct:'private_suite',bizPitch:43,firstPitch:76,premEcoRatio:.08245135597410189,premEcoProduct:'comfort',premEcoPitch:38};
test('mixed cabin respects discrete rows, product layouts and certified aircraft limit',()=>{
 const c=cabinConfiguration(mixed);assert.deepEqual(['eco','premEco','biz','first'].map(k=>c.cabins[k].numSeats),[261,21,12,9]);assert.equal(c.capacity,303);assert.ok(c.capacity<440);assert.equal(c.cabins.eco.pitch,31);
 const allY=cabinConfiguration({...mixed,ecoRatio:1,premEcoRatio:0,bizRatio:0,firstRatio:0});assert.ok(allY.capacity>303&&allY.capacity<=440);assert.equal(allY.cabins.first.numSeats,0);
 assert.throws(()=>cabinConfiguration({...mixed,aircraftModel:'NOT A MODEL'}));
});
test('normalization retains cabin details and separates weekly averages from actual boarded passengers',()=>{
 const player={uid:'p',airlineCode:'PL'},aircraft=[{...mixed,uid:'p',aircraftId:'a'}],flights=[{uid:'p',flightId:'s',originAirport:'PVG',destinationAirport:'HND',outboundFlightNumber:1,inboundFlightNumber:2,departureDailyTimestamp:36000,outboundFlightDuration:180,inboundFlightDuration:180,aircraftAssignments:{a:{dowList:[0,1,2,3,4,5,6],ecoPax:2800,premEcoPax:140,bizPax:70,firstPax:28,flightProfit:100}}}];
 const s=normalizeGame({player,aircraft,flights,routes:[]},new Date('2026-10-17T00:00:00Z'));
 assert.equal(s.aircraft[0].capacity,303);assert.equal(s.aircraft[0].cabins.biz.numSeats,12);assert.ok(s.flights.some(f=>f.departure.startsWith('2026-10-22')));
 assert.equal(s.flights[0].cabinPlan.eco.averagePassengers,400);assert.equal(s.flights[0].passengers,null);assert.equal(s.flights[0].passengerSource,'weekly-average');
});
test('short turnaround threshold is configurable and accepts the game five-minute connection',()=>{
 const next={...leg,id:'f2',origin:'B',destination:'A',departure:'2026-10-17T02:05:00Z',arrival:'2026-10-17T04:05:00Z'};
 const a=[{id:'a'}],t=Date.parse('2026-10-17T00:30:00Z');
 assert.equal(dispatchAlerts(a,[leg,next],t).length,0);
 assert.equal(dispatchAlerts(a,[leg,next],t,15)[0].title,'短过站');
 assert.equal(dispatchAlerts(a,[leg,next],t,0).length,0);
});

test('route planning totals deduplicate repeated dates and both directions',()=>{
 const f={...leg,scheduleId:'s',weeklyProfit:1000,weeklyPassengers:1827,scheduledDays:[0,1,2,3,4,5,6]};
 const plans=routePlans([f,{...f,id:'return',origin:'B',destination:'A'},{...f,id:'nextweek'}],[{id:'a',capacity:261}]);
 assert.deepEqual(plans.get('A|B'),{weeklyProfit:1000,weeklyPax:1827,weeklySeats:1827,loadFactor:1});
 assert.equal(routePlans([{...f,weeklyPassengers:null}],[{id:'a',capacity:261}]).get('A|B').loadFactor,null);
});
