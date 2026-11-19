import test from 'node:test';import assert from 'node:assert/strict';
import {gameClock} from '../server/game-time.mjs';
import {normalizeGame} from '../server/game-normalize.mjs';
import {advanceFlight,flightCountdown} from '../web/dispatch.mjs';
test('native accelerated clock maps one real UTC day to a schedule week',()=>{
 const x=gameClock('2026-10-17T12:00:00.999Z');assert.equal(x.rate,7);assert.equal(x.dayIndex,3);assert.equal(x.date.toISOString(),'2026-10-15T12:00:00.000Z');
 assert.equal(gameClock('2026-10-18T00:00:00Z').dayIndex,0);
 assert.equal(gameClock('2026-10-17T12:00:00Z',{mode:'realtime'}).date.toISOString(),'2026-10-17T12:00:00.000Z');
});
test('active potion multiplies time of day by 42 and wraps weekly; expiry restores native phase',()=>{
 const potions=[{start:'2026-10-17T04:00:00Z',end:'2026-10-17T08:00:00Z'}];
 const x=gameClock('2026-10-17T05:00:00Z',{potions});assert.equal(x.rate,42);assert.equal(x.date.toISOString(),'2026-10-13T18:00:00.000Z');
 assert.equal(gameClock('2026-10-17T08:00:00Z',{potions}).rate,7);
 assert.equal(gameClock('2026-10-17T05:00:00Z',{mode:'realtime',potions}).rate,1);
});
test('real capture time is independent of accelerated flight phases and movement advances sevenfold',()=>{
 const real=new Date('2026-10-17T12:00:00Z'),v=gameClock(real).date;
 const input={player:{uid:'p'},aircraft:[{uid:'p',aircraftId:'a'}],routes:[],flights:[{uid:'p',flightId:'s',originAirport:'PVG',destinationAirport:'HND',departureDailyTimestamp:19*3600,outboundFlightDuration:180,inboundFlightDuration:180,aircraftAssignments:{a:{dowList:[3]}}}]};
 const s=normalizeGame(input,real,{operationalTime:v,fullCycle:true});assert.equal(s.capturedAt,real.toISOString());
 const f=s.flights.find(f=>f.direction==='out'&&f.status==='airborne');assert.ok(f);assert.equal(f.departure,'2026-10-15T11:00:00.000Z');
 const ap=Object.fromEntries(s.airports.map(a=>[a.id,a]));
 const first=advanceFlight(f,ap,v),next=advanceFlight(f,ap,gameClock(+real+60000).date);assert.ok(Math.abs((next.progress-first.progress)-7/180)<1e-8);
});

test('countdown reports real seconds under accelerated mode rather than schedule minutes',()=>{
 const f={status:'airborne',arrival:'2026-10-17T07:00:00Z'};assert.equal(flightCountdown(f,new Date('2026-10-17T06:53:00Z'),7),'1:00');assert.equal(flightCountdown(f,new Date('2026-10-17T06:53:07Z'),7),'0:59');assert.equal(flightCountdown(f,new Date('2026-10-17T06:53:00Z'),1),'7:00');
});
