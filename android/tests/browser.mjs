import http from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {chromium} from '../toolchain/browser/node_modules/playwright-core/index.mjs';
import {demoState} from '../../server/demo.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),out=path.join(root,'exports/android');
await mkdir(out,{recursive:true});
const server=http.createServer(async(req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=path.resolve(root,'android/web-dist','.'+(name==='/'?'/index.html':name));if(!file.startsWith(path.join(root,'android/web-dist')+path.sep))throw new Error('path');const data=await readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'})[path.extname(file)]||'text/plain');res.end(data);}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const errors=[],saved=[];
try{
 const context=await browser.newContext({viewport:{width:393,height:852},deviceScaleFactor:1,isMobile:true,hasTouch:true});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await context.exposeBinding('__saveNative',(_,input)=>{saved.push(input);return {saved:true};});
 await page.addInitScript(()=>{
  const read=(key,fallback)=>JSON.parse(localStorage.getItem('test-'+key)||JSON.stringify(fallback)),save=(key,value)=>localStorage.setItem('test-'+key,JSON.stringify(value));
  const token='eyJhbGciOiJIUzI1NiJ9.'+btoa(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).replaceAll('=','')+'.fake-signature-phone';
  window.PolarisNative={
   loadConfig:()=>JSON.stringify(read('config',{})),saveConfig:text=>{save('config',JSON.parse(text));return true;},
   data(op,raw){const input=JSON.parse(raw);let value=null,rows=read('snapshots',[]),events=read('events',[]);
    if(op==='latest')value=rows.at(-1)||null;
    else if(op==='save'){rows.push(input);save('snapshots',rows);value=true;}
    else if(op==='log'){events.unshift({at:new Date().toISOString(),...input});save('events',events);value=true;}
    else if(op==='logs')value=events;
    else if(op==='history')value=rows.filter(r=>r.snapshot.airline.id===input.airlineId&&r.source===input.source).map(r=>({capturedAt:r.snapshot.capturedAt,cash:r.snapshot.airline.cash,aircraftCount:r.snapshot.aircraft.length,flightCount:r.snapshot.flights.length,routeCount:r.snapshot.routes.length}));
    else if(op==='analysis')value=rows.filter(r=>r.snapshot.airline.id===input.airlineId&&r.source===input.source&&r.snapshot.capturedAt<=input.capturedAt).map(r=>r.snapshot);
    return JSON.stringify({value});
   },
   request(id,raw){const input=JSON.parse(raw),url=new URL(input.url);let body=[];
    if(url.pathname==='/auth/v1/user')body={id:'phone-account'};
    else if(url.pathname.endsWith('get_master_player_by_master_uid'))body=[{masterUid:'phone-account',playerUidList:['phone-airline']}];
    else if(url.pathname.endsWith('get_player_by_uid'))body=[{uid:'phone-airline',airlineName:'EXAMPLE AIR',airlineCode:'PA',hubAirports:['HKG']}];
    else if(url.pathname.endsWith('get_server_time'))body=new Date().toISOString();
    queueMicrotask(()=>window.__polarisReply(id,{status:200,headers:{},body:JSON.stringify(body)}));
   },
   chooseSession(id){queueMicrotask(()=>window.__polarisReply(id,{text:JSON.stringify({schema:'polaris-aocc-mobile-session/1',origin:'https://livery.airline-simulator.com',session:{access_token:token,refresh_token:'independent-phone-refresh-token'}})}));},
   saveFile(id,raw){window.__saveNative(JSON.parse(raw)).then(value=>window.__polarisReply(id,value));},
   sha256(text){let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);return (h>>>0).toString(16).padStart(8,'0').repeat(8);},
   copyText(text){window.__copiedTool=text;},showMessage(text){window.__lastMessage=text;},printDocument(){window.__printed=true;}
  };
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.getByRole('heading',{name:'调度工作台',exact:true}).waitFor();
 await page.getByRole('button',{name:'数据连接',exact:true}).click();
 await page.getByRole('heading',{name:'手机独立连接',exact:true}).waitFor();
 await page.getByRole('button',{name:'复制手机授权工具',exact:true}).click();assert.ok(await page.evaluate(()=>window.__copiedTool.startsWith('javascript:')));
 await page.getByRole('button',{name:'选择手机授权文件',exact:true}).click();
 await page.waitForFunction(async()=>{const s=await fetch('/api/state').then(r=>r.json());return s.connection.status==='live';});
 const phoneState=await page.evaluate(()=>fetch('/api/state').then(r=>r.json()));assert.equal(phoneState.connection.airlineId,'phone-airline');assert.ok(!JSON.stringify(phoneState).includes('independent-phone-refresh-token'));
 const snapshot=structuredClone(demoState().snapshot);await page.evaluate(async snapshot=>{const response=await fetch('/api/import',{method:'POST',body:JSON.stringify(snapshot)});if(!response.ok)throw new Error('import failed');},snapshot);
 await page.getByRole('button',{name:'打开导航',exact:true}).click();await page.getByRole('button',{name:'运行控制 OPERATIONS CONTROL',exact:true}).click();
 await page.screenshot({path:path.join(out,'手机运行预览.png'),fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page must not overflow phone width');
 const exported=await page.evaluate(()=>fetch('/api/analysis-export').then(r=>r.text()));assert.ok(exported.includes('完整结构化数据'));assert.ok(!exported.includes('independent-phone-refresh-token'));
 await page.getByRole('button',{name:'导出 AI 分析包',exact:true}).click();
 await page.waitForTimeout(1000);assert.ok(saved.some(x=>x.name.endsWith('.md')),'detached-anchor AI export must reach native save: '+JSON.stringify({saved:saved.map(x=>x.name),errors,state:await page.evaluate(()=>({message:window.__lastMessage,text:document.querySelector('.toast')?.textContent,click:HTMLAnchorElement.prototype.click.toString()}))}));
 await page.getByRole('button',{name:'打开导航',exact:true}).click();await page.getByRole('button',{name:'航线与班表 NETWORK & SCHEDULE',exact:true}).click();
 await page.getByRole('button',{name:'每周航班计划',exact:true}).click();await page.getByRole('button',{name:'下载时刻表',exact:true}).click();await page.waitForTimeout(300);assert.ok(saved.some(x=>x.name.endsWith('.html')));
 await page.getByRole('button',{name:'CSV',exact:true}).click();await page.waitForTimeout(300);assert.ok(saved.some(x=>x.name.endsWith('.csv')));
 await page.getByRole('button',{name:'打印 / PDF',exact:true}).click();assert.equal(await page.evaluate(()=>window.__printed),true);
 await page.reload();await page.getByRole('heading',{name:'调度工作台',exact:true}).waitFor();assert.equal((await page.evaluate(()=>fetch('/api/state').then(r=>r.json()))).connection.source,'import');
 await page.getByRole('button',{name:'数据连接',exact:true}).click();await page.getByRole('heading',{name:'手机独立连接',exact:true}).waitFor();await page.screenshot({path:path.join(out,'手机连接预览.png'),fullPage:true});
 assert.deepEqual(errors,[]);
 const report={viewport:'393 × 852',checks:['phone session import through native transport','direct GameAdapter connection with simulated game server','independent cache recovered after reload','source-scoped analysis export without credentials','native Markdown/HTML/CSV saves from detached links','native print action','no horizontal page overflow','no browser script errors'],saved:saved.map(x=>({name:x.name,mime:x.mime,bytes:Buffer.from(x.base64,'base64').length})),errors};
 await writeFile(path.join(out,'browser-validation.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
