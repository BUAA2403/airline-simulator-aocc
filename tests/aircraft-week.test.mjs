import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAircraftWeek,timelineSegments,replayFrame,advanceReplay,DAY_MS,WEEK_MS} from '../web/aircraft-week.mjs';
const now=new Date('2026-10-14T08:00:00Z'),monday=Date.parse('2026-10-12T00:00:00Z');
const f=(id,start,end,extra={})=>({id,scheduleId:id,aircraftId:'a',number:`PL${id}`,direction:'out',origin:'PEK',destination:'HND',departure:new Date(monday+start).toISOString(),arrival:new Date(monday+end).toISOString(),...extra});
const hour=3600000,airports={PEK:{lat:40,lon:116},HND:{lat:35,lon:139},LAX:{lat:34,lon:-118}};
test('aircraft calendar week sorts all seven days, keeps carry-ins and excludes other aircraft and duplicate occurrences',()=>{
 const flights=[f('b',2*DAY_MS,2*DAY_MS+hour),f('a',hour,2*hour),f('carry',-hour,hour),f('out',6*DAY_MS+23*hour,WEEK_MS+hour),f('foreign',hour,2*hour,{aircraftId:'b'}),f('next',WEEK_MS+hour,WEEK_MS+2*hour)];
 const week=buildAircraftWeek([...flights,{...flights[1],id:'duplicate'}],'a',now);
 assert.equal(week.start,monday);assert.equal(week.end,monday+WEEK_MS);assert.equal(week.tasks.length,4);assert.equal(week.departures,3);
 assert.ok(week.tasks[0].carryIn);assert.ok(week.tasks.at(-1).carryOut);assert.equal(week.flightMinutes,240);assert.ok(week.issues.some(i=>i.type==='gap'));
});
test('a coherent base timezone shifts the week boundary and splits cross-midnight flights without losing minutes',()=>{
 const flight=f('night',15*hour,18*hour),week=buildAircraftWeek([flight],'a',now,{offsetSeconds:28800}),days=timelineSegments(week);
 assert.equal(week.start,monday-8*hour);assert.equal(days[0].segments[0].width,1/24);assert.equal(days[1].segments[0].width,2/24);
 assert.ok(days[0].segments[0].continuesAfter);assert.ok(days[1].segments[0].continuesBefore);
 assert.equal(Math.round(days.flatMap(d=>d.segments).reduce((n,s)=>n+s.width*24*60,0)),180);
});
test('replay traverses the assigned sequence, retains ground stops and crosses the Pacific by the short arc',()=>{
 const week=buildAircraftWeek([f('one',hour,3*hour),f('two',5*hour,15*hour,{origin:'HND',destination:'LAX'})],'a',now);
 const first=replayFrame(week,monday+2*hour,airports),ground=replayFrame(week,monday+4*hour,airports),pacific=replayFrame(week,monday+10*hour,airports);
 assert.equal(first.task.id,'one');assert.equal(first.progress,.5);assert.equal(ground.phase,'ground');assert.equal(ground.location,'HND');assert.equal(ground.next.id,'two');
 assert.equal(pacific.progress,.5);assert.ok(Math.abs(pacific.coordinates.lon)>150);assert.equal(replayFrame(week,monday+16*hour,airports).phase,'complete');
 assert.equal(advanceReplay(week,monday+2*hour,2*hour,{skipGround:true}),monday+6*hour);
 assert.equal(advanceReplay(week,monday+2*hour,2*hour,{skipGround:false}),monday+4*hour);
 assert.equal(advanceReplay(week,monday+hour,100*WEEK_MS),monday+15*hour);
});
test('missing airports and unscheduled aircraft stay empty, and a new snapshot removes deleted tasks',()=>{
 const week=buildAircraftWeek([f('one',hour,3*hour)],'a',now);
 assert.equal(replayFrame(week,monday+2*hour,{}).coordinates,null);
 const empty=buildAircraftWeek([],'a',now);assert.equal(empty.tasks.length,0);assert.equal(replayFrame(empty,monday,airports).phase,'empty');assert.ok(timelineSegments(empty).every(d=>!d.segments.length));
 assert.equal(buildAircraftWeek([f('one',hour,3*hour)],'b',now).tasks.length,0);
});
test('overlapping assignments remain visible and playback does not finish before the final arrival',()=>{
 const week=buildAircraftWeek([f('long',hour,10*hour),f('short',2*hour,3*hour)],'a',now);
 assert.ok(week.issues.some(i=>i.type==='overlap'));assert.equal(advanceReplay(week,monday+hour,WEEK_MS),monday+10*hour);assert.equal(replayFrame(week,monday+9*hour,airports).phase,'airborne');
});
