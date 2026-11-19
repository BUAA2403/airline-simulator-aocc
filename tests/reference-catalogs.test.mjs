import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import airports from '../server/data/airports.json' with {type:'json'};
import types from '../server/data/aircraft-types.json' with {type:'json'};
import {destinationRegion} from '../web/regions.mjs';
import {aircraftProfile,engineStations} from '../web/aircraft-catalog.mjs';
import {cabinGeometry} from '../web/cabin-geometry.mjs';
import {auditReferences} from '../server/reference-audit.mjs';
import {noseTemplateFor,seatTemplates} from '../web/cabin-template.mjs';

test('every airport in the game reference catalog has an operational region',()=>{
 assert.deepEqual(airports.filter(a=>destinationRegion(a)==='其他').map(a=>[a.id,a.country]),[]);
});
test('Russian airports use subdivisions, including the date line and inland border areas',()=>{
 for(const [id,region] of Object.entries({VVO:'东北亚',KHV:'东北亚',UUD:'东北亚',HTA:'东北亚',DYR:'东北亚',YKS:'东北亚',IKT:'北亚',OVB:'北亚',SVO:'欧洲',LED:'欧洲'})){
  const a=airports.find(a=>a.id===id);assert.ok(a,id);assert.equal(destinationRegion(a),region,id);
 }
 // New airport identifiers reuse geography rather than a hand-maintained IATA list.
 assert.equal(destinationRegion({country:'Russia',lat:43.4,lon:132.1,id:'NEW'}),'东北亚');
 assert.equal(destinationRegion({country:'Russia',lat:56.86,lon:105.73,id:'NEW'}),'北亚');
});
test('country aliases, ISO codes, Central Asia and overseas territories retain geography',()=>{
 for(const [country,region] of [['MM','东南亚'],['Myanmar (Burma)','东南亚'],['Timor-Leste (East Timor)','东南亚'],['Kazakhstan','中亚'],['UZB','中亚'],['韩国','东北亚'],['GB','欧洲'],['Mexico','拉丁美洲'],['Guam','大洋洲'],['Reunion','非洲'],['French Guiana','拉丁美洲'],['Mauritius','非洲']])assert.equal(destinationRegion({country}),region,country);
 assert.equal(destinationRegion(airports.find(a=>a.id==='BON')),'拉丁美洲');
 assert.equal(destinationRegion({country:'Future unknown place',lat:40,lon:5}),'其他');
 assert.equal(destinationRegion({country:'Russia'}),'其他');
});
test('all game models have physical metadata and a native aircraft image mapping',()=>{
 const hasNativeImages=existsSync(new URL('../public/game-assets/aircraft/',import.meta.url));
 for(const t of types){
  const p=aircraftProfile(t);
  assert.ok(p.known,t.aircraft_model);
  assert.ok(p.image,t.aircraft_model);
  if(hasNativeImages)assert.ok(existsSync(new URL('../public'+p.image,import.meta.url)),p.image);
  assert.ok(p.length>0);
  assert.ok(p.wingspan>0);
 }
});
test('four-engine jets, rear engines and propellers are independent of game cabin classes',()=>{
 for(const model of ['Boeing 747-400','Boeing 747-8','Airbus A340-600','Airbus A380-800'])assert.equal(engineStations(aircraftProfile(model),1000).length,4,model);
 assert.equal(aircraftProfile('Airbus A330-300').engines,2);
 for(const model of ['Boeing 717-200','Bombardier CRJ-900','Embraer ERJ-145','Comac ARJ-21-700'])assert.equal(aircraftProfile(model).mount,'rear',model);
 for(const model of ['ATR 72-600','De Havilland Canada Dash 8 Q400'])assert.ok(engineStations(aircraftProfile(model),500).every(e=>e.propeller),model);
 assert.equal(aircraftProfile('Airbus A380-800').deck,'full');assert.equal(aircraftProfile('Boeing 747-400').deck,'partial');
 assert.equal(aircraftProfile('A343').engines,4);
 assert.equal(aircraftProfile('Boeing 747-900 Future').engines,4);
 assert.equal(aircraftProfile('Future aircraft').engines,null);assert.deepEqual(engineStations(aircraftProfile('Future aircraft'),500),[]);
});
test('cabin diagrams preserve actual seat counts, partial rows and dynamic cabin width',()=>{
 const a={type:'Boeing 747-400',cabins:{first:{numSeats:4,config:'1-1',numRows:2},eco:{numSeats:293,config:'3-4-3',numRows:30}}};
 const g=cabinGeometry(a);assert.equal(g.engines.length,4);
 assert.equal(g.sections.flatMap(s=>s.rows.flatMap(r=>r.seats)).length,297);
 assert.equal(g.sections[1].rows.at(-1).seats.length,3);
 assert.ok(g.sections.flatMap(s=>s.rows.flatMap(r=>r.seats)).every(s=>Math.abs(s.y)+6<g.half));
 assert.equal(cabinGeometry({type:'unknown',cabins:{eco:{numSeats:30}}}).sections.length,0);
 assert.equal(cabinGeometry({cabins:{eco:{numSeats:5,config:'2-2',numRows:1}}}).sections[0].rows.length,2);
});
test('future reference gaps are explicitly identified without blocking valid snapshots',()=>{
 assert.deepEqual(auditReferences({airports,aircraft:types.map(t=>({type:t.aircraft_model}))}),[]);
 const result=auditReferences({airports:[{id:'NEW',country:'Unregistered place'}],aircraft:[{type:'Boeing 747 future'},{type:'Unknown type'}]});
 assert.equal(result.length,2);assert.ok(result[0].includes('NEW'));assert.ok(result[1].includes('Unknown type'));assert.ok(result[1].includes('747 future'));
});
test('existing cabin templates cover all game model families and contain only inert vector primitives',()=>{
 for(const type of types){const t=noseTemplateFor(aircraftProfile(type).family);assert.notEqual(t.key,'default',type.aircraft_model);assert.ok(t.height>0);}
 const inspect=items=>{for(const item of items){assert.ok(['g','path','rect','circle','ellipse','polygon','polyline','line'].includes(item.tag));for(const [key,value] of Object.entries(item.props)){assert.ok(!/^on|href|style|src/i.test(key));assert.ok(!/\$\{|javascript:|https?:\/\//i.test(value));}inspect(item.children);}};
 for(const type of types)inspect(noseTemplateFor(aircraftProfile(type).family).geometry);
 for(const k of ['first','biz','premEco','eco']){assert.ok(seatTemplates[k].geometry.length);inspect(seatTemplates[k].geometry);}
 assert.equal(noseTemplateFor('UNKNOWN').key,'default');
});
test('premium rows use the full cabin width while keeping every seat inside the cabin',()=>{
 const g=cabinGeometry({type:'Boeing 747-8',cabins:{first:{numSeats:6,config:'1-1-1'},biz:{numSeats:48,config:'1-2-1'},eco:{numSeats:310,config:'3-4-3'}}});
 assert.ok(g.sections[0].seatScale>2);assert.ok(g.sections[1].seatScale>1.8);assert.equal(g.sections[2].seatScale,1);
 for(const s of g.sections)for(const row of s.rows)for(const seat of row.seats){assert.ok(seat.y>=-g.half+9);assert.ok(seat.y+6*s.seatScale<=g.half-9);}
 assert.equal(g.sections.flatMap(s=>s.rows.flatMap(r=>r.seats)).length,364);
});
test('wing-mounted nacelles attach to their own wing leading edge at every supported width',()=>{
 for(const type of types){const p=aircraftProfile(type);if(p.mount!=='wing')continue;
  for(const width of [480,950,1700])for(const e of engineStations(p,width,180,66)){
   assert.ok(e.x-25<e.leadingEdgeX,type.aircraft_model);
   assert.ok(e.x+18>e.leadingEdgeX,type.aircraft_model);
   assert.ok(e.pylon.x2>e.leadingEdgeX,type.aircraft_model);
   assert.ok(e.pylon.x1<e.x+18,type.aircraft_model);
   assert.ok(Math.abs(e.y-180)>66+7);
  }
 }
 const g=cabinGeometry({type:'Boeing 747-8',cabins:{eco:{numSeats:310,config:'3-4-3'}}});
 // The label and row-number strips are clear of the seats, inside the fuselage.
 const seats=g.sections.flatMap(s=>s.rows.flatMap(r=>r.seats));
 assert.ok(Math.min(...seats.map(s=>s.y))+g.half>20);
 assert.ok(Math.max(...seats.map(s=>s.y+6))<g.half-15);
});
