import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Store } from '../server/store.mjs';
import { Vault } from '../server/vault.mjs';
import { SyncEngine } from '../server/sync.mjs';
import { validateSnapshot } from '../server/normalize.mjs';
import { demoState } from '../server/demo.mjs';
import { position, haversine } from '../server/geometry.mjs';

async function removeTestDirectory(dir) {
  const resolved=path.resolve(dir),parent=path.resolve('.data','tests')+path.sep;
  assert.ok(resolved.startsWith(parent) && path.basename(resolved).startsWith('polaris-vault-'));
  await rm(resolved,{recursive:true,force:true});
}

test('schedule interpolation crosses the dateline along the short great circle',()=>{
  const p=position({lat:0,lon:170},{lat:0,lon:-170},.5);
  assert.ok(Math.abs(Math.abs(p.lon)-180)<.001);assert.ok(Math.abs(p.lat)<.001);
  assert.ok(haversine({lat:0,lon:170},{lat:0,lon:-170})<2300);
});
test('unknown values remain null and duplicate IDs are rejected',()=>{
  const raw={airline:{name:'EXAMPLE AIR'},airports:[],aircraft:[{id:'a'}],flights:[],routes:[]};
  const s=validateSnapshot(raw);assert.equal(s.airline.cash,null);assert.equal(s.aircraft[0].condition,null);
  assert.throws(()=>validateSnapshot({...raw,aircraft:[{id:'a'},{id:'a'}]}),/重复/);
  assert.throws(()=>validateSnapshot({...raw,airports:[{id:'x',lat:91,lon:0}]}),/坐标/);
});
test('demo is explicit and does not mutate a stored snapshot',()=>{
  const state=demoState();assert.equal(state.connection.source,'demo');assert.equal(state.connection.status,'disconnected');
  assert.ok(state.snapshot.flights.every(f=>f.positionSource==='schedule'));
});
test('vault persists secrets encrypted and decrypts under the same user',async()=>{
  await mkdir(path.resolve('.data','tests'),{recursive:true});
  const dir=await mkdtemp(path.join(path.resolve('.data','tests'),'polaris-vault-'));
  try{const v=new Vault(dir),session={accessToken:'secret-test-access',refreshToken:'secret-test-refresh'};await v.save(session);assert.deepEqual(await v.load(),session);assert.ok(!(await readFile(v.file,'utf8')).includes('secret-test'));}finally{await removeTestDirectory(dir);}
});
test('sync coalesces requests, retains last good snapshot, backs off, and never exposes tokens',async()=>{
  const store=new Store(':memory:'),vault={load:async()=>({accessToken:'a'.repeat(50)}),save:async()=>{}},snapshot=demoState().snapshot;
  let reads=0,fail=false;
  const engine=new SyncEngine({store,vault,adapter:{read:async()=>{reads++;await new Promise(r=>setTimeout(r,10));if(fail)throw Object.assign(new Error('private-details'),{safeMessage:'服务器暂不可用'});return snapshot;}}});
  try{
    await engine.initialize();clearTimeout(engine.timer);
    await Promise.all([engine.sync(),engine.sync(),engine.sync()]);assert.equal(reads,1);assert.equal(engine.state().connection.status,'live');
    fail=true;await engine.sync();const state=engine.state();assert.equal(state.connection.status,'stale');assert.deepEqual(state.snapshot,snapshot);assert.ok(state.connection.nextSyncAt);assert.ok(!JSON.stringify(state).includes('a'.repeat(50)));assert.ok(!JSON.stringify(state).includes('private-details'));
    await engine.disconnect();assert.equal(engine.state().connection.hasCredentials,false);assert.equal(engine.state().connection.nextSyncAt,null);
  }finally{engine.close();store.close();}
});
test('disconnect during an in-flight request cannot republish live data',async()=>{
  let finish;const deferred=new Promise(r=>finish=r),store=new Store(':memory:');
  const engine=new SyncEngine({store,vault:{load:async()=>({accessToken:'a'.repeat(50)}),save:async()=>{}},adapter:{read:()=>deferred}});
  try{await engine.initialize();clearTimeout(engine.timer);const sync=engine.sync();await engine.disconnect();finish(demoState().snapshot);await sync;assert.equal(engine.state().snapshot,null);assert.equal(engine.state().connection.status,'disconnected');assert.equal(store.latest(),null);}finally{engine.close();store.close();}
});
test('SQLite recovers the last complete snapshot and hourly history',()=>{
  const store=new Store(':memory:');try{const s=demoState().snapshot;store.save(s,'game');store.save(s,'game');assert.equal(store.latest().snapshot.airline.name,s.airline.name);assert.equal(store.history().length,1);assert.equal(store.history()[0].aircraftCount,12);}finally{store.close();}
});
