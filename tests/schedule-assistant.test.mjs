import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeGame} from '../server/game-normalize.mjs';
import {validateSnapshot} from '../server/normalize.mjs';
import {aircraftTrialBases,buildScheduleAssistant,extendTrial,matchesConflict,recommendForAircraft,recommendTrial,scheduleLocalStamp,trialWithConnections,weeklySpacing} from '../web/schedule-assistant.mjs';
import {buildConsistencyIndex,consistencyAdvice,consistencyTargets} from '../web/schedule-consistency.mjs';
import {buildExpansionIndex,recommendExpansion} from '../web/schedule-expansion.mjs';

const uid = 'polaris';
const player = {uid, airlineName:'EXAMPLE AIR', airlineCode:'CA', hubAirports:['PEK','PVG','CAN']};
const aircraft = [
  {uid, aircraftId:'target', registration:'B-0001', aircraftModel:'Airbus A350-900', hubAirport:'PEK'},
  {uid, aircraftId:'other', registration:'B-0002', aircraftModel:'Boeing 777-9', hubAirport:'PEK'},
  {uid, aircraftId:'pvg', registration:'B-0003', aircraftModel:'Airbus A320-200', hubAirport:'PVG'},
  {uid, aircraftId:'can', registration:'B-0004', aircraftModel:'Airbus A320-200', hubAirport:'CAN'},
];
const at = (hours, minutes=0) => hours*3600+minutes*60;
const assignment = (aircraftId,dowList) => ({aircraftId,dowList});
const row = (id, code, overrides={}) => ({uid, flightId:id, originAirport:'PEK', destinationAirport:'ICN',
  outboundFlightNumber:code, inboundFlightNumber:code+1, departureDailyTimestamp:at(9),
  outboundFlightDuration:60, inboundFlightDuration:60, turnaroundOffset:0, isStopover:false,
  aircraftAssignments:{}, ...overrides});
const flightOn = (id, code, days, overrides) => row(id,code,{aircraftAssignments:{other:assignment('other',days)},...overrides});
const normalized = (flights, date='2026-11-16T00:00:00Z') => normalizeGame({player,aircraft,flights},new Date(date),{fullCycle:true});
const forTail = (snapshot,id='target',minimum=5) => recommendForAircraft(buildScheduleAssistant(snapshot),snapshot.aircraft.find(a=>a.id===id),minimum);
const suggestion = (snapshot,id,tail='target',minimum=5) => forTail(snapshot,tail,minimum).find(row=>row.id===id);

test('uses weekdays from all aircraft and replans automatically when a synced assignment fills a vacancy', () => {
  const first = flightOn('service',100,[0,2,3,4,5,6]);
  const initial = normalized([first]);
  const nextWeek = normalized([first],'2026-11-23T05:00:00Z');
  assert.deepEqual(initial.weeklySchedules,nextWeek.weeklySchedules);
  const proposed = suggestion(initial,'service');
  assert.deepEqual(proposed.matches.map(m=>m.day),[1]);
  assert.equal(proposed.fillsWeek,true);
  assert.equal(proposed.extraMinutes,120);
  assert.deepEqual(proposed.execution.assignments,[{aircraftId:'other',registration:'B-0002',type:'Boeing 777-9',days:[0,2,3,4,5,6],sectors:[]}]);
  const revised = normalized([{...first,aircraftAssignments:{...first.aircraftAssignments,pvg:assignment('pvg',[1])}}]);
  assert.equal(suggestion(revised,'service'),undefined);
  assert.equal(suggestion(validateSnapshot(initial),'service').root.outboundNumber,'CA100');
});

test('checks each ground connection and never treats an away-airport layover as an available aircraft', () => {
  const service = flightOn('service',100,[0,2,3,4,5,6],{departureDailyTimestamp:at(9,5)});
  const earlier = row('earlier',200,{departureDailyTimestamp:at(6),aircraftAssignments:{target:assignment('target',[1])}});
  const later = row('later',300,{departureDailyTimestamp:at(12,10),aircraftAssignments:{target:assignment('target',[1])}});
  const snapshot = normalized([service,earlier,later]);
  const [match] = suggestion(snapshot,'service').matches;
  assert.equal(match.before,5*60);
  assert.equal(match.after,5*60);
  assert.equal(match.previous.schedule.inboundNumber,'CA201');
  assert.equal(match.next.schedule.outboundNumber,'CA300');
  assert.equal(suggestion(snapshot,'service','target',10),undefined);
  const away = {...earlier,turnaroundOffset:20};
  assert.equal(suggestion(normalized([service,away]),'service'),undefined);
});

test('uses the preceding Sunday and closes the weekly cycle at local Monday even if it is UTC Sunday', () => {
  const service = flightOn('service',100,[1,2,3,4,5,6],{departureDailyTimestamp:at(0,30)});
  const previous = row('sunday',200,{departureDailyTimestamp:at(22),aircraftAssignments:{target:assignment('target',[6])}});
  assert.equal(suggestion(normalized([service,previous]),'service'),undefined);
  const valid = suggestion(normalized([service,{...previous,departureDailyTimestamp:at(21)}]),'service').matches[0];
  assert.equal(valid.day,0);
  assert.equal(valid.before,30*60);
  assert.equal(scheduleLocalStamp(valid.legs[0].start,8*3600),'周一 00:30');
  assert.equal(scheduleLocalStamp(valid.legs[0].start),'周日 16:30');
});

test('builds a four-leg stopover rotation and hides partially occupied days and orphan children', () => {
  const root = flightOn('root',100,[0,2],{isStopover:true,destinationAirport:'ICN',turnaroundOffset:20,childStopoverFlightId:'child'});
  const child = flightOn('child',200,[0,1,2],{isStopover:true,originAirport:'ICN',destinationAirport:'NRT',departureDailyTimestamp:at(11,30)});
  const snapshot = normalized([root,child]);
  const match = suggestion(snapshot,'root');
  assert.deepEqual(match.path,['PEK','ICN','NRT']);
  assert.deepEqual(match.matches.map(d=>d.day),[3,4,5,6]);
  assert.deepEqual(match.legs.map(leg=>leg.number),['CA100','CA200','CA201','CA101']);
  assert.equal(match.flightMinutes,240);
  assert.deepEqual([...match.execution.operatingDays],[0,2]);
  assert.deepEqual([...match.execution.occupiedDays],[0,2,1]);
  assert.deepEqual(match.execution.assignments.find(item=>item.days.includes(1)).sectors,['ICN ↔ NRT']);
  assert.equal(match.fillsWeek,false);
  assert.equal(suggestion(snapshot,'child'),undefined);
  assert.equal(suggestion(normalized([root,{...child,departureDailyTimestamp:at(20)}]),'root'),undefined);
  assert.equal(suggestion(normalized([root]),'root'),undefined);
  assert.equal(suggestion(normalized([child]),'child'),undefined);
});

test('checks exact model range and airport category, including new aircraft and bases', () => {
  const short = flightOn('pvg',100,[0,1,2],{originAirport:'PVG',destinationAirport:'ICN'});
  const far = row('far',200,{originAirport:'PVG',destinationAirport:'JFK'});
  const smallAirport = row('small',300,{destinationAirport:'AAE'});
  const thirdBase = row('new',400,{originAirport:'CAN',destinationAirport:'HKG'});
  const snapshot = normalized([short,far,smallAirport,thirdBase]);
  assert.ok(suggestion(snapshot,'pvg','pvg'));
  assert.deepEqual(forTail(snapshot,'pvg').map(r=>r.id),['pvg']);
  assert.ok(suggestion(snapshot,'new','can'));
  assert.equal(suggestion(snapshot,'pvg','target'),undefined);
  assert.equal(suggestion(snapshot,'small','target'),undefined);
});

test('an empty unbased aircraft can start a trial at a configured base without mixing bases', () => {
  const pek = row('pek',100);
  const pvg = row('pvg',200,{originAirport:'PVG'});
  const notBase = row('not-base',300,{originAirport:'ICN',destinationAirport:'PEK'});
  const snapshot = normalizeGame({player,aircraft:aircraft.map(a=>a.aircraftId==='target'?{...a,hubAirport:'EMPTY'}:a),
    flights:[pek,pvg,notBase]},new Date('2026-11-16T00:00:00Z'));
  const target=snapshot.aircraft.find(a=>a.id==='target');
  const assistant=buildScheduleAssistant(snapshot);
  assert.equal(target.homeBase,'EMPTY');
  assert.equal(target.location,'EMPTY');
  assert.deepEqual(aircraftTrialBases(assistant,target),['PEK','PVG','CAN']);
  const recommend=(base,tail=target,state=assistant)=>recommendForAircraft(state,tail,5,base);
  assert.deepEqual(recommend('PEK').map(r=>r.id),['pek']);
  assert.deepEqual(recommend('PVG').map(r=>r.id),['pvg']);
  assert.deepEqual(recommendTrial(recommend('PVG')).map(m=>m.origin),Array(7).fill('PVG'));
  assert.deepEqual(recommend('ICN'),[]);
  assert.deepEqual(recommend('PEK',{...target,homeBase:'',location:'PVG'}),[]);
  assert.deepEqual(recommend('PVG',{...target,homeBase:'',location:'PVG'}).map(r=>r.id),['pvg']);

  const assigned=normalized([{...pek,aircraftAssignments:{target:assignment('target',[0])}},pvg]);
  const updatedTail=assigned.aircraft.find(a=>a.id==='target');
  const updated=buildScheduleAssistant(assigned);
  assert.equal(aircraftTrialBases(updated,updatedTail),null);
  assert.deepEqual(recommend('PVG',updatedTail,updated).map(r=>r.id),['pek']);
  assert.equal(aircraftTrialBases(updated,{...updatedTail,homeBase:'EMPTY'}),null);
});

test('route expansion excludes owned routes and validates demand, weekday headway and the selected tail',()=>{
  const service=row('existing',100,{departureDailyTimestamp:at(7),outboundFlightDuration:65,inboundFlightDuration:80,turnaroundOffset:1,aircraftAssignments:{
    other:{...assignment('other',[0,1,2,3,4,5,6]),ecoPax:630,premEcoPax:0,bizPax:0,firstPax:0},
  }});
  const tailDuty=row('duty',200,{destinationAirport:'GMP',departureDailyTimestamp:at(10),
    aircraftAssignments:{target:assignment('target',[0,1,2,3,4,5,6])}});
  const snapshot=normalized([service,tailDuty]);
  snapshot.aircraft.find(a=>a.id==='other').capacity=100;
  const target=snapshot.aircraft.find(a=>a.id==='target');
  const assistant=buildScheduleAssistant(snapshot);
  const index=buildExpansionIndex(snapshot);
  const options={query:'ICN',maxTrips:3};
  assert.deepEqual(recommendExpansion(assistant,index,target,options).plans,[]);
  const extra=recommendExpansion(assistant,index,target,{...options,mode:'extra'}).plans[0];
  assert.ok(extra);
  assert.equal(extra.market.passengers,630);
  assert.equal(extra.market.seats,700);
  assert.equal(extra.market.load,0.9);
  assert.deepEqual(extra.timing,{outboundMinutes:65,inboundMinutes:80,turnaroundMinutes:75,source:'schedule'});
  assert.equal(extra.matches.length,3);
  assert.equal(new Set(extra.matches.map(m=>m.legs[0].start%86400)).size,1);
  for (const match of extra.matches) {
    assert.ok(match.before>=15*60 && match.after>=15*60);
    assert.deepEqual(match.legs.map(leg=>(leg.end-leg.start)/60),[65,80]);
    assert.equal((match.utc.end-match.utc.start)/60,220);
    for (const leg of match.legs) {
      const localHour=((leg.start+index.airports.get(leg.origin).utcOffsetSeconds)%86400)/3600;
      assert.ok(localHour>=6 && localHour<23.5);
      assert.ok(extra.market.departures.get(leg.origin).every(seconds=>[-604800,0,604800].every(shift=>Math.abs(leg.start-seconds+shift)>=90*60)));
    }
  }
  const missing={...snapshot,flights:[]};
  const missingIndex=buildExpansionIndex(missing);
  assert.deepEqual(recommendExpansion(assistant,missingIndex,target,{...options,mode:'extra'}).plans,[]);
  assert.equal(recommendExpansion(assistant,missingIndex,target,{...options,mode:'extra',demandOnly:false}).plans[0].market.load,null);
  const idle=normalized([]);
  const idleAssistant=buildScheduleAssistant(idle), idleIndex=buildExpansionIndex(idle);
  const fresh=recommendExpansion(idleAssistant,idleIndex,target,{query:'BRU',maxTrips:2}).plans[0];
  assert.equal(fresh.airport.id,'BRU');
  assert.match(fresh.reference.note,/国航/);
  assert.equal(fresh.matches.length,2);
  assert.equal(fresh.timing.source,'estimate');
  assert.ok(fresh.timing.outboundMinutes>fresh.timing.inboundMinutes);
  assert.deepEqual(fresh.matches[0].legs.map(leg=>(leg.end-leg.start)/60),[fresh.timing.outboundMinutes,fresh.timing.inboundMinutes]);
  assert.equal(weeklySpacing(fresh.matches.map(m=>m.day)).longest,4);
});

test('continues an existing reverse base-to-base assignment for a tail only when its own rotation stays continuous', () => {
  const reverse = flightOn('reverse',100,[0,1,2],{originAirport:'PVG',destinationAirport:'PEK'});
  assert.equal(suggestion(normalized([reverse]),'reverse'),undefined);
  reverse.aircraftAssignments.target = assignment('target',[3]);
  assert.ok(suggestion(normalized([reverse]),'reverse'));
  const pek = row('pek',300,{aircraftAssignments:{target:assignment('target',[1])}});
  assert.equal(suggestion(normalized([reverse,pek]),'reverse'),undefined);
});

test('reserves flight numbers across schedule rows and prevents simultaneous incompatible trials', () => {
  const coverage = flightOn('service',100,[0,2,3,5,6]);
  const sameNumber = flightOn('alternate',100,[1],{departureDailyTimestamp:at(14)});
  const other = flightOn('overlap',300,[0,1,2,3,5,6],{departureDailyTimestamp:at(10)});
  const snapshot = normalized([coverage,sameNumber,other]);
  const [primary] = suggestion(snapshot,'service').matches;
  const [variant] = suggestion(snapshot,'alternate').matches;
  const [overlapping] = suggestion(snapshot,'overlap').matches;
  assert.equal(primary.day,4);
  assert.equal(matchesConflict(primary,variant),true);
  assert.equal(matchesConflict(primary,overlapping),true);
  assert.deepEqual(extendTrial([primary],[variant,primary,overlapping]).map(m=>m.id),[primary.id]);
  assert.deepEqual(extendTrial([],[overlapping,primary,variant]).map(m=>m.id),[overlapping.id,variant.id]);
});

test('a rotation longer than a day offers individually valid weekdays without adding overlapping benefits', () => {
  const long = row('long',100,{destinationAirport:'JFK',outboundFlightDuration:900,inboundFlightDuration:900});
  const best = suggestion(normalized([long]),'long');
  assert.equal(best.matches.length,7);
  assert.equal(best.suggestedMatches.length,3);
  assert.equal(best.fillsWeek,false);
  assert.equal(best.extraMinutes,5400);
});

test('smart trial compares alternatives and previews the connection between two newly recommended rotations', () => {
  const days = [0,2,3,4,5,6];
  const long = flightOn('long',100,days,{departureDailyTimestamp:at(9),outboundFlightDuration:200,inboundFlightDuration:200});
  const morning = flightOn('morning',200,days,{departureDailyTimestamp:at(8),outboundFlightDuration:100,inboundFlightDuration:100});
  const afternoon = flightOn('afternoon',300,days,{departureDailyTimestamp:at(12,30),outboundFlightDuration:120,inboundFlightDuration:120});
  const rows = forTail(normalized([long,morning,afternoon]));
  assert.equal(rows[0].id,'long');
  const plan = trialWithConnections(recommendTrial(rows));
  assert.deepEqual(plan.map(match=>match.id).sort(),['afternoon:1','morning:1']);
  const first = plan.find(match=>match.id==='morning:1');
  assert.equal(first.after,600);
  assert.equal(first.next.schedule.outboundNumber,'CA300');
  assert.equal(plan.find(match=>match.id==='afternoon:1').before,600);
  assert.deepEqual(recommendTrial(rows,[],15).map(match=>match.id),['long:1']);
});

test('recommended list and smart trial favor established widebody services when otherwise comparable', () => {
  const days = [0,2,3,4,5,6];
  const wide = flightOn('wide',200,days);
  const narrow = row('narrow',100,{destinationAirport:'GMP',outboundFlightDuration:70,inboundFlightDuration:70,
    aircraftAssignments:{pvg:assignment('pvg',days)}});
  const rows = forTail(normalized([narrow,wide]));
  assert.deepEqual(rows.map(row=>row.id),['wide','narrow']);
  assert.deepEqual(rows[0].fit.referenceMix,[{size:'宽体',share:100}]);
  assert.equal(rows[1].fit.sizeMatch,0);
  assert.deepEqual(recommendTrial(rows).map(match=>match.id),['wide:1']);
});

test('original weekday assignments keep each tail and relative ranking uses real cabin products', () => {
  const days = [0,2,3,4,5,6];
  const matching = row('matching',300,{aircraftAssignments:{other:assignment('other',[0,2,3]),can:assignment('can',[4,5,6])}});
  const different = row('different',200,{aircraftAssignments:{pvg:assignment('pvg',days)}});
  const snapshot = normalized([matching,different]);
  const cabin = (businessProduct) => ({
    first:{numSeats:0}, biz:{numSeats:36,seatProduct:businessProduct},
    premEco:{numSeats:0}, eco:{numSeats:284,seatProduct:'comfort'}
  });
  snapshot.aircraft = snapshot.aircraft.map(a=>({...a,type:'Airbus A350-900',capacity:320,
    cabins:cabin(a.id==='pvg'?'recliner':'staggered')}));
  const rows = forTail(snapshot);
  assert.equal(rows[0].id,'matching');
  assert.equal(rows[0].fit.cabinFit,1);
  assert.ok(rows[1].fit.cabinFit<1);
  assert.deepEqual(rows[0].execution.assignments.map(a=>[a.registration,a.days]),[
    ['B-0002',[0,2,3]],['B-0004',[4,5,6]]
  ]);
});

test('unflown numbers inherit the published same-route equipment mix including reverse rotations and full schedules', () => {
  const established = flightOn('daily',300,[0,1,2,3,4,5,6],{originAirport:'ICN',destinationAirport:'PEK'});
  const open = row('new',100);
  const otherRoute = row('elsewhere',200,{destinationAirport:'NRT'});
  const snapshot = normalized([established,open,otherRoute]);
  assert.equal(suggestion(snapshot,'daily'),undefined);
  assert.equal(suggestion(snapshot,'new').fit.source,'route');
  assert.equal(suggestion(snapshot,'new').fit.cabinFit,null);
  assert.equal(suggestion(snapshot,'elsewhere').fit.source,null);
  assert.equal(suggestion(snapshot,'elsewhere').fit.score,0);
});

test('unassigned timed rows remain available and missing or incomplete snapshots are distinguished', () => {
  const open = row('timed',100);
  const unscheduled = row('no-time',200,{departureDailyTimestamp:-1});
  const foreign = row('external',300,{uid:'other-airline'});
  const snapshot = normalized([open,unscheduled,foreign]);
  assert.deepEqual(snapshot.weeklySchedules.map(s=>s.id),['timed']);
  assert.equal(snapshot.flights.length,0);
  assert.equal(suggestion(snapshot,'timed').matches.length,7);
  assert.equal(buildScheduleAssistant({...snapshot,weeklySchedules:undefined}).status,'unavailable');
  const broken = normalized([open,row('bad-assignment',300,{aircraftAssignments:'not JSON'})]);
  assert.equal(buildScheduleAssistant(broken).status,'incomplete');
  assert.deepEqual(forTail(broken),[]);
});

test('haul preferences choose the preferred overlapping rotation and can still use remaining windows',()=>{
  const occupied=[0,2,3,4,5,6];
  const short=flightOn('short',100,occupied);
  const long=flightOn('long',200,occupied,{destinationAirport:'DXB',outboundFlightDuration:450,inboundFlightDuration:450});
  const filler=flightOn('filler',300,[0,1,2,3,5,6],{departureDailyTimestamp:at(14)});
  const rows=forTail(normalized([short,long,filler]));
  assert.deepEqual(recommendTrial(rows,[],5,'long').map(m=>m.id).sort(),['filler:4','long:1']);
  assert.deepEqual(recommendTrial(rows,[],5,'short').map(m=>m.id).sort(),['filler:4','short:1']);
});

test('a four-day cadence uses the Sunday to Monday gap and favors the better spread',()=>{
  assert.equal(weeklySpacing([0,2,4,6]).longest,2);
  assert.equal(weeklySpacing([0,1,2,3]).longest,4);
  const [candidate]=forTail(normalized([flightOn('cadence',100,[0,2,4])]));
  const matches=candidate.matches.filter(m=>[1,6].includes(m.day)).map(m=>({...m,numberDays:[...m.numberDays,'exclusive']}));
  assert.deepEqual(recommendTrial([{...candidate,matches}]).map(m=>m.day),[6]);
});

test('same-route flights with different flight numbers also influence the spread',()=>{
  const rows=forTail(normalized([flightOn('candidate',100,[0]),flightOn('other-number',200,[2,4])]));
  const candidate=rows.find(row=>row.id==='candidate');
  const matches=candidate.matches.filter(m=>[1,6].includes(m.day)).map(m=>({...m,numberDays:[...m.numberDays,'exclusive']}));
  assert.deepEqual([...candidate.routeDays].sort(),[0,2,4]);
  assert.deepEqual(recommendTrial([{...candidate,matches}]).map(m=>m.day),[6]);
});

const classPlan = economy=>Object.fromEntries([['first',0],['biz',0],['premEco',0],['eco',economy]]
  .map(([cabin,averagePassengers])=>[cabin,{averagePassengers}]));
const fullDays = [0,2,3,4,5,6];
function consistencyFixture(rows) {
  const snapshot=normalized(rows);
  snapshot.aircraft=snapshot.aircraft.map(a=>{
    const capacity=a.id==='target'||a.id==='other'?320:160;
    return {...a,homeBase:'PEK',location:'PEK',capacity,cabins:{
      first:{numSeats:0},biz:{numSeats:0},premEco:{numSeats:0},eco:{numSeats:capacity,seatProduct:'comfort'}
    }};
  });
  return snapshot;
}
const mixedFlight=()=>row('mixed',100,{aircraftAssignments:{other:assignment('other',fullDays),pvg:assignment('pvg',[1])}});

test('product consistency finds a feasible replacement and protects planned seats by cabin',()=>{
  const blocker=row('blocker',200,{aircraftAssignments:{other:assignment('other',[1])}});
  const snapshot=consistencyFixture([mixedFlight(),blocker]);
  const a=buildScheduleAssistant(snapshot);
  const index=buildConsistencyIndex(a,snapshot.flights);
  const service=index.reports.find(s=>s.rotation.id==='mixed');
  assert.deepEqual(service.seatSpan,[160,320]);
  assert.equal(service.options[0].profile.capacity,320);
  const advice=consistencyAdvice(a,index,service);
  const idea=advice.results[0].ideas[0];
  assert.equal(idea.tail.id,'target');
  assert.equal(idea.swap,null);
  assert.equal(idea.releasedMatch.utc.start,idea.match.utc.start);
  assert.deepEqual(idea.seatSpan,[320,320]);
  assert.equal(idea.targetDays,7);
  const downsize=service.options.find(o=>o.profile.capacity===160).key;
  assert.ok(consistencyAdvice(a,index,service,downsize).results.every(r=>r.blocked==='capacity'));
});

test('consistency targets group similar models and can use a fleet capacity absent from the original rotation',()=>{
  const snapshot=consistencyFixture([mixedFlight()]);
  const capacities={other:332,target:349,can:445};
  snapshot.aircraft=snapshot.aircraft.map(a=>capacities[a.id]?{...a,type:a.id==='other'?'Boeing 777-9':a.id==='target'?'Airbus A350-1000':'Boeing 747-8',
    capacity:capacities[a.id],cabins:{...a.cabins,eco:{numSeats:capacities[a.id],seatProduct:'comfort'}}}:a);
  const assistant=buildScheduleAssistant(snapshot), index=buildConsistencyIndex(assistant,[]);
  const service=index.reports.find(s=>s.rotation.id==='mixed');
  const options=consistencyTargets(assistant,service);
  assert.ok(options.some(option=>option.profile.capacity===445));
  assert.ok(!options.some(option=>option.profile.capacity===349));
  assert.ok(consistencyAdvice(assistant,index,service).results[0].ideas.some(idea=>idea.tail.id==='target'));
  const large=options.find(option=>option.profile.capacity===445);
  assert.equal(consistencyAdvice(assistant,index,service,large.key).target.profile.capacity,445);
});

test('product consistency can swap overlapping rotations when both cabins and schedules are protected',()=>{
  const blocker=row('blocker',200,{aircraftAssignments:{other:assignment('other',[1])}});
  const complementary=row('complementary',300,{destinationAirport:'NRT',aircraftAssignments:{can:assignment('can',fullDays),target:assignment('target',[1])}});
  const snapshot=consistencyFixture([mixedFlight(),blocker,complementary]);
  const a=buildScheduleAssistant(snapshot);
  const forecast=snapshot.flights.map(f=>f.scheduleId==='complementary'?{...f,cabinPlan:classPlan(125)}:f);
  const index=buildConsistencyIndex(a,forecast);
  const service=index.reports.find(s=>s.rotation.id==='mixed');
  const [idea]=consistencyAdvice(a,index,service).results[0].ideas;
  assert.equal(idea.tail.id,'target');
  assert.equal(idea.swap.rotation.id,'complementary');
  const conservativeIndex=buildConsistencyIndex(a,[]);
  assert.equal(consistencyAdvice(a,conservativeIndex,service).results[0].blocked,'schedule');
});
