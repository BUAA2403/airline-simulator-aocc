import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Store } from './store.mjs';
import { Vault } from './vault.mjs';
import { GameAdapter } from './adapter.mjs';
import { SyncEngine } from './sync.mjs';
import { validateSnapshot } from './normalize.mjs';
import { normalizeGame } from './game-normalize.mjs';
import { demoState } from './demo.mjs';
import {createAnalysisExport} from './analysis-export.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mimes={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.json':'application/json; charset=utf-8','.md':'text/plain; charset=utf-8','.woff2':'font/woff2'};
export async function createAoccServer({directory=path.join(root,'.data'),adapter=new GameAdapter(),port=Number(process.env.PORT)||3010,store=new Store(directory),vault=new Vault(directory)}={}) {
  const clients=new Set();
  let pairing=null, closed=false;
  const engine=new SyncEngine({store,vault,adapter,onChange:state=>{ const data=`event: state\ndata: ${JSON.stringify(state)}\n\n`; for(const res of clients)res.write(data); }});
  await engine.initialize();
  const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  const body=async req=>{
    if(!req.headers['content-type']?.startsWith('application/json'))throw Object.assign(new Error('请求必须使用 application/json'),{httpStatus:415});
    let size=0;const chunks=[];
    for await(const chunk of req){size+=chunk.length;if(size>25*1024*1024)throw Object.assign(new Error('上传超过 25 MB 上限'),{httpStatus:413});chunks.push(chunk);}
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('请求内容不是有效 JSON');}
  };
  const server=http.createServer(async(req,res)=>{
    try {
      const activePort=server.address()?.port ?? port;
      const host=req.headers.host || '', validHosts=new Set([`127.0.0.1:${activePort}`,`localhost:${activePort}`]);
      if(!validHosts.has(host))return json(res,403,{ok:false,error:'仅允许通过本机地址访问'});
      const url=new URL(req.url,`http://${host}`), origin=req.headers.origin;
      const sameOrigin=!origin || origin===`http://${host}`;
      const bridge=url.pathname==='/api/session-bridge';
      const extensionOrigin=/^chrome-extension:\/\/[a-z]{32}$/.test(origin||'');
      if(bridge && !sameOrigin && !extensionOrigin)return json(res,403,{ok:false,error:'配对接口仅接受本机页面或浏览器扩展'});
      if(req.method==='OPTIONS' && bridge && extensionOrigin){
        res.writeHead(204,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin'});return res.end();
      }
      if(bridge && extensionOrigin)res.setHeader('Access-Control-Allow-Origin',origin);
      if(!sameOrigin && !bridge)return json(res,403,{ok:false,error:'不允许跨站访问本机 AOCC'});
      if(url.pathname.startsWith('/api/')){
        if(req.method==='GET'){
          if(url.pathname==='/api/health')return json(res,200,{ok:true,version:'1.0.0',readonly:true});
          if(url.pathname==='/api/state')return json(res,200,engine.state());
          if(url.pathname==='/api/demo')return json(res,200,demoState());
          if(url.pathname==='/api/export'){res.setHeader('Content-Disposition',`attachment; filename="aocc-${new Date().toISOString().slice(0,10)}.json"`);return json(res,200,engine.state());}
          if(url.pathname==='/api/analysis-export'){
            const snapshot=engine.snapshot,connection={...engine.connection};
            const historySnapshots=snapshot&&store.analysisSnapshots?store.analysisSnapshots(snapshot.airline.id,connection.source,snapshot.capturedAt):[];
            const report=await createAnalysisExport({snapshot,connection,historySnapshots});
            res.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="${report.filename}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
            return res.end(report.content);
          }
          if(url.pathname==='/api/bridge-code'){
            pairing={code:randomBytes(24).toString('base64url'),expires:Date.now()+600000};
            return json(res,200,{pairingCode:pairing.code,expiresAt:new Date(pairing.expires).toISOString()});
          }
          if(url.pathname==='/api/events'){
            res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
            res.write(`event: state\ndata: ${JSON.stringify(engine.state())}\n\n`);clients.add(res);
            const keepAlive=setInterval(()=>res.write(': heartbeat\n\n'),25000);
            req.on('close',()=>{clients.delete(res);clearInterval(keepAlive);});return;
          }
        }
        if(req.method==='POST'){
          if(url.pathname==='/api/session-bridge'){
            const input=await body(req),code=typeof input.pairingCode==='string'?input.pairingCode:'';
            if(!pairing || pairing.expires<Date.now() || code.length!==pairing.code.length || !timingSafeEqual(Buffer.from(code),Buffer.from(pairing.code)))return json(res,403,{ok:false,error:'配对码无效或已过期，请在 AOCC 生成新配对码'});
            pairing=null;
            if(!input.session || typeof input.session.access_token!=='string')throw new Error('未提供有效游戏会话');
            const result=await engine.connect({accessToken:input.session.access_token,refreshToken:input.session.refresh_token});
            return json(res,result.ok?200:422,result);
          }
          if(!sameOrigin)return json(res,403,{ok:false,error:'不允许跨站修改配置'});
          if(url.pathname==='/api/connection'){const result=await engine.connect(await body(req));return json(res,result.ok?200:422,result);}
          if(url.pathname==='/api/sync')return json(res,200,await engine.sync());
          if(url.pathname==='/api/disconnect'){await engine.disconnect();return json(res,200,{ok:true});}
          if(url.pathname==='/api/import'){
            const input=await body(req);let snapshot;
            try {snapshot=validateSnapshot(input?.player?normalizeGame(input):input,'import');}catch(e){throw Object.assign(e,{safeMessage:e.message});}
            await engine.import(snapshot);return json(res,200,{ok:true,connection:engine.state().connection});
          }
        }
        return json(res,404,{ok:false,error:'接口不存在'});
      }
      if(req.method!=='GET' && req.method!=='HEAD')return json(res,405,{ok:false,error:'请求方法不支持'});
      let relative=decodeURIComponent(url.pathname),base=path.join(root,'dist');
      if(relative.startsWith('/docs/')){base=path.join(root,'docs');relative=relative.slice('/docs'.length);}
      let file=path.resolve(base,`.${relative}`);
      if(file!==base && !file.startsWith(`${base}${path.sep}`))return json(res,403,{ok:false,error:'无效路径'});
      try {if((await stat(file)).isDirectory())file=path.join(file,'index.html');await stat(file);}catch{file=path.join(base,'index.html');}
      let content;
      try{content=await readFile(file);}catch{return json(res,503,{ok:false,error:'网页尚未构建，请先运行 npm run build'});}
      res.writeHead(200,{'Content-Type':mimes[path.extname(file)] || 'application/octet-stream','Cache-Control':file.includes(`${path.sep}assets${path.sep}`)?'public,max-age=31536000,immutable':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'"});
      res.end(req.method==='HEAD'?undefined:content);
    } catch(error) {if(!res.headersSent)json(res,error.httpStatus||400,{ok:false,error:error.safeMessage || (error.message?.startsWith('游戏')?error.message:'请求失败：请检查输入内容或本机文件访问权限')});else res.end();}
  });
  return {server,engine,store,listen:()=>new Promise(resolve=>server.listen(port,'127.0.0.1',()=>resolve(server.address()))),close:async()=>{if(closed)return;closed=true;engine.close();for(const res of clients)res.end();await new Promise(resolve=>server.close(resolve));store.close();}};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=await createAoccServer();await app.listen();
  console.log(`Airline Simulator · AOCC\nLocal: http://127.0.0.1:${Number(process.env.PORT)||3010}\n只读游戏连接 · 本机加密会话 · SQLite 历史记录`);
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.close().then(()=>process.exit(0)));
}
