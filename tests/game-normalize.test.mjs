import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeGame, turnaroundMinutes } from '../server/game-normalize.mjs';

const player = {uid:'polaris-1',airlineName:'EXAMPLE AIR',airlineCode:'PL',hubAirports:['PEK']};
const aircraft = [{uid:'polaris-1',aircraftId:'a1',aircraftModel:'Airbus A320neo',registration:'B-0001',hubAirport:'PEK'}];
const flight = (overrides = {}) => ({uid:'polaris-1',flightId:'f1',originAirport:'PEK',destinationAirport:'HND',
  outboundFlightNumber:101,inboundFlightNumber:102,departureDailyTimestamp:1800,
  outboundFlightDuration:120,inboundFlightDuration:150,turnaroundOffset:1,
  aircraftAssignments:{a1:{aircraftId:'a1',dowList:[0]}}, ...overrides});

test('Monday 0 schedule and origin local UTC+8 cross into previous UTC Sunday', () => {
  const s = normalizeGame({player,aircraft,flights:[flight()],routes:[]},new Date('2026-10-18T17:00:00Z'));
  const outbound = s.flights.find(f=>f.number==='PL101');
  assert.equal(outbound.departure,'2026-10-18T16:30:00.000Z');
  assert.equal(outbound.arrival,'2026-10-18T18:30:00.000Z');
  assert.equal(outbound.status,'airborne');
  assert.equal(outbound.progress,0.25);
  assert.equal(outbound.positionSource,'schedule');
  assert.equal(s.aircraft[0].flightId,outbound.id);
  assert.equal(s.aircraft[0].capacity,null);
  assert.equal(s.airline.cash,null);
});

test('return departure uses flight minutes plus native distance-tier turnaround and 15min offset', () => {
  const s=normalizeGame({player,aircraft,flights:[flight()],routes:[]},new Date('2026-10-18T17:00:00Z'));
  const inbound=s.flights.find(f=>f.number==='PL102');
  assert.equal(inbound.departure,'2026-10-18T20:15:00.000Z');
  assert.equal(inbound.arrival,'2026-10-18T22:45:00.000Z');
  assert.equal(inbound.origin,'HND');
  assert.equal(inbound.destination,'PEK');
  assert.equal(s.metrics.weeklyScheduledLegs,2);
});

test('UTC midnight retains yesterday departures still airborne and does not duplicate weekly cycles', () => {
  const s=normalizeGame({player,aircraft,flights:[flight({departureDailyTimestamp:7*3600,aircraftAssignments:{a1:{dowList:[1]}}})],routes:[]},new Date('2026-10-20T00:10:00Z'));
  const outbound=s.flights.find(f=>f.number==='PL101');
  assert.equal(outbound.departure,'2026-10-19T23:00:00.000Z');
  assert.equal(outbound.status,'airborne');
  assert.equal(s.flights.filter(f=>f.number==='PL101'&&f.departure==='2026-10-19T23:00:00.000Z').length,1);
  assert.equal(new Set(s.flights.map(f=>f.id)).size,s.flights.length);
  assert.ok(s.flights.some(f=>f.departure==='2026-10-26T23:00:00.000Z')); // rolling week, distinct occurrence
});

test('Sunday local departure with the game JFK UTC-4 offset carries into the next UTC Monday', () => {
  const s=normalizeGame({player,aircraft,flights:[flight({originAirport:'JFK',destinationAirport:'LHR',departureDailyTimestamp:23*3600+1800,aircraftAssignments:{a1:{dowList:[6]}}})],routes:[]},new Date('2026-10-19T04:00:00Z'));
  assert.equal(s.flights.find(f=>f.number==='PL101').departure,'2026-10-19T03:30:00.000Z');
  assert.equal(s.flights.find(f=>f.number==='PL101').status,'airborne');
});

test('JSON-encoded assignments decode and unknown IDs do not create fabricated aircraft', () => {
  const s=normalizeGame({player,aircraft,flights:[flight({aircraftAssignments:JSON.stringify({a1:{dowList:[0,0,7,-1,'1']},missing:{dowList:[0]}})})],routes:[]},new Date('2026-10-18T17:00:00Z'));
  assert.equal(s.flights.length,2);
  assert.equal(s.metrics.normalizationIssues,1);
  assert.equal(s.aircraft.length,1);
});

test('unscheduled sentinel and foreign airline rows never produce flights', () => {
  const s=normalizeGame({player,aircraft,flights:[flight({departureDailyTimestamp:-1}),flight({uid:'someone-else',flightId:'foreign'})],routes:[]},new Date('2026-10-18T17:00:00Z'));
  assert.equal(s.flights.length,0);
  assert.equal(s.aircraft[0].status,'idle');
  assert.equal(s.aircraft[0].utilization,0);
});

test('child stopover timestamps greater than 86400 preserve their original assigned day', () => {
  const s=normalizeGame({player,aircraft,flights:[flight({departureDailyTimestamp:90000,isStopover:true})],routes:[]},new Date('2026-10-19T17:15:00Z'));
  assert.equal(s.flights.find(f=>f.number==='PL101').departure,'2026-10-19T17:00:00.000Z');
});

test('turnaround thresholds exactly match native tiers', () => {
  assert.deepEqual([1499,1500,3999,4000,9999,10000].map(d=>turnaroundMinutes(d,2)),[90,120,120,150,150,180]);
});

test('extracted airport constants have signed timezones and valid unique coordinates', () => {
  const airports=JSON.parse(readFileSync(new URL('../server/data/airports.json',import.meta.url),'utf8'));
  assert.equal(new Set(airports.map(a=>a.id)).size,airports.length);
  assert.ok(airports.every(a=>Math.abs(a.latitude)<=90 && Math.abs(a.longitude)<=180 && Math.abs(a.timezone_offset)<=14*3600));
  assert.equal(airports.find(a=>a.id==='JFK').timezone_offset,-14400);
});

test('master gold balance converts game thousands into shared account cash, never airline cash', () => {
  const s=normalizeGame({master:{masterUid:'account',playerUidList:[player.uid,'subsidiary'],goldBalance:1234.5},player,aircraft,flights:[],routes:[]},new Date('2026-10-18T17:00:00Z'));
  assert.equal(s.metrics.accountCash,1234500);
  assert.equal(s.airline.cash,null);
  assert.ok(s.provenance.notes.some(n=>n.includes('集团共享现金') && n.includes('共用')));
  const foreign=normalizeGame({master:{playerUidList:['other'],goldBalance:1234.5},player,aircraft,flights:[],routes:[]});
  assert.equal(foreign.metrics.accountCash,null);
});

test('stored weekly economics are summed once, with no extra frequency or return-leg multiplier', () => {
  const s=normalizeGame({player,aircraft,flights:[flight({aircraftAssignments:{a1:{dowList:[0,2,4],flightProfit:250,ecoPax:900,premEcoPax:60,bizPax:30,firstPax:10}}})],routes:[]},new Date('2026-10-18T17:00:00Z'));
  assert.equal(s.metrics.weeklyScheduledLegs,6);
  assert.equal(s.metrics.weeklyPlannedProfit,250000);
  assert.equal(s.metrics.weeklyPlannedPassengers,1000);
  assert.ok(s.flights.every(f=>f.passengers===null && f.revenue===null));
});

test('missing stored economics remain unknown while explicit zeros are preserved', () => {
  const common={player,aircraft,routes:[]};
  const missing=normalizeGame({...common,flights:[flight()]});
  assert.equal(missing.metrics.weeklyPlannedProfit,null);
  assert.equal(missing.metrics.weeklyPlannedPassengers,null);
  const zero=normalizeGame({...common,flights:[flight({aircraftAssignments:{a1:{dowList:[0],flightProfit:0,ecoPax:0,premEcoPax:0,bizPax:0,firstPax:0}}})]});
  assert.equal(zero.metrics.weeklyPlannedProfit,0);
  assert.equal(zero.metrics.weeklyPlannedPassengers,0);
});
