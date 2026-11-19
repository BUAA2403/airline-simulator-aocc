import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPublicationSections} from '../web/timetable-sections.mjs';
import {renderTimetableHtml,timetableCsv} from '../web/timetable.mjs';
const airports=[{id:'PEK',city:'Beijing',utcOffsetSeconds:28800,country:'China',lat:40,lon:116},{id:'HND',city:'Tokyo',utcOffsetSeconds:32400,country:'Japan',lat:35,lon:139}];
const fleet=[{id:'own',registration:'B-1',type:'A330'},{id:'shared',registration:'G-1',type:'A330'}];
const pair=(aircraftId,isCodeshare)=>[
 {id:`${aircraftId}-out`,scheduleId:aircraftId,aircraftId,number:'CA101',direction:'out',origin:'PEK',destination:'HND',departure:'2026-10-19T08:00:00Z',arrival:'2026-10-19T11:00:00Z',scheduledDays:[0],isCodeshare,operatorName:isCodeshare?'Partner Airways':''},
 {id:`${aircraftId}-in`,scheduleId:aircraftId,aircraftId,number:'CA102',direction:'in',origin:'HND',destination:'PEK',departure:'2026-10-19T12:00:00Z',arrival:'2026-10-19T15:00:00Z',scheduledDays:[0],isCodeshare,operatorName:isCodeshare?'Partner Airways':''},
];
const flights=[...pair('own',false),...pair('shared',true)];
test('publication separates identical own and shared services before merging rotations, retaining both directions and filters',()=>{
 const sections=buildPublicationSections(flights,fleet,airports,{hub:'PEK'});
 assert.deepEqual(sections.map(s=>[s.id,s.groups.length,s.rows.length]),[['own',1,2],['shared',1,2]]);
 assert.ok(sections[0].rows.every(r=>r.trafficSection==='own'&&r.registrations.join()==='B-1'));
 assert.ok(sections[1].rows.every(r=>r.trafficSection==='shared'&&r.registrations.join()==='G-1'&&r.type.includes('Partner Airways')));
 const filtered=buildPublicationSections(flights,fleet,airports,{hub:'PEK',query:'G-1'});assert.equal(filtered[0].rows.length,0);assert.equal(filtered[1].rows.length,2);
 const deleted=buildPublicationSections(pair('own',false),fleet,airports,{hub:'PEK'});assert.equal(deleted[1].rows.length,0);
});
test('HTML exports independent own and shared tables in order, and CSV retains the category for each row',()=>{
 const rows=buildPublicationSections(flights,fleet,airports,{hub:'PEK'}).flatMap(s=>s.rows);
 const html=renderTimetableHtml({rows,capturedAt:'2026-10-21T00:00:00Z'});
 assert.equal((html.match(/<table>/g)||[]).length,2);assert.ok(html.indexOf('<h2>自营航班</h2>')<html.indexOf('<h2>共享航班</h2>'));
 const own=html.slice(html.indexOf('<section class="traffic-section own">'),html.indexOf('<section class="traffic-section shared">'));assert.ok(!own.includes('Partner Airways'));
 const csv=timetableCsv(rows,'local');assert.equal(csv[0][0],'承运类别');assert.deepEqual(csv.slice(1).map(r=>r[0]),['自营航班','自营航班','共享航班','共享航班']);assert.ok(csv.every(r=>r.length===csv[0].length));
});
