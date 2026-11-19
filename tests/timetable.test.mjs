import test from 'node:test';import assert from 'node:assert/strict';
import {buildTimetable,renderTimetableHtml,timetableCsv,equipmentLines} from '../web/timetable.mjs';
import {makeProjection,routeLine} from '../web/map-geometry.mjs';
import {WORKSPACES,workspaceFor} from '../web/navigation.mjs';
import {csvText} from '../web/dispatch.mjs';
import {buildRoundTrips,filterRoundTrips,roundTripRows,destinationRegion,groupDestinations,compactRotations} from '../web/timetable-groups.mjs';
const airports=[{id:'PVG',city:'Shanghai',utcOffsetSeconds:28800,lat:31.1,lon:121.8},{id:'HND',city:'Tokyo',utcOffsetSeconds:32400,lat:35.5,lon:139.8},{id:'LAX',city:'Los Angeles',utcOffsetSeconds:-25200,lat:33.9,lon:-118.4}];
const fleet=[{id:'a',registration:'B-1',type:'A330',cabins:{biz:{numSeats:12},eco:{numSeats:261}}}];
const f={id:'one',scheduleId:'s',direction:'out',aircraftId:'a',number:'CA1',origin:'PVG',destination:'HND',departure:'2026-10-12T08:00:00Z',arrival:'2026-10-12T11:00:00Z',scheduledDays:[0]};
test('published schedule uses each airport local time and deduplicates repeated weekly occurrences',()=>{
 const rows=buildTimetable([f,{...f,id:'next',departure:'2026-10-19T08:00:00Z',arrival:'2026-10-19T11:00:00Z'}],fleet,airports);
 assert.equal(rows.length,1);assert.equal(rows[0].departure,'16:00');assert.equal(rows[0].arrival,'20:00');assert.deepEqual(rows[0].days,[0]);assert.equal(rows[0].weeklyFlights,1);assert.equal(rows[0].classes,'J/Y');
});
test('return operating day is calculated at the return origin, rather than copying outbound days',()=>{
 const row=buildTimetable([{...f,id:'return',direction:'in',origin:'HND',destination:'PVG',departure:'2026-10-12T19:00:00Z',arrival:'2026-10-12T22:00:00Z'}],fleet,airports)[0];
 assert.equal(row.departure,'04:00');assert.equal(row.arrival,'06:00');assert.deepEqual(row.days,[1]);
});
test('date line arrival can be the previous local day, and UTC basis retains actual UTC weekdays',()=>{
 const flight={...f,destination:'LAX',departure:'2026-10-12T16:00:00Z',arrival:'2026-10-13T03:00:00Z'};
 const local=buildTimetable([flight],fleet,airports)[0],utc=buildTimetable([flight],fleet,airports,{basis:'utc'})[0];
 assert.deepEqual(local.days,[1]);assert.equal(local.arrival,'20:00');assert.equal(local.arrivalDayOffset,-1);
 assert.deepEqual(utc.days,[0]);assert.equal(utc.departure,'16:00');assert.equal(utc.arrivalDayOffset,1);
});
test('missing timezones remain unknown rather than silently substituting UTC for local time',()=>{
 const row=buildTimetable([f],fleet,airports.map(a=>({...a,utcOffsetSeconds:null})))[0];assert.equal(row.departure,'—');assert.equal(row.timezoneKnown,false);assert.deepEqual(row.days,[]);
});
test('CSV keeps all seven operating days and publication HTML escapes game-controlled names',()=>{
 const rows=buildTimetable([f],fleet,airports);const csv=timetableCsv(rows,'local');assert.equal(csv[0].length,csv[1].length);assert.deepEqual(csv[1].slice(3,10),[1,'','','','','','']);
 const html=renderTimetableHtml({rows:[{...rows[0],destinationCity:'<script>bad()</script>'}],airline:'<img src=x onerror=bad()>',capturedAt:'2026-10-17T00:00:00Z'});
 assert.ok(html.includes('@page{size:A4 landscape'));assert.ok(html.includes('2026/10/17 08:00'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('●'));
});
test('Pacific-centered projection draws both directions of Asia-America routes as one continuous path',()=>{
 const p=makeProjection(150);
 for(const [a,b] of [[airports[0],airports[2]],[airports[2],airports[1]]]){const d=routeLine(a,b,p);assert.equal((d.match(/M/g)||[]).length,1);assert.ok(!d.includes('NaN'));}
 const atlantic=routeLine(airports[0],airports[2],makeProjection(0));assert.ok((atlantic.match(/M/g)||[]).length>1);
});
test('navigation retains every view and opens the planner directly from the dock or fleet',()=>{
 const views=WORKSPACES.flatMap(w=>w.views);assert.equal(new Set(views).size,views.length);
 for(const view of ['control','overview','map','fleet','cabins','routes','analytics','timetable','planner'])assert.ok(workspaceFor(view));
 assert.equal(workspaceFor('map').id,workspaceFor('control').id);assert.equal(workspaceFor('cabins').id,workspaceFor('fleet').id);
 assert.deepEqual(workspaceFor('planner').views,['planner']);assert.ok(workspaceFor('fleet').shortcuts.includes('planner'));
});
test('CSV preserves numeric previous-day indicators while protecting text formulas',()=>{
 const text=csvText([[-1,'=1+1','+SUM(A1)','Flight "A"']]);assert.ok(text.startsWith('\ufeff"-1",'));assert.ok(text.includes('"\'=1+1"'));assert.ok(text.includes('"\'+SUM(A1)"'));assert.ok(text.includes('Flight ""A""'));
});

const back={...f,id:'back',direction:'in',number:'CA2',origin:'HND',destination:'PVG',departure:'2026-10-12T19:00:00Z',arrival:'2026-10-12T22:00:00Z'};
test('base-first round trip retains independently calculated return weekdays and both legs when filtered',()=>{
 const groups=buildRoundTrips([back,f],fleet,airports,{hub:'PVG'});
 assert.equal(groups.length,1);assert.deepEqual(groups[0].legs.map(r=>r.origin),['PVG','HND']);
 assert.deepEqual(groups[0].legs.map(r=>r.days),[[0],[1]]);
 assert.equal(filterRoundTrips(groups,{query:'CA2'}).flatMap(g=>g.legs).length,2);
 assert.equal(filterRoundTrips(groups,{destination:'HND'}).length,1);
 const rows=roundTripRows(groups),csv=timetableCsv(rows,'local');
 assert.equal(rows.reduce((n,r)=>n+r.weeklyFlights,0),2);assert.equal(csv[1].length,csv[0].length);assert.deepEqual(csv[1].slice(0,4),['PVG','其他','PVG ↔ HND','去程']);
 const html=renderTimetableHtml({rows,capturedAt:f.departure});assert.ok(html.indexOf('PVG → HND')<html.indexOf('HND → PVG'));assert.ok(html.includes('主基地 · 其他'));
});
test('shared outbound times with different return rotations never get incorrectly combined',()=>{
 const groups=buildRoundTrips([f,back,{...f,id:'other-out',scheduleId:'other'},{...back,id:'other-in',scheduleId:'other',departure:'2026-10-12T20:00:00Z',arrival:'2026-10-12T23:00:00Z'}],fleet,airports,{hub:'PVG'});
 assert.equal(groups.length,2);assert.equal(roundTripRows(groups).reduce((n,r)=>n+r.weeklyFlights,0),4);
 assert.deepEqual(groups.map(g=>g.legs[1].departure).sort(),['04:00','05:00']);
});
test('identical whole rotations combine registrations and totals without losing assignments',()=>{
 const groups=buildRoundTrips([f,back,{...f,id:'b-out',aircraftId:'b'},{...back,id:'b-in',aircraftId:'b'}],[...fleet,{...fleet[0],id:'b',registration:'B-2'}],airports,{hub:'PVG'});
 assert.equal(groups.length,1);assert.equal(groups[0].legs[0].weeklyFlights,2);assert.deepEqual(groups[0].legs[0].registrations,['B-1','B-2']);assert.equal(groups[0].legs[0].scheduleKeys.length,2);
});
test('base orientation overrides native direction and nonbase extensions remain available',()=>{
 const groups=buildRoundTrips([f,back,{...f,id:'extension',scheduleId:'ext',origin:'HND',destination:'LAX'}],fleet,airports,{hub:'HND'});
 assert.ok(groups.every(g=>g.legs[0].origin==='HND'));
 const pvg=buildRoundTrips([f,back,{...f,id:'extension',scheduleId:'ext',origin:'HND',destination:'LAX'}],fleet,airports,{hub:'PVG'});
 assert.equal(pvg[0].base,'PVG');assert.equal(filterRoundTrips(pvg,{base:'extensions'})[0].base,'HND');assert.equal(roundTripRows(pvg).reduce((n,r)=>n+r.weeklyFlights,0),3);
});
test('regions distinguish mainland, Hong Kong Taiwan, northeast Asia and America',()=>{
 assert.equal(destinationRegion({country:'China',id:'PEK'}),'国内');assert.equal(destinationRegion({country:'China',id:'HKG'}),'港澳台');assert.equal(destinationRegion({country:'Taiwan',id:'TPE'}),'港澳台');assert.equal(destinationRegion({country:'Japan'}),'东北亚');assert.equal(destinationRegion({country:'United States'}),'北美');assert.equal(destinationRegion({country:'France',lat:49,lon:2}),'欧洲');
});

test('explicit stopover becomes a base-origin rotation and shares the final destination with direct services',()=>{
 const root={...f,childScheduleId:'child'};
 const child={...f,id:'child-out',scheduleId:'child',origin:'HND',destination:'LAX',departure:'2026-10-12T12:00:00Z',arrival:'2026-10-12T23:00:00Z'};
 const childBack={...child,id:'child-in',direction:'in',origin:'LAX',destination:'HND',departure:'2026-10-13T02:00:00Z',arrival:'2026-10-13T14:00:00Z'};
 const direct={...f,id:'direct',scheduleId:'direct',destination:'LAX'};
 const groups=buildRoundTrips([root,{...back,childScheduleId:'child'},child,childBack,direct],fleet,airports,{hub:'PVG'});
 const via=groups.find(g=>g.path.length===3);
 assert.deepEqual(via.path,['PVG','HND','LAX']);assert.deepEqual(via.legs.map(r=>[r.origin,r.destination,r.legLabel]),[['PVG','HND','去程'],['HND','LAX','去程'],['LAX','HND','返程'],['HND','PVG','返程']]);
 assert.equal(groupDestinations(groups).length,1);assert.equal(groupDestinations(groups)[0].rotations.length,2);
 assert.equal(filterRoundTrips(groups,{destination:'LAX'}).length,2);assert.equal(filterRoundTrips(groups,{query:'HND'}).length,1);
 const rows=roundTripRows(groups);assert.equal(rows.reduce((n,r)=>n+r.weeklyFlights,0),5);
 const html=renderTimetableHtml({rows,capturedAt:f.departure});assert.equal((html.match(/class="route-heading"/g)||[]).length,1);assert.ok(html.includes('PVG → HND → LAX'));
 const csv=timetableCsv(rows,'local');assert.ok(csv[0].includes('经停点'));assert.ok(csv.some(r=>r.includes('HND')));
});
test('missing or differently assigned children never fabricate a connecting rotation',()=>{
 const child={...f,id:'c',scheduleId:'child',origin:'HND',destination:'LAX',scheduledDays:[1]};
 const groups=buildRoundTrips([{...f,childScheduleId:'child'},back,child],fleet,airports,{hub:'PVG'});
 assert.equal(groups.length,2);assert.ok(groups.every(g=>g.path.length===2));assert.equal(roundTripRows(groups).length,3);
});

test('publication merges identical flight times across equipment and preserves independent equipment weekdays',()=>{
 const flights=[f,back,{...f,id:'b-out',aircraftId:'b',departure:'2026-10-13T08:00:00Z',arrival:'2026-10-13T11:00:00Z'},{...back,id:'b-in',aircraftId:'b',departure:'2026-10-13T19:00:00Z',arrival:'2026-10-13T22:00:00Z'}];
 const aircraft=[...fleet,{...fleet[0],id:'b',registration:'B-2',type:'Boeing 777-300'}];
 const native=buildRoundTrips(flights,aircraft,airports,{hub:'PVG'}),groups=compactRotations(native);
 assert.equal(groups.length,1);assert.deepEqual(groups[0].legs.map(r=>r.days),[[0,1],[1,2]]);
 const [out,inbound]=groups[0].legs;
 assert.equal(out.weeklyFlights,2);assert.equal(out.scheduleKeys.length,2);assert.deepEqual(out.registrations,['B-1','B-2']);
 assert.deepEqual(out.equipment.find(e=>e.type==='Boeing 777-300').days,[1]);assert.deepEqual(inbound.equipment.find(e=>e.type==='Boeing 777-300').days,[2]);
 assert.ok(equipmentLines(out).includes('777-300 · 周二'));assert.ok(equipmentLines(inbound).includes('777-300 · 周三'));
 assert.equal(roundTripRows(groups).reduce((n,r)=>n+r.weeklyFlights,0),4);
 assert.deepEqual(compactRotations(groups),groups);assert.equal(native[0].legs[0].weeklyFlights,1);
 const html=renderTimetableHtml({rows:roundTripRows(groups)});assert.ok(html.includes('777-300 · 周二'));assert.ok(timetableCsv(roundTripRows(groups),'local')[1].some(v=>String(v).includes('777-300 · 周二')));
 assert.equal(compactRotations(buildRoundTrips([...flights.slice(0,2),{...flights[2],arrival:'2026-10-13T12:00:00Z'},flights[3]],aircraft,airports,{hub:'PVG'})).length,2);
 assert.equal(compactRotations(filterRoundTrips(native,{type:'Boeing 777-300'}))[0].legs[0].weeklyFlights,1);
});
