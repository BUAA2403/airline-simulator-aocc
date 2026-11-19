import test from 'node:test';
import assert from 'node:assert/strict';
import {SyncEngine} from '../server/sync.mjs';
import {Store} from '../server/store.mjs';
import {normalizeGame} from '../server/game-normalize.mjs';
import {buildRoundTrips,groupDestinations,roundTripRows} from '../web/timetable-groups.mjs';
import {renderTimetableHtml} from '../web/timetable.mjs';

test('scheduled synchronization rebuilds destination groups and exports after additions, retiming and deletion',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const player={uid:'test',airlineName:'EXAMPLE AIR',airlineCode:'PL',hubAirports:['PEK']};
 const aircraft=[{uid:'test',aircraftId:'a',aircraftModel:'Airbus A330-300',registration:'B-1',hubAirport:'PEK'}];
 const flight=(id,origin,destination,extra={})=>({uid:'test',flightId:id,originAirport:origin,destinationAirport:destination,outboundFlightNumber:101,inboundFlightNumber:102,departureDailyTimestamp:3600,outboundFlightDuration:120,inboundFlightDuration:120,aircraftAssignments:{a:{dowList:[0,2,4]}},...extra});
 let plan=[flight('direct','PEK','SYD')];
 const store=new Store(':memory:'),events=[];
 const engine=new SyncEngine({store,vault:{load:async()=>({accessToken:'a'.repeat(50)}),save:async()=>{}},adapter:{read:async()=>normalizeGame({player,aircraft,flights:plan},new Date('2026-10-19T00:00:00Z'),{fullCycle:true})},onChange:state=>events.push(state)});
 const published=()=>{const s=engine.state().snapshot;return buildRoundTrips(s.flights,s.aircraft,s.airports,{hub:s.airline.hub});};
 try{
  await engine.initialize();t.mock.timers.tick(300);await engine.pending;
  assert.equal(groupDestinations(published())[0].rotations.length,1);
  plan=[...plan,flight('root','PEK','CAN',{childStopoverFlightId:'child'}),flight('child','CAN','SYD')];
  t.mock.timers.tick(60000);await engine.pending;
  let groups=published();assert.equal(groupDestinations(groups).length,1);assert.equal(groupDestinations(groups)[0].rotations.length,2);
  assert.equal(roundTripRows(groups).reduce((n,r)=>n+r.weeklyFlights,0),18);
  assert.ok(renderTimetableHtml({rows:roundTripRows(groups)}).includes('PEK → CAN → SYD'));
  plan=[flight('direct','PEK','SYD',{departureDailyTimestamp:7200})];
  t.mock.timers.tick(60000);await engine.pending;
  groups=published();assert.equal(groups.length,1);assert.equal(groups[0].legs[0].departure,'02:00');assert.equal(roundTripRows(groups).reduce((n,r)=>n+r.weeklyFlights,0),6);
  assert.ok(!renderTimetableHtml({rows:roundTripRows(groups)}).includes('PEK → CAN → SYD'));
  assert.equal(events.filter(s=>s.connection.status==='live').length,3);
 }finally{engine.close();store.close();t.mock.timers.reset();}
});
