import test from 'node:test';
import assert from 'node:assert/strict';
import {flightContext,scheduledOccurrence} from '../web/flight-context.mjs';
const fleet=[{id:'a',type:'A330',registration:'B-1',capacity:200},{id:'b',type:'777',registration:'B-2',capacity:300}];
const airports=['PEK','HND','LAX'].map(id=>({id,utcOffsetSeconds:0}));
const leg=(id,extra={})=>({id,scheduleId:'s',aircraftId:'a',direction:'out',number:'PL1',origin:'PEK',destination:'HND',departure:'2026-10-12T08:00:00Z',arrival:'2026-10-12T10:00:00Z',scheduledDays:[0],weeklyProfit:100,weeklyPassengers:180,...extra});
test('movement context keeps tail, flight number and bidirectional route statistics distinct across repeated weeks',()=>{
 const out=leg('out'),back=leg('back',{direction:'in',number:'PL2',origin:'HND',destination:'PEK',departure:'2026-10-12T12:00:00Z',arrival:'2026-10-12T14:00:00Z'});
 const other=leg('other',{scheduleId:'other',aircraftId:'b'});
 const onward=leg('onward',{scheduleId:'child',origin:'HND',destination:'LAX'});
 const nextWeek=leg('next',{departure:'2026-10-19T08:00:00Z',arrival:'2026-10-19T10:00:00Z'});
 const s={aircraft:fleet,airports,flights:[out,back,other,onward,nextWeek],routes:[]};
 const c=flightContext(out,s);
 assert.equal(c.number.weeklyLegs,3);assert.equal(c.number.aircraft.length,2); // Same flight number includes its onward segment.
 assert.equal(c.route.weeklyLegs,3);assert.equal(c.route.plan.weeklyProfit,200);assert.equal(c.route.aircraft.length,2);
 assert.equal(c.tail.weeklyLegs,3);assert.equal(c.tail.rows.reduce((n,r)=>n+r.weeklyFlights,0),3); // Other aircraft never contributes.
 assert.ok(c.tail.rows.every(r=>r.registrations.join()==='B-1'));
});
test('missing economics stays unknown and a new snapshot replaces deleted schedules',()=>{
 const out=leg('one',{weeklyProfit:null,weeklyPassengers:null});
 const s={aircraft:fleet,airports,flights:[out],routes:[]};
 assert.equal(flightContext(out,s).route.plan.weeklyProfit,null);assert.equal(flightContext(out,s).number.weeklyLegs,1);
 assert.equal(flightContext(out,{...s,flights:[]}).number.weeklyLegs,0);
});

test('merged same-model times retain exact aircraft-to-local-weekday assignments and click targets',()=>{
 const fleet2=[...fleet,{...fleet[0],id:'c',registration:'B-3'}];
 const a=leg('a-mon'),c=leg('c-fri',{aircraftId:'c',departure:'2026-10-16T08:00:00Z',arrival:'2026-10-16T10:00:00Z'});
 const cSat=leg('c-sat',{aircraftId:'c',departure:'2026-10-17T08:00:00Z',arrival:'2026-10-17T10:00:00Z'});
 const bSun=leg('b-sun',{aircraftId:'b',departure:'2026-10-18T08:00:00Z',arrival:'2026-10-18T10:00:00Z'});
 const next=leg('a-next',{departure:'2026-10-19T08:00:00Z',arrival:'2026-10-19T10:00:00Z'});
 const flights=[next,bSun,cSat,c,a],s={aircraft:fleet2,airports,flights,routes:[]};
 const rows=flightContext(a,s).number.rows,merged=rows[0];
 assert.equal(rows.length,1);assert.equal(merged.weeklyFlights,4);
 assert.deepEqual(merged.assignments.map(x=>[x.registration,x.days]),[['B-1',[0]],['B-2',[6]],['B-3',[4,5]]]);
 assert.equal(merged.assignments.reduce((n,x)=>n+x.weeklyFlights,0),4);
 assert.deepEqual(merged.equipment.map(x=>[x.type,x.days]),[['777',[6]],['A330',[0,4,5]]]);
 const now=new Date('2026-10-16T09:00:00Z'),assignment=merged.assignments.find(x=>x.aircraftId==='c');
 assert.equal(scheduledOccurrence(merged,flights,now,assignment).id,'c-fri');
 assert.equal(scheduledOccurrence(merged,flights,now,merged.assignments[0]).id,'a-next');
 assert.equal(scheduledOccurrence(merged,flights.filter(x=>x.aircraftId!=='c'),now,assignment),null);
 const returnLeg=leg('return',{direction:'in',origin:'HND',destination:'PEK',departure:'2026-10-12T23:00:00Z',arrival:'2026-10-13T01:00:00Z'});
 const localAirports=airports.map(x=>({...x,utcOffsetSeconds:28800}));
 const returns=flightContext(returnLeg,{...s,airports:localAirports,flights:[returnLeg]}).number.rows[0];
 assert.deepEqual(returns.assignments[0].days,[1]); // Return assignment follows its own local Tuesday.
 assert.equal(scheduledOccurrence(returns,[returnLeg],now,returns.assignments[0]).id,'return');
});

test('same-number services keep distinct times, arrival dates, segments and unknown timezones separate',()=>{
 const a=leg('a'),other=leg('b',{aircraftId:'b',scheduleId:'b'});
 const retimed=leg('retimed',{aircraftId:'b',scheduleId:'retimed',departure:'2026-10-12T09:00:00Z',arrival:'2026-10-12T11:00:00Z'});
 const overnight=leg('overnight',{aircraftId:'b',scheduleId:'overnight',arrival:'2026-10-13T10:00:00Z'});
 const onward=leg('onward',{scheduleId:'child',origin:'HND',destination:'LAX'});
 const s={aircraft:fleet,airports,flights:[a,other,retimed,overnight,onward],routes:[]};
 const c=flightContext(a,s);assert.equal(c.number.rows.length,4);assert.equal(c.number.weeklyLegs,5);
 const merged=c.number.rows.find(r=>r.departure==='08:00'&&r.arrivalDayOffset===0&&r.origin==='PEK');
 assert.equal(merged.assignments.length,2);assert.equal(merged.weeklyFlights,2);
 const changed=flightContext(a,{...s,flights:[a]});assert.equal(changed.number.rows.length,1);assert.deepEqual(changed.number.rows[0].registrations,['B-1']);
 const unknown=flightContext(a,{...s,flights:[a,other],airports:airports.map(({utcOffsetSeconds,...airport})=>airport)});assert.equal(unknown.number.rows.length,2);
});
