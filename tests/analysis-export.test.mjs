import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/store.mjs';
import {createAnalysisExport} from '../server/analysis-export.mjs';
import {createAoccServer} from '../server/index.mjs';

const now=new Date('2026-10-18T16:05:00Z');
const secret='MUST-NOT-EXPORT-SESSION-SECRET';
function fixture(at='2026-10-18T16:00:00Z'){
 const leg={aircraftId:'a',scheduleId:'s',childScheduleId:'',scheduledDays:[0],weeklyProfit:1000,weeklyPassengers:120,plannedPassengers:120,passengerSource:'weekly-average',passengers:null,revenue:null,positionSource:'schedule',cabinPlan:{eco:{weeklyPassengers:120,averagePassengers:120,fare:200,accessToken:secret}}};
 return {schemaVersion:1,capturedAt:at,airline:{id:'PRIVATE-ACCOUNT-UID',name:'EXAMPLE AIR ``` </script>',code:'PA',hub:'PEK',cash:null,currency:'USD',email:secret},airports:[{id:'PEK',iata:'PEK',city:'Beijing',country:'China',lat:40,lon:116,utcOffsetSeconds:28800},{id:'ICN',iata:'ICN',city:'Seoul',country:'South Korea',lat:37,lon:126,utcOffsetSeconds:32400}],aircraft:[{id:'a',registration:'B-1',type:'Airbus A320-200',capacity:150,capacitySource:'game-client-rules',weeklyFlightMinutes:180,utilization:.02,cabins:{eco:{numSeats:150,numRows:25,config:'3-3',pitch:30,seatProduct:'standard',password:secret}},accessToken:secret}],flights:[{...leg,id:'out',number:'PA1',direction:'out',origin:'PEK',destination:'ICN',departure:'2026-10-19T00:00:00Z',arrival:'2026-10-19T02:00:00Z',status:'scheduled'},{...leg,id:'back',number:'PA2',direction:'in',origin:'ICN',destination:'PEK',departure:'2026-10-19T03:00:00Z',arrival:'2026-10-19T04:00:00Z',status:'scheduled'}],routes:[{id:'r',origin:'PEK',destination:'ICN',revenue:null,cost:null}],metrics:{accountCash:10000,weeklyPlannedProfit:1000,weeklyPlannedPassengers:120,weeklyScheduledLegs:2,normalizationIssues:0,accessToken:secret,password:123},provenance:{source:'game',notes:[secret]},authorization:secret};
}
const connection={source:'game',status:'live',lastSuccessAt:'2026-10-18T16:00:00Z',accessToken:secret,airlineId:'PRIVATE-ACCOUNT-UID',message:secret};
test('one Markdown file is self-contained, parseable and scoped to business fields',async()=>{
 const report=await createAnalysisExport({snapshot:fixture(),connection,now});
 assert.match(report.filename,/20261019000500\.md$/);
 assert.ok(report.content.includes('给分析 AI 的任务'));assert.ok(report.content.includes('不要再乘执飞天数或往返次数'));assert.ok(report.content.includes('不是游戏遥测'));
 assert.equal((report.content.match(/```json/g)||[]).length,1);
 const payload=JSON.parse(report.content.match(/```json\n([\s\S]*?)\n```/)[1]);
 assert.equal(payload.airline.name,'EXAMPLE AIR ``` </script>');assert.equal(payload.configuration.fleet[0].capacity,150);
 assert.ok(!report.content.includes(secret));assert.ok(!report.content.includes('PRIVATE-ACCOUNT-UID'));assert.ok(!JSON.stringify(payload).includes('accessToken'));assert.ok(!JSON.stringify(payload).includes('password'));
 assert.equal(payload.metadata.snapshotCapturedAt,fixture().capturedAt);assert.equal(payload.metadata.ageSeconds,300);
 assert.equal(payload.configuration.scheduleAssignments.length,1);assert.equal(payload.configuration.scheduleAssignments[0].weeklyProfit,1000);
 assert.equal(payload.nativeTimetableUTC.length,2);assert.equal(payload.routeEconomics[0].weeklyPlan.weeklyProfit,1000);
 assert.equal(payload.routeEconomics[0].weeklyPlan.estimatedLoadFactor,.8);assert.equal(payload.summary.metrics.weeklyPlannedPassengers,120);assert.equal(payload.airline.cash,null);
});
test('multiweek generated duplicates do not inflate assignment economics or weekly timetables',async()=>{
 const s=fixture();s.flights.push(...s.flights.map(f=>({...f,id:'next-'+f.id,departure:new Date(Date.parse(f.departure)+604800000).toISOString(),arrival:new Date(Date.parse(f.arrival)+604800000).toISOString()})));
 const {data}=await createAnalysisExport({snapshot:s,connection,now});
 assert.equal(data.configuration.scheduleAssignments.length,1);assert.equal(data.configuration.scheduleAssignments[0].services.length,2);assert.equal(data.nativeTimetableUTC.reduce((n,r)=>n+r.weeklyFlights,0),2);assert.equal(data.routeEconomics[0].weeklyPlan.weeklyProfit,1000);
 s.routes.push({...s.routes[0],id:'reverse',origin:'ICN',destination:'PEK'});
 assert.equal((await createAnalysisExport({snapshot:s,connection,now})).data.routeEconomics.length,1);
});
test('retained history preserves every observation, scopes accounts/sources and records reconstructable revisions',async()=>{
 const first=fixture('2026-10-18T12:00:00Z'),same=fixture('2026-10-18T13:00:00Z'),changed=fixture('2026-10-18T14:00:00Z');
 changed.aircraft[0].registration='B-NEW';changed.metrics.accountCash=9000;changed.flights[0].passengers=100;
 const latest=structuredClone(changed);latest.capturedAt='2026-10-18T16:00:00Z';latest.routes=[];
 const foreign=fixture();foreign.airline.id='someone-else';foreign.aircraft[0].registration='FOREIGN-TAIL';
 const imported=fixture();imported.provenance.source='import';imported.aircraft[0].registration='IMPORT-TAIL';
 const future=fixture('2026-10-19T00:00:00Z');future.aircraft[0].registration='FUTURE-TAIL';
 const {data,content}=await createAnalysisExport({snapshot:latest,connection,now,historySnapshots:[first,same,changed,foreign,imported,future]});
 assert.equal(data.metadata.historyCoverage.retainedSnapshots,4);assert.equal(data.history.observationRuns[0].observedAt.length,2);
 assert.equal(data.history.baseline.changes.fleet.updated[0].registration,'B-1');assert.equal(data.history.baseline.base,'configuration');assert.equal(data.history.configurationRevisions[0].changes.fleet.updated[0].registration,'B-NEW');assert.deepEqual(data.history.configurationRevisions[1].changes.routes.removed,['r']);
 assert.equal(data.history.providedActualFlightObservations[0].record.passengers,100);
 assert.ok(!content.includes('FOREIGN-TAIL'));assert.ok(!content.includes('IMPORT-TAIL'));assert.ok(!content.includes('FUTURE-TAIL'));
 const reconstructed=structuredClone(data.configuration);
 for(const revision of [data.history.baseline,...data.history.configurationRevisions])for(const [table,change] of Object.entries(revision.changes)){
  const rows=new Map(reconstructed[table].map(r=>[r.id,r]));for(const id of change.removed)rows.delete(id);for(const row of [...change.added,...change.updated])rows.set(row.id,row);reconstructed[table]=[...rows.values()].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
 }
 assert.deepEqual(reconstructed,data.configuration);
});
test('clock-offset jitter does not create duplicate business observations',async()=>{
 const first=fixture('2026-10-18T15:00:00Z'),latest=fixture();first.metrics.serverClockOffsetMs=123;latest.metrics.serverClockOffsetMs=789;
 const {data}=await createAnalysisExport({snapshot:latest,connection,now,historySnapshots:[first]});
 assert.equal(data.history.observationRuns.length,1);assert.equal(data.history.observationRuns[0].observedAt.length,2);assert.equal(data.summary.metrics.serverClockOffsetMs,789);
});
test('SQLite analysis history includes all retained samples beyond the UI hourly limit and freezes its scope',async t=>{
 const store=new Store(':memory:');t.after(()=>store.close());let latest;
 for(let i=0;i<220;i++){const s=fixture(new Date(Date.parse('2026-10-18T00:00:00Z')+i*60000).toISOString());store.save(s,'game');if(i===200)latest=s;}
 const foreign=fixture();foreign.airline.id='foreign';store.save(foreign,'game');store.save(fixture(),'import');
 const {data}=await createAnalysisExport({snapshot:latest,connection,now,historySnapshots:store.analysisSnapshots(latest.airline.id,'game',latest.capturedAt)});
 assert.equal(data.metadata.historyCoverage.retainedSnapshots,201);assert.equal(data.history.observationRuns.reduce((n,r)=>n+r.observedAt.length,0),201);
 assert.equal(data.metadata.historyCoverage.lastAt,latest.capturedAt);
});
test('unknown data and unavailable estimates stay unknown; no snapshot gives an actionable error',async()=>{
 const s=fixture();s.aircraft[0].capacity=null;s.flights.forEach(f=>{f.weeklyProfit=null;f.weeklyPassengers=null;});s.metrics.weeklyPlannedProfit=null;
 const {data}=await createAnalysisExport({snapshot:s,connection:{source:'game',status:'stale'},now});
 assert.equal(data.summary.totalSeats,null);assert.equal(data.routeEconomics[0].weeklyPlan.weeklyProfit,null);assert.equal(data.routeEconomics[0].weeklyPlan.estimatedLoadFactor,null);assert.equal(data.metadata.connectionStatus,'stale');
 await assert.rejects(()=>createAnalysisExport({snapshot:null}),/尚无可导出/);
});
test('HTTP analysis download excludes the vault and logs, rejects other websites and handles an empty workspace',async t=>{
 const store=new Store(':memory:'),vault={load:async()=>({}),save:async()=>{}},app=await createAoccServer({store,vault,port:0,adapter:{read:async()=>fixture()}});
 const {port}=await app.listen();t.after(()=>app.close());const url=`http://127.0.0.1:${port}/api/analysis-export`;
 assert.equal((await fetch(url)).status,409);
 await app.engine.connect({accessToken:secret.repeat(2)});store.log('warn',secret);
 const response=await fetch(url),text=await response.text();assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/markdown/);assert.match(response.headers.get('content-disposition'),/attachment; filename=.*\.md/);assert.equal(response.headers.get('cache-control'),'no-store');assert.ok(!text.includes(secret));assert.ok(!text.includes('PRIVATE-ACCOUNT-UID'));
 assert.equal((await fetch(url,{headers:{Origin:'https://unrelated.example'}})).status,403);
});
