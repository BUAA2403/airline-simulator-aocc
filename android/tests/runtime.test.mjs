import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createMobileRuntime,createNativeTransport} from '../web/runtime.mjs';
import {parseMobileSession,MOBILE_BOOKMARKLET,LIVERY_ORIGIN} from '../web/session.mjs';
import {demoState} from '../../server/demo.mjs';

const ACCESS='headerpayload.payloadpayload.signaturepayload',REFRESH='phone-only-refresh-token';
const sessionFile=()=>JSON.stringify({schema:'polaris-aocc-mobile-session/1',origin:LIVERY_ORIGIN,session:{access_token:ACCESS,refresh_token:REFRESH},provider_token:'must-not-be-imported'});
function phone(){
 let config={},latest=null,events=[],saved=[];
 return {saved,get config(){return config;},loadConfig(){return JSON.stringify(config);},saveConfig(text){config=JSON.parse(text);return true;},data(op,text){const input=JSON.parse(text);let value;
  if(op==='latest')value=latest;
  else if(op==='save'){latest={snapshot:input.snapshot,source:input.source};saved.push(latest);value=true;}
  else if(op==='history')value=[];
  else if(op==='analysis')value=saved.filter(x=>x.source===input.source&&x.snapshot.airline.id===input.airlineId&&x.snapshot.capturedAt<=input.capturedAt).map(x=>x.snapshot);
  else if(op==='log'){events.unshift({at:new Date().toISOString(),level:input.level,message:input.message});value=true;}
  else if(op==='logs')value=events;
  else throw new Error(op);
  return JSON.stringify({value});
 }};
}
test('phone session imports only necessary fields and rejects unrelated, missing and oversized credentials',()=>{
 assert.deepEqual(parseMobileSession(sessionFile()),{accessToken:ACCESS,refreshToken:REFRESH,intervalSeconds:60});
 for(const input of ['{}','[]','null','bad',sessionFile().replace(LIVERY_ORIGIN,'https://attacker.example'),sessionFile().replace(REFRESH,'short'),'x'.repeat(100001)])assert.throws(()=>parseMobileSession(input));
});
test('mobile authorization bookmark runs only on the exact official origin and exports only two session fields',()=>{
 const code=decodeURIComponent(MOBILE_BOOKMARKLET.slice('javascript:'.length));let reads=0,downloads=[],alerts=[];
 const context={location:{origin:'https://attacker.example'},alert:s=>alerts.push(s),localStorage:{getItem(key){reads++;assert.equal(key,'sb-auth-auth-token');return JSON.stringify({access_token:ACCESS,refresh_token:REFRESH,provider_token:'not-exported',user:{email:'not-exported'}});}},Blob:class{constructor(parts){downloads.push(JSON.parse(parts.join('')));}},URL:{createObjectURL:()=> 'blob:local',revokeObjectURL(){}},document:{body:{append(){}},createElement:()=>({click(){},remove(){}})},setTimeout(){}};
 vm.runInNewContext(code,context);assert.equal(reads,0);assert.equal(downloads.length,0);assert.equal(alerts.length,1);
 context.location.origin=LIVERY_ORIGIN;vm.runInNewContext(code,context);assert.equal(reads,1);assert.deepEqual(Object.keys(downloads[0].session).sort(),['access_token','refresh_token']);assert.equal(downloads[0].session.refresh_token,REFRESH);
});
test('standalone sync persists phone data, resumes after background and never exposes credentials in state/export',async t=>{
 const native=phone();let reads=0;
 const adapter={async read(config,saveSession){reads++;assert.equal(config.refreshToken,REFRESH);await saveSession({accessToken:ACCESS});const s=structuredClone(demoState().snapshot);s.provenance.source='game';return s;}};
 const runtime=await createMobileRuntime({native,adapter});t.after(()=>runtime.engine.close());
 const connected=await runtime.request('/api/connection',{method:'POST',body:parseMobileSession(sessionFile())});assert.equal(connected.status,200);assert.equal(native.saved.length,1);assert.equal(reads,1);
 assert.equal((await runtime.request('/api/health')).body.standalone,true);
 assert.equal((await runtime.request('/api/state')).body.connection.status,'live');
 for(const route of ['/api/state','/api/export','/api/analysis-export']){const response=await runtime.request(route);assert.equal(response.status,200);const text=JSON.stringify(response.body);assert.ok(!text.includes(ACCESS));assert.ok(!text.includes(REFRESH));}
 runtime.pause();assert.equal(runtime.engine.connection.nextSyncAt,null);assert.equal(runtime.engine.connection.status,'stale');runtime.engine.schedule(10000);assert.equal(runtime.engine.connection.nextSyncAt,null);
 runtime.resume();await runtime.engine.pending;assert.equal(reads,2);assert.equal(runtime.engine.connection.status,'live');
 await runtime.request('/api/disconnect',{method:'POST'});assert.deepEqual(native.config,{});assert.ok((await runtime.request('/api/state')).body.snapshot);assert.equal((await runtime.request('/api/session-bridge',{method:'POST',body:{}})).status,404);
 const reopened=await createMobileRuntime({native,adapter});t.after(()=>reopened.engine.close());assert.ok(reopened.engine.snapshot);assert.equal(reopened.engine.hasCredentials(),false);
});
test('network failure retains last phone snapshot and import cannot preserve previous live credentials',async t=>{
 const native=phone();let fails=false;const adapter={async read(){if(fails)throw new Error('private implementation details');return structuredClone(demoState().snapshot);}};
 const runtime=await createMobileRuntime({native,adapter});t.after(()=>runtime.engine.close());
 await runtime.request('/api/connection',{method:'POST',body:parseMobileSession(sessionFile())});fails=true;
 const failed=await runtime.request('/api/sync',{method:'POST'});assert.equal(failed.status,422);assert.equal(runtime.engine.connection.status,'stale');assert.ok(runtime.engine.snapshot);assert.ok(!JSON.stringify(runtime.engine.state()).includes('private implementation'));
 const imported=await runtime.request('/api/import',{method:'POST',body:demoState().snapshot});assert.equal(imported.status,200);assert.equal(runtime.engine.connection.source,'import');assert.deepEqual(native.config,{});assert.equal(runtime.engine.connection.nextSyncAt,null);
});
test('native transport handles cancellation, fixed error messages and successful HTTP responses',async()=>{
 const host={};let pendingId;const native={request(id){pendingId=id;}};const transport=createNativeTransport(native,host);
 const request=transport.fetch('https://auth.airline-simulator.com/auth/v1/user');host.__polarisReply(pendingId,{status:200,headers:{'retry-after':'60'},body:'{"id":"phone-account"}'});assert.deepEqual(await (await request).json(),{id:'phone-account'});
 const abort=new AbortController(),cancelled=transport.fetch('https://example.invalid',{signal:abort.signal});abort.abort();await assert.rejects(cancelled,/超时/);host.__polarisReply(pendingId,{error:true});
 const failure=transport.fetch('https://example.invalid');host.__polarisReply(pendingId,{error:'secret-details'});await assert.rejects(failure,error=>!error.message.includes('secret-details'));
});
