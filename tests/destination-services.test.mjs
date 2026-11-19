import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDestinationServices} from '../web/destination-services.mjs';
import {filterRoundTrips,compactRotations,groupDestinations,roundTripRows} from '../web/timetable-groups.mjs';
import {timetableCsv,renderTimetableHtml,equipmentLines,timetableAirportCount} from '../web/timetable.mjs';
const airports=[{id:'PEK',city:'Beijing',country:'China',utcOffsetSeconds:28800},{id:'ICN',city:'Seoul',country:'South Korea',utcOffsetSeconds:32400},{id:'NRT',city:'Tokyo',country:'Japan',utcOffsetSeconds:32400}];
const aircraft=[{id:'a',registration:'B-1',type:'Airbus A330-300',cabins:{eco:{numSeats:200}}}];
const base={aircraftId:'a',scheduledDays:[6]};
const flights=[
 {...base,id:'r-out',scheduleId:'r',childScheduleId:'c',direction:'out',number:'CA101',origin:'PEK',destination:'ICN',departure:'2026-10-18T15:00:00Z',arrival:'2026-10-18T17:00:00Z'},
 {...base,id:'c-out',scheduleId:'c',direction:'out',number:'CA101',origin:'ICN',destination:'NRT',departure:'2026-10-18T18:00:00Z',arrival:'2026-10-18T20:00:00Z'},
 {...base,id:'c-in',scheduleId:'c',direction:'in',number:'CA102',origin:'NRT',destination:'ICN',departure:'2026-10-18T22:00:00Z',arrival:'2026-10-18T23:00:00Z'},
 {...base,id:'r-in',scheduleId:'r',childScheduleId:'c',direction:'in',number:'CA102',origin:'ICN',destination:'PEK',departure:'2026-10-19T00:00:00Z',arrival:'2026-10-19T01:00:00Z'},
];
const publish=(f=flights,a=aircraft,opts={})=>compactRotations(buildDestinationServices(f,a,airports,{hub:'PEK',...opts}));
test('a stopover publishes its first sector and a single through service under the final destination',()=>{
 const groups=publish();assert.deepEqual(groups.map(g=>g.destination),['ICN','NRT']);
 const icn=filterRoundTrips(groups,{destination:'ICN'})[0],nrt=filterRoundTrips(groups,{destination:'NRT'})[0];
 assert.deepEqual(icn.path,['PEK','ICN']);assert.equal(icn.legs.length,2);assert.equal(nrt.legs.length,2);
 assert.deepEqual(nrt.legs.map(r=>[r.number,r.origin,r.destination]),[['CA101','PEK','NRT'],['CA102','NRT','PEK']]);
 assert.deepEqual(nrt.legs.map(r=>[r.departure,r.arrival,r.arrivalDayOffset,r.durationMinutes,r.days]),[['23:00','05:00',1,300,[6]],['07:00','09:00',0,180,[0]]]);
 assert.deepEqual(icn.legs.map(r=>r.departure),['23:00','09:00']);
 assert.equal(roundTripRows(groups).reduce((sum,r)=>sum+r.weeklyFlights,0),4);
 assert.equal(nrt.legs[0].scheduleKeys.length,2);assert.ok(nrt.legs[0].scheduleKeys.includes('r|a|out'));assert.ok(nrt.legs[0].scheduleKeys.includes('c|a|out'));
});
test('HTML, CSV, UTC mode and direct services agree on the same destination grouping',()=>{
 const direct={...flights[0],id:'direct',scheduleId:'direct',childScheduleId:'',destination:'NRT',number:'CA103'};
 const groups=publish([...flights,direct]);assert.equal(groupDestinations(groups).length,2);assert.equal(groupDestinations(groups).find(g=>g.destination==='NRT').rotations.length,2);
 const rows=roundTripRows(filterRoundTrips(groups,{destination:'NRT'})),csv=timetableCsv(rows,'local'),html=renderTimetableHtml({rows});
 assert.ok(rows.some(r=>r.origin==='PEK'&&r.destination==='NRT'&&r.via==='ICN'));assert.ok(csv.some(r=>r[4]==='ICN'&&r.includes('CA101')));assert.ok(html.includes('经停 ICN'));
 assert.equal(timetableAirportCount(rows),3);
 const utc=publish(flights,aircraft,{basis:'utc'}).find(g=>g.destination==='NRT').legs;
 assert.deepEqual(utc.map(r=>[r.departure,r.arrival,r.arrivalDayOffset,r.days]),[['15:00','20:00',0,[6]],['22:00','01:00',1,[6]]]);
});
test('through services never change aircraft, merge unrelated numbers silently or invent missing children',()=>{
 const b=flights.map(f=>f.id==='c-out'?{...f,number:'CA201'}:f);assert.equal(publish(b).find(g=>g.destination==='NRT').legs[0].number,'CA101 / CA201');
 const foreign=flights.map(f=>f.scheduleId==='c'?{...f,aircraftId:'b'}:f);
 const groups=publish(foreign,[...aircraft,{...aircraft[0],id:'b',registration:'B-2'}]);assert.ok(groups.every(g=>g.path.length===2));
 assert.equal(publish(flights.filter(f=>f.scheduleId!=='c')).length,1);
});
test('equipment weekdays and native assignments survive through-service compaction',()=>{
 const b=flights.map(f=>({...f,id:'b-'+f.id,aircraftId:'b',scheduledDays:[0],departure:new Date(Date.parse(f.departure)+86400000).toISOString(),arrival:new Date(Date.parse(f.arrival)+86400000).toISOString()}));
 const nrt=publish([...flights,...b],[...aircraft,{...aircraft[0],id:'b',registration:'B-2',type:'Boeing 777-300'}]).find(g=>g.destination==='NRT');
 assert.deepEqual(nrt.legs[0].days,[0,6]);assert.equal(nrt.legs[0].assignments.length,2);assert.equal(nrt.legs[0].weeklyFlights,2);assert.ok(equipmentLines(nrt.legs[0]).some(s=>s.includes('777-300')&&s.includes('周一')));
 assert.deepEqual(nrt.legs[1].days,[0,1]);assert.equal(nrt.legs[1].scheduleKeys.length,4);
});
test('new, retimed and removed stopovers rebuild both publication entries without stale intermediate rows',()=>{
 assert.equal(publish(flights.filter(f=>f.scheduleId!=='c')).length,1);
 assert.equal(publish().length,2);
 const retimed=flights.map(f=>({...f,departure:new Date(Date.parse(f.departure)+3600000).toISOString(),arrival:new Date(Date.parse(f.arrival)+3600000).toISOString()}));
 assert.equal(publish(retimed).find(g=>g.destination==='NRT').legs[0].departure,'00:00');
 assert.deepEqual(publish([flights[0]]).map(g=>g.destination),['ICN']);
});
test('multi-stop services publish every base-origin prefix and handle the international date line',()=>{
 const f=[{...flights[0]},{...flights[1],childScheduleId:'d'},{...flights[1],id:'d-out',scheduleId:'d',origin:'NRT',destination:'LAX',departure:'2026-10-18T21:00:00Z',arrival:'2026-10-19T05:00:00Z'}];
 const ap=[...airports,{id:'LAX',country:'United States',utcOffsetSeconds:-28800}];
 const groups=buildDestinationServices(f,aircraft,ap,{hub:'PEK'});
 assert.deepEqual(new Set(groups.map(g=>g.destination)),new Set(['ICN','NRT','LAX']));
 const lax=groups.find(g=>g.destination==='LAX');assert.deepEqual(lax.path,['PEK','ICN','NRT','LAX']);assert.equal(lax.legs.length,1);assert.equal(lax.legs[0].durationMinutes,840);assert.equal(lax.legs[0].arrival,'21:00');assert.equal(lax.legs[0].arrivalDayOffset,0);
 const nextWeek=f.map(x=>({...x,id:'next-'+x.id,departure:new Date(Date.parse(x.departure)+604800000).toISOString(),arrival:new Date(Date.parse(x.arrival)+604800000).toISOString()}));
 assert.equal(roundTripRows(buildDestinationServices([...f,...nextWeek],aircraft,ap,{hub:'PEK'})).reduce((sum,r)=>sum+r.weeklyFlights,0),3);
});
test('a base at the other end publishes through returns in the correct geographic order',()=>{
 const groups=buildDestinationServices(flights,aircraft,airports,{hub:'NRT'}),pek=groups.find(g=>g.destination==='PEK');
 assert.deepEqual(pek.path,['NRT','ICN','PEK']);assert.deepEqual(pek.legs.map(r=>[r.origin,r.destination,r.number]),[['NRT','PEK','CA102'],['PEK','NRT','CA101']]);
 assert.ok(groups.some(g=>g.base==='NRT'&&g.destination==='ICN'));
});
test('long stopovers retain actual dates, while intervening aircraft duties prevent a fabricated through service',()=>{
 const f=flights.map(x=>x.id==='r-out'?x:{...x,departure:new Date(Date.parse(x.departure)+172800000).toISOString(),arrival:new Date(Date.parse(x.arrival)+172800000).toISOString()});
 const nrt=publish(f).find(g=>g.destination==='NRT');assert.equal(nrt.legs[0].durationMinutes,3180);assert.equal(nrt.legs[0].arrivalDayOffset,3);
 const other={...base,id:'other',scheduleId:'other',direction:'out',number:'CA999',origin:'ICN',destination:'PEK',departure:'2026-10-18T18:00:00Z',arrival:'2026-10-18T19:00:00Z'};
 const blocked=publish([...f,other]).find(g=>g.destination==='NRT');assert.ok(!blocked.legs.some(r=>r.origin==='PEK'&&r.destination==='NRT'));
});
