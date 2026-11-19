import {gameClock} from './game-time.mjs';
import { normalizeGame } from './game-normalize.mjs';
import {readCodeshares,normalizeCodeshares} from './codeshares.mjs';

// Public client configuration recovered from the supplied APK and official WLE.
// This publishable key is NOT a privileged service key. All data requests retain RLS.
export const GAME = Object.freeze({
  auth:'https://auth.airline-simulator.com',
  primary:'https://urmwaqnhesasfaeprcga-all.supabase.co',
  fallback:'https://urmwaqnhesasfaeprcga.supabase.co',
  publishableKey:'sb_publishable_zGtQpUELNKHPluSkfQ9FOw__BXFJVlf',
});
export class GameError extends Error {
  constructor(safeMessage, options={}) { super(safeMessage); this.safeMessage=safeMessage; Object.assign(this,options); }
}
export class GameAdapter {
  constructor({fetchImpl=fetch}={}) { this.fetch=fetchImpl; }
  async request(url, token, {method='GET',body,auth=false}={}) {
    const response=await this.fetch(url,{method,headers:{apikey:GAME.publishableKey,...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000),redirect:'error'}).catch(()=>{throw new GameError('游戏服务器连接失败，将自动重试');});
    if(response.status===401 || response.status===403) throw new GameError(auth?'游戏登录会话已失效，请重新配对':'当前账户无权读取此航空公司数据，请核对账户与航空公司 ID',{reconnect:true,status:response.status});
    if(response.status===429) {const retry=Number(response.headers.get('retry-after')); throw new GameError('游戏服务器限流，已降低请求频率',{retryAfterMs:Number.isFinite(retry)?Math.max(60000,Math.min(3600000,retry*1000)):120000,status:429});}
    if(!response.ok) throw new GameError(response.status>=500?'游戏服务器暂时不可用，将自动重试':`游戏接口返回 ${response.status}；数据结构或读取许可可能已变化`,{status:response.status,reconnect:response.status<500});
    const text=await response.text();
    if(text.length>50*1024*1024) throw new GameError('游戏接口响应过大，已停止此次同步');
    try{return JSON.parse(text);}catch{throw new GameError('游戏接口返回无效 JSON，保留上次成功数据');}
  }
  async read(config, saveSession) {
    let token=config.accessToken;
    const expired=()=>{try{return JSON.parse(Buffer.from((token||'').split('.')[1],'base64url').toString()).exp*1000 < Date.now()+90000;}catch{return true;}};
    const refresh=async()=>{
      if(!config.refreshToken) throw new GameError('访问令牌已过期，请重新配对（自动续期需要刷新令牌）',{reconnect:true});
      const session=await this.request(`${GAME.auth}/auth/v1/token?grant_type=refresh_token`,null,{method:'POST',body:{refresh_token:config.refreshToken},auth:true});
      if(!session.access_token || !session.refresh_token) throw new GameError('游戏未返回可续期的会话，请重新配对',{reconnect:true});
      token=session.access_token; config.refreshToken=session.refresh_token;
      await saveSession({accessToken:token,refreshToken:session.refresh_token});
    };
    if(expired()) await refresh();
    let user;
    try {user=await this.request(`${GAME.auth}/auth/v1/user`,token,{auth:true});}
    catch(e) {if(e.status===401 && config.refreshToken){await refresh();user=await this.request(`${GAME.auth}/auth/v1/user`,token,{auth:true});}else throw e;}
    if(!user?.id || !/^[a-zA-Z0-9_-]{1,100}$/.test(user.id)) throw new GameError('无法确认游戏账户身份，请重新配对',{reconnect:true});
    let host=GAME.primary;
    const read=async resource=>{
      const requestHost=host;
      try{return await this.request(`${requestHost}/rest/v1/${resource}`,token);}
      catch(e){if(requestHost===GAME.primary && !e.reconnect && e.status!==429){host=GAME.fallback;return this.request(`${GAME.fallback}/rest/v1/${resource}`,token);}throw e;}
    };
    // Both RPCs and arguments are present in the native client. GET only.
    // Airline/subsidiary UID differs from the Google/Supabase account UUID.
    const masterResult=await read(`rpc/get_master_player_by_master_uid?${new URLSearchParams({p_master_uid:user.id})}`);
    const master=Array.isArray(masterResult)?masterResult[0]:masterResult;
    if(master && String(master.masterUid)!==user.id)throw new GameError('游戏返回的主账户与登录身份不一致，已停止读取',{reconnect:true});
    const uids=Array.isArray(master?.playerUidList)?master.playerUidList.map(String):[];
    if(!uids.length)throw new GameError('当前 Google 账户没有可读取的航空公司，请确认与游戏使用相同账户',{reconnect:true});
    if(config.airlineId && !uids.includes(config.airlineId))throw new GameError('此航空公司 ID 不在当前账户的子公司列表中，已停止读取',{reconnect:true});
    const fetchPlayer=async uid=>{const result=await read(`rpc/get_player_by_uid?${new URLSearchParams({p_uid:uid})}`);return Array.isArray(result)?result[0]:result;};
    if(!config.airlineId && uids.length>1)throw new GameError('此账户有多个航空公司，请在「高级手动接入」填写要同步的航空公司 ID',{reconnect:true});
    const player=await fetchPlayer(config.airlineId || uids[0]);
    if(!player?.uid || !uids.includes(String(player.uid)))throw new GameError('无法确认航空公司身份，请重新连接',{reconnect:true});
    if(config.airlineId && String(player.uid)!==config.airlineId)throw new GameError('游戏返回的航空公司与所选 ID 不一致，已停止同步',{reconnect:true});
    const tables={aircraft:['player_aircraft_data','aircraftId'],flights:['new_player_flight_data','flightId'],routes:['player_route_data','routeId']};
    const paged=async(table,order)=>{
      const rows=[];
      for(let offset=0;offset<50000;offset+=1000){
        const query=new URLSearchParams({select:'*',uid:`eq.${player.uid}`,order:`${order}.asc`,limit:'1000',offset:String(offset)});
        const page=await read(`${table}?${query}`);
        if(!Array.isArray(page)) throw new GameError('游戏数据结构发生变化，已保留上次成功快照');
        rows.push(...page); if(page.length<1000)return rows;
      }
      throw new GameError('数据超出单次同步上限，已保留完整的旧快照');
    };
    const names=Object.keys(tables), results=await Promise.allSettled(names.map(n=>paged(...tables[n])));
    const failed=results.find(r=>r.status==='rejected'); if(failed) throw failed.reason;
    const raw=Object.fromEntries(results.map((r,i)=>[names[i],r.value]));
    let codeshares;
    try{codeshares=await readCodeshares(read,player,raw);}catch(e){if(e.status===429)throw e;codeshares={status:'unavailable'};}
    const before=Date.now();let offset=0;
    try{const clock=await read('rpc/get_server_time');const t=Date.parse(typeof clock==='string'?clock:clock?.server_time);if(Number.isFinite(t))offset=t-(before+Date.now())/2;}catch{/* Data remains readable if clock RPC is temporarily unavailable. */}
    const realNow=new Date(Date.now()+offset);
    const timing={mode:'accelerated',potions:[],potionState:'unavailable'};
    try{
      const query=new URLSearchParams({select:'potionStartTime,potionEndTime',uid:`eq.${player.uid}`,potionEndTime:`gte.${realNow.toISOString()}`,limit:'1000'});
      const potions=await read(`potion_usage?${query}`);
      if(Array.isArray(potions)){timing.potions=potions.map(p=>({start:p.potionStartTime,end:p.potionEndTime}));timing.potionState='known';}
    }catch{/* Retain verified schedules; show an explicit clock qualification. */}
    const snapshot=normalizeGame({master,player,...raw},realNow,{operationalTime:gameClock(realNow,timing).date,fullCycle:true,timing});
    snapshot.codeshares=normalizeCodeshares(codeshares,player,raw,realNow,{operationalTime:gameClock(realNow,timing).date,fullCycle:true,timing});
    snapshot.metrics.serverClockOffsetMs=offset;
    return snapshot;
  }
}
