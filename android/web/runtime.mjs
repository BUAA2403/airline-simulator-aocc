import {GameAdapter} from '../../server/adapter.mjs';
import {SyncEngine} from '../../server/sync.mjs';
import {normalizeGame} from '../../server/game-normalize.mjs';
import {validateSnapshot} from '../../server/normalize.mjs';
import {demoState} from '../../server/demo.mjs';
import {createAnalysisExport} from '../../server/analysis-export.mjs';

export class MobileStore{
 constructor(native){this.native=native;}
 call(op,value={}){const result=JSON.parse(this.native.data(op,JSON.stringify(value)));if(result.error)throw new Error('手机存储不可用');return result.value;}
 latest(){return this.call('latest');}
 save(snapshot,source){this.call('save',{snapshot,source});}
 history(airlineId,source){return this.call('history',{airlineId,source});}
 analysisSnapshots(airlineId,source,capturedAt){return this.call('analysis',{airlineId,source,capturedAt});}
 log(level,message){this.call('log',{level,message});}
 logs(){return this.call('logs');}
}
export function createNativeTransport(native,host=globalThis){
 const pending=new Map();let serial=0;
 host.__polarisReply=(id,result)=>{const task=pending.get(id);if(!task)return;pending.delete(id);task.cleanup();if(result.error)task.reject(new Error('手机操作未完成'));else task.resolve(result);};
 const call=(method,input={},signal)=>new Promise((resolve,reject)=>{
  const id=String(++serial),abort=()=>{pending.delete(id);signal?.removeEventListener('abort',abort);reject(new Error('手机请求超时'));};
  if(signal?.aborted)return abort();
  const cleanup=()=>signal?.removeEventListener('abort',abort);
  pending.set(id,{resolve,reject,cleanup});signal?.addEventListener('abort',abort,{once:true});
  try{native[method](id,JSON.stringify(input));}catch{pending.delete(id);cleanup();reject(new Error('手机功能不可用'));}
 });
 return {call,fetch:async(url,options={})=>{
  const result=await call('request',{url,method:options.method||'GET',headers:options.headers||{},body:options.body},options.signal);
  return new Response(result.body,{status:result.status,headers:result.headers});
 }};
}
export async function createMobileRuntime({native,adapter,onChange=()=>{}}){
 const store=new MobileStore(native),vault={load:async()=>JSON.parse(native.loadConfig()),save:async config=>{if(!native.saveConfig(JSON.stringify(config)))throw new Error('手机会话加密保存失败');}};
 const engine=new SyncEngine({store,vault,adapter,onChange});
 let paused=false;const schedule=engine.schedule.bind(engine);
 engine.schedule=delay=>{if(!paused)schedule(delay);else engine.connection.nextSyncAt=null;};
 await engine.initialize();
 return {engine,store,
  pause(){paused=true;clearTimeout(engine.timer);engine.connection.nextSyncAt=null;if(engine.hasCredentials()){engine.connection.status='stale';engine.connection.message='后台同步已暂停；返回应用后自动更新';}engine.emit();},
  resume(){if(!paused)return;paused=false;if(engine.hasCredentials())engine.sync().catch(()=>{});},
  async request(path,{method='GET',body}={}){
   try{
    if(method==='GET'){
     if(path==='/api/state'||path==='/api/export')return {status:200,body:engine.state()};
     if(path==='/api/demo')return {status:200,body:demoState()};
     if(path==='/api/health')return {status:200,body:{ok:true,readonly:true,platform:'android',standalone:true}};
     if(path==='/api/analysis-export'){
      const snapshot=engine.snapshot,connection={...engine.connection};
      const historySnapshots=snapshot?store.analysisSnapshots(snapshot.airline.id,connection.source,snapshot.capturedAt):[];
      const report=await createAnalysisExport({snapshot,connection,historySnapshots});
      return {status:200,body:report.content,mime:'text/markdown; charset=utf-8',filename:report.filename};
     }
    }
    if(method==='POST'){
     if(path==='/api/connection'){const result=await engine.connect(body);return {status:result.ok?200:422,body:result};}
     if(path==='/api/sync'){const result=await engine.sync();return {status:result.ok?200:422,body:result};}
     if(path==='/api/disconnect'){await engine.disconnect();return {status:200,body:{ok:true}};}
     if(path==='/api/import'){const snapshot=validateSnapshot(body?.player?normalizeGame(body):body,'import');await engine.import(snapshot);return {status:200,body:{ok:true}};}
    }
    return {status:404,body:{ok:false,error:'手机端不支持此接口'}};
   }catch(error){return {status:400,body:{ok:false,error:error.safeMessage||'操作未完成，请检查所选文件和手机存储权限'}};}
  }
 };
}
export async function installMobileRuntime(){
 const native=window.PolarisNative,transport=createNativeTransport(native,window),listeners=new Set();
 const runtime=await createMobileRuntime({native,adapter:new GameAdapter({fetchImpl:transport.fetch}),onChange:state=>{for(const listener of listeners)listener(state);}});
 const originalFetch=window.fetch.bind(window);
 window.fetch=async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href);
  if(url.origin!==location.origin||!url.pathname.startsWith('/api/'))return originalFetch(input,options);
  const result=await runtime.request(url.pathname,{method:options.method||'GET',body:options.body?JSON.parse(options.body):undefined});
  return new Response(typeof result.body==='string'?result.body:JSON.stringify(result.body),{status:result.status,headers:{'Content-Type':result.mime||'application/json',...(result.filename?{'Content-Disposition':`attachment; filename="${result.filename}"`}:{})}});
 };
 window.EventSource=class{
  static CONNECTING=0;static OPEN=1;static CLOSED=2;
  constructor(url){if(url!=='/api/events')throw new Error('不支持的事件源');this.readyState=0;this.events=new Map();this.accept=state=>{if(this.readyState===2)return;this.readyState=1;for(const fn of this.events.get('state')||[])fn({data:JSON.stringify(state)});};listeners.add(this.accept);queueMicrotask(()=>{if(this.readyState===2)return;this.readyState=1;this.onopen?.();this.accept(runtime.engine.state());});}
  addEventListener(type,listener){if(!this.events.has(type))this.events.set(type,new Set());this.events.get(type).add(listener);}
  removeEventListener(type,listener){this.events.get(type)?.delete(listener);}
  close(){this.readyState=2;listeners.delete(this.accept);}
 };
 const saveBlob=async(blob,name)=>{
  const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
  await transport.call('saveFile',{name,mime:blob.type||'application/octet-stream',base64:btoa(binary)});
 };
 window.polarisMobile={chooseSession:async()=>(await transport.call('chooseSession')).text,saveBlob};
 const saveAnchor=anchor=>{
  const url=new URL(anchor.href,location.href);
  if(url.protocol==='blob:'||(url.origin===location.origin&&url.pathname==='/api/export')){
   window.fetch(url.href).then(r=>r.blob()).then(blob=>saveBlob(blob,anchor.download||'aocc-export.json')).catch(()=>native.showMessage('文件未保存，请重新导出'));return true;
  }
  return false;
 };
 // Programmatic downloads use detached anchors, which never bubble to document.
 const originalAnchorClick=HTMLAnchorElement.prototype.click;
 HTMLAnchorElement.prototype.click=function(){if(!saveAnchor(this))originalAnchorClick.call(this);};
 document.addEventListener('click',event=>{
  const anchor=event.target.closest?.('a');if(!anchor)return;
  if(new URL(anchor.href,location.href).pathname==='/docs/connection-guide.md'){event.preventDefault();event.stopPropagation();native.showGuide();return;}
  if(saveAnchor(anchor)){event.preventDefault();event.stopPropagation();}
 },true);
 window.print=()=>native.printDocument();
 // Timetable HTML opens a blob URL in the desktop app; save it on Android.
 const originalOpen=window.open.bind(window);
 window.open=(url,...args)=>{if(typeof url==='string'&&url.startsWith('blob:')){window.fetch(url).then(r=>r.blob()).then(b=>saveBlob(b,'aocc-timetable.html')).catch(()=>native.showMessage('班表未保存'));return null;}return originalOpen(url,...args);};
 window.__aoccPause=()=>runtime.pause();window.__aoccResume=()=>runtime.resume();
 document.addEventListener('visibilitychange',()=>document.hidden?runtime.pause():runtime.resume());
 window.addEventListener('online',()=>{if(!document.hidden&&runtime.engine.hasCredentials())runtime.engine.sync().catch(()=>{});});
 window.addEventListener('pagehide',()=>runtime.engine.close());
 return runtime;
}
