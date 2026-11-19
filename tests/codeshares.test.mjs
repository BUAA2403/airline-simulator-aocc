import test from 'node:test';
import assert from 'node:assert/strict';
import {readCodeshares,normalizeCodeshares} from '../server/codeshares.mjs';
import {normalizeGame} from '../server/game-normalize.mjs';
import {validateSnapshot} from '../server/normalize.mjs';
import {trafficSnapshot} from '../web/codeshares.mjs';
import {buildTimetable} from '../web/timetable.mjs';
import {createAnalysisExport} from '../server/analysis-export.mjs';

const now=new Date('2026-10-19T12:00:00Z');
const player={uid:'own',airlineName:'EXAMPLE AIR',airlineCode:'PA',hubAirports:['PEK']};
const partner={uid:'partner',airlineName:'Partner Airways',airlineCode:'XY',hubAirports:['LHR']};
const plane=(uid,id)=>({uid,aircraftId:id,aircraftModel:'Airbus A320neo',registration:id.toUpperCase(),hubAirport:'LHR'});
const flight=(uid,id,aircraftId,extra={})=>({uid,flightId:id,originAirport:'LHR',destinationAirport:'JFK',outboundFlightNumber:11,inboundFlightNumber:12,departureDailyTimestamp:36000,outboundFlightDuration:420,inboundFlightDuration:400,turnaroundOffset:0,aircraftAssignments:{[aircraftId]:{aircraftId,dowList:[0,2,4],flightProfit:100,ecoPax:300,premEcoPax:0,bizPax:0,firstPax:0}},...extra});
const deal=(extra={})=>({codeshareId:'deal',operatingFlightId:'foreign-flight',operatingUid:'partner',marketingUid:'own',originAirport:'LHR',destinationAirport:'JFK',marketingOutboundFlightNumber:9001,marketingInboundFlightNumber:9002,marketingCarrierProfit:23,operatingCarrierProfit:12,...extra});
const own={aircraft:[plane('own','own-plane')],flights:[flight('own','own-flight','own-plane')],routes:[]};
const raw=(agreements=[deal()])=>({status:'available',agreements,partners:[partner],aircraft:[plane('partner','partner-plane')],flights:[flight('partner','foreign-flight','partner-plane')]});
function snapshot(){const s=normalizeGame({player,...own},now,{fullCycle:true});s.codeshares=normalizeCodeshares(raw(),player,own,now,{fullCycle:true});return s;}

test('codeshare reads are agreement scoped, verify partner ownership and exclude unrelated injected rows',async()=>{
 const calls=[];
 const result=await readCodeshares(async resource=>{
  const u=new URL(resource,'https://example.test/'),q=u.searchParams;calls.push(u);
  if(u.pathname==='/codeshare_flight_data')return q.has('marketingUid')?[deal(),deal({codeshareId:'unrelated',marketingUid:'stranger',operatingUid:'foreign'})]:[];
  if(u.pathname==='/rpc/get_player_by_uid')return partner;
  if(u.pathname==='/new_player_flight_data')return [flight('partner','foreign-flight','partner-plane'),flight('stranger','not-requested','stolen-plane')];
  if(u.pathname==='/player_aircraft_data')return [plane('partner','partner-plane'),plane('stranger','stolen-plane')];
  throw new Error('Unexpected read');
 },player,own);
 assert.equal(result.agreements.length,1);assert.deepEqual(result.flights.map(f=>f.flightId),['foreign-flight']);assert.deepEqual(result.aircraft.map(a=>a.aircraftId),['partner-plane']);
 assert.ok(calls.filter(u=>u.pathname==='/codeshare_flight_data').every(u=>u.searchParams.get('operatingUid')==='eq.own'||u.searchParams.get('marketingUid')==='eq.own'));
 for(const u of calls.filter(u=>['/new_player_flight_data','/player_aircraft_data'].includes(u.pathname))){assert.equal(u.searchParams.get('uid'),'eq.partner');assert.ok(u.searchParams.get(u.pathname.includes('aircraft')?'aircraftId':'flightId').startsWith('in.('));}
});

test('normalization attaches both marketing aliases and one physical movement without affecting owned economics',()=>{
 const s=snapshot(),c=normalizeCodeshares(raw([deal(),deal({codeshareId:'second',marketingOutboundFlightNumber:9011,marketingInboundFlightNumber:9012})]),player,own,now,{fullCycle:true});
 assert.equal(c.flights.length,s.codeshares.flights.length);assert.deepEqual(c.flights.find(f=>f.direction==='out').marketingNumbers,['PA9001','PA9011']);
 assert.ok(c.flights.every(f=>f.operatingNumber.startsWith('XY')&&f.isCodeshare&&f.weeklyProfit===null));
 assert.equal(c.agreements[0].weeklyMarketingProfit,23000);assert.equal(s.aircraft.length,1);assert.equal(s.metrics.weeklyPlannedProfit,100000);
 const all=trafficSnapshot(s,'all'),shared=trafficSnapshot(s,'shared'),owned=trafficSnapshot(s,'own');
 assert.equal(all.flights.length,s.flights.length+c.flights.length);assert.equal(all.aircraft.length,2);
 assert.ok(shared.flights.every(f=>f.isCodeshare));assert.ok(owned.flights.every(f=>!f.isCodeshare));assert.equal(s.aircraft.length,1);
 assert.ok(buildTimetable(shared.flights,shared.aircraft,shared.airports).every(r=>r.type.includes('Partner Airways 承运')));
});

test('outgoing agreements retain owned flights once and deleting incoming agreements removes partner services',()=>{
 const s=snapshot();s.codeshares=normalizeCodeshares({...raw([deal({operatingUid:'own',marketingUid:'partner',operatingFlightId:'own-flight'})]),flights:[],aircraft:[]},player,own,now,{fullCycle:true});
 assert.equal(s.codeshares.agreements[0].role,'operating');assert.equal(s.codeshares.flights.length,0);assert.equal(trafficSnapshot(s).flights.length,s.flights.length);
 const empty=normalizeCodeshares({...raw([]),flights:[],aircraft:[]},player,own,now,{fullCycle:true});assert.equal(empty.flights.length,0);assert.equal(empty.agreements.length,0);
 const failed=normalizeCodeshares({status:'unavailable'},player,own,now,{});assert.equal(failed.status,'unavailable');
});

test('map routes retain separate carrier identities even when both use the same route id',()=>{
 const s=snapshot();s.routes=[{id:'same-route',origin:'LHR',destination:'JFK'}];s.codeshares.routes=[{id:'same-route',origin:'LHR',destination:'JFK'}];
 const all=trafficSnapshot(s,'all');assert.equal(all.routes.length,2);assert.equal(all.routes.filter(r=>r.isCodeshare).length,1);assert.equal(new Set(all.routes.map(r=>r.id)).size,2);
 assert.ok(trafficSnapshot(s,'shared').routes.every(r=>r.isCodeshare));assert.ok(trafficSnapshot(s,'own').routes.every(r=>!r.isCodeshare));
});

test('snapshot roundtrip and single AI export retain shared detail without arbitrary private fields',async()=>{
 const s=snapshot();s.codeshares.secret='DO-NOT-EXPORT';s.codeshares.partners[0].token='DO-NOT-EXPORT';s.codeshares.flights[0].session='DO-NOT-EXPORT';
 const copy=validateSnapshot(s,'game',now);assert.equal(copy.codeshares.flights[0].operatingNumber,s.codeshares.flights[0].operatingNumber);assert.equal(copy.codeshares.aircraft[0].operatorName,'Partner Airways');assert.equal(copy.codeshares.secret,undefined);
 const {data,content}=await createAnalysisExport({snapshot:s,connection:{source:'game',status:'live'},now});
 assert.equal(data.summary.aircraft,1);assert.equal(data.codeshares.configuration.fleet.length,1);assert.equal(data.codeshares.agreements[0].weeklyMarketingProfit,23000);assert.ok(data.codeshares.operationsAtCapture.some(f=>f.operatingNumber==='XY11'));assert.ok(!content.includes('DO-NOT-EXPORT'));
});

test('rate limits on shared reads propagate and no partner query runs before a verified agreement',async()=>{
 let calls=0;const failure=Object.assign(new Error('rate limit'),{status:429});
 await assert.rejects(readCodeshares(async()=>{calls++;throw failure;},player,own),e=>e===failure);assert.equal(calls,1);
 const calls2=[];await readCodeshares(async r=>{calls2.push(r);return [];},player,own);assert.equal(calls2.length,2);assert.ok(calls2.every(r=>r.startsWith('codeshare_flight_data?')));
});
