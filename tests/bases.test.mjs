import test from 'node:test';
import assert from 'node:assert/strict';
import {airlineBases,aircraftBase} from '../server/bases.mjs';
import {normalizeGame} from '../server/game-normalize.mjs';
import {validateSnapshot} from '../server/normalize.mjs';
import {buildPublicationSections} from '../web/timetable-sections.mjs';
import {filterRoundTrips} from '../web/timetable-groups.mjs';
import {trafficSnapshot} from '../web/codeshares.mjs';
import {renderTimetableHtml,timetableCsv} from '../web/timetable.mjs';
import {createAnalysisExport} from '../server/analysis-export.mjs';
import {SyncEngine} from '../server/sync.mjs';
import {Store} from '../server/store.mjs';

const now=new Date('2026-10-26T00:00:00Z');
const player={uid:'own',airlineName:'EXAMPLE AIR',airlineCode:'CA',hubAirports:['PEK','PVG']};
const aircraft=[{uid:'own',aircraftId:'pvg',registration:'B-PVG',aircraftModel:'Airbus A330-300',hubAirport:'PVG'},{uid:'own',aircraftId:'pek',registration:'B-PEK',aircraftModel:'Airbus A320-200',hubAirport:'PEK'}];
const flight=(id,from,to,tail='pvg',extra={})=>({uid:'own',flightId:id,originAirport:from,destinationAirport:to,outboundFlightNumber:101,inboundFlightNumber:102,departureDailyTimestamp:36000,outboundFlightDuration:120,inboundFlightDuration:120,turnaroundOffset:0,aircraftAssignments:{[tail]:{dowList:[0,2],flightProfit:100,ecoPax:200,premEcoPax:0,bizPax:0,firstPax:0}},...extra});
const snapshot=(flights=[],p=player)=>normalizeGame({player:p,aircraft,flights,routes:[]},now,{fullCycle:true});
const publish=s=>buildPublicationSections(s.flights,s.aircraft,s.airports,{hub:s.airline.hub,hubs:s.airline.hubs})[0];

test('all configured bases and aircraft home bases survive normalization, validation, traffic filtering and AI export',async()=>{
 const s=snapshot([flight('tokyo','PVG','NRT')]);
 assert.deepEqual(s.airline.hubs,['PEK','PVG']);assert.equal(s.aircraft[0].homeBase,'PVG');
 const copy=validateSnapshot(s,'game',now);assert.deepEqual(copy.airline.hubs,s.airline.hubs);assert.equal(copy.aircraft[0].homeBase,'PVG');
 assert.ok(trafficSnapshot(s,'own').airports.some(a=>a.id==='PEK'));assert.ok(trafficSnapshot(s,'own').airports.some(a=>a.id==='PVG'));
 const {data}=await createAnalysisExport({snapshot:s,connection:{source:'game',status:'live'},now});assert.deepEqual(data.airline.hubs,['PEK','PVG']);assert.equal(data.configuration.fleet[0].homeBase,'PEK');assert.equal(data.configuration.fleet.find(a=>a.id==='pvg').homeBase,'PVG');
 assert.ok(data.publishedTimetableLocal.every(r=>r.base==='PVG'));
 const rows=publish(s).rows;assert.ok(renderTimetableHtml({rows}).includes('PVG 基地'));assert.ok(!renderTimetableHtml({rows}).includes('PVG 主基地'));assert.ok(timetableCsv(rows,'local').slice(1).every(r=>r.includes('PVG')));
});
test('PVG-origin, reversed routes and explicit stopovers all publish from the configured secondary base',()=>{
 const s=snapshot([flight('direct','NRT','PVG'),flight('root','PVG','ICN','pvg',{childStopoverFlightId:'child',turnaroundOffset:24}),flight('child','ICN','NRT','pvg',{departureDailyTimestamp:50400})]);
 const section=publish(s);assert.ok(section.groups.every(g=>g.base==='PVG'&&!g.extension));
 assert.ok(section.groups.some(g=>g.path.join('-')==='PVG-ICN'));
 assert.ok(section.groups.some(g=>g.path.join('-')==='PVG-ICN-NRT'));
 assert.ok(section.groups.every(g=>g.legs[0].origin==='PVG'));
 assert.equal(filterRoundTrips(section.groups,{base:'PVG'}).length,section.groups.length);assert.equal(filterRoundTrips(section.groups,{base:'extensions'}).length,0);
});
test('a base-to-base service uses the assigned aircraft home base once, without duplicate flights',()=>{
 const s=snapshot([flight('between','PEK','PVG')]),g=publish(s).groups;
 assert.equal(g.length,1);assert.equal(g[0].base,'PVG');assert.equal(g[0].destination,'PEK');assert.equal(g[0].legs[0].origin,'PVG');assert.equal(g[0].legs.reduce((n,r)=>n+r.weeklyFlights,0),4);
 const scoped=buildPublicationSections(s.flights,s.aircraft,s.airports,{hub:s.airline.hub,hubs:s.airline.hubs,base:'PEK'})[0];
 assert.equal(scoped.groups.length,1);assert.equal(scoped.groups[0].base,'PEK');assert.equal(scoped.groups[0].legs[0].origin,'PEK');assert.equal(scoped.rows.reduce((n,r)=>n+r.weeklyFlights,0),4);
});
test('legacy hub snapshots still work, aliases canonicalize, and destinations never become bases by inference',()=>{
 assert.deepEqual(airlineBases({hub:'PEK'}),['PEK']);assert.deepEqual(airlineBases({hub:'PEK',hubs:['PVG','PVG','HND',null,12]},[{id:'TOKYO',iata:'HND'}]),['PVG','TOKYO']);
 assert.equal(aircraftBase({homeBase:'PVG'},{hub:'PEK'}),'PVG');
 const s=snapshot([flight('not-a-base','CAN','NRT')]);assert.ok(publish(s).groups.every(g=>g.extension));assert.deepEqual(s.airline.hubs,['PEK','PVG']);
});
test('automatic sync adds and removes future bases in the publication without changing any AOCC configuration',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let hubs=['PEK','PVG'];const store=new Store(':memory:');
 const engine=new SyncEngine({store,vault:{load:async()=>({accessToken:'a'.repeat(50)}),save:async()=>{}},adapter:{read:async()=>snapshot([flight('cantokyo','CAN','NRT')],{...player,hubAirports:hubs})}});
 try{
  await engine.initialize();t.mock.timers.tick(300);await engine.pending;assert.equal(publish(engine.snapshot).groups[0].extension,true);
  hubs=['PEK','PVG','CAN'];t.mock.timers.tick(60000);await engine.pending;assert.deepEqual(engine.snapshot.airline.hubs,hubs);assert.equal(publish(engine.snapshot).groups[0].base,'CAN');assert.equal(publish(engine.snapshot).groups[0].extension,false);
  hubs=['PEK'];t.mock.timers.tick(60000);await engine.pending;assert.equal(publish(engine.snapshot).groups[0].extension,true);
 }finally{engine.close();store.close();t.mock.timers.reset();}
});
