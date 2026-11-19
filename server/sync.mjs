import {auditReferences} from './reference-audit.mjs';
export class SyncEngine {
  constructor({store, vault, adapter, onChange = () => {}, clock = () => new Date()}) {
    this.store=store; this.vault=vault; this.adapter=adapter; this.onChange=onChange; this.clock=clock;
    this.config={}; this.failures=0; this.pending=null; this.timer=null; this.generation=0; this.closed=false;
    this.referenceWarnings='';
    this.connection={status:'disconnected',source:null,lastAttemptAt:null,lastSuccessAt:null,nextSyncAt:null,intervalSeconds:60,message:'尚未连接游戏账户',airlineId:null,hasCredentials:false};
    const latest=store.latest(); this.snapshot=latest?.snapshot ?? null;
    if(latest) Object.assign(this.connection,{source:latest.source,status:'stale',lastSuccessAt:latest.snapshot.capturedAt,message:latest.source==='import'?'已载入导入快照；此来源不会自动更新':'显示上次成功同步的缓存，等待重新连接'});
  }
  async initialize() {
    try{this.config=await this.vault.load();if(!this.config || typeof this.config!=='object')this.config={};}
    catch{this.config={};this.connection.message='无法解密本机会话，请重新配对';this.log('warn','无法解密本机会话，请重新配对');}
    this.applyConfig();
    if(this.hasCredentials()) this.schedule(300);
  }
  hasCredentials() { return !!(this.config.accessToken || this.config.refreshToken); }
  applyConfig() { Object.assign(this.connection,{hasCredentials:this.hasCredentials(),airlineId:this.config.airlineId || null,intervalSeconds:Math.max(60,Math.min(3600,Number(this.config.intervalSeconds)||60))}); }
  state() { return {serverNow:this.clock().toISOString(),connection:{...this.connection},snapshot:this.snapshot,history:this.snapshot?this.store.history(this.snapshot.airline.id,this.connection.source):[],logs:this.store.logs()}; }
  emit() { if(!this.closed)this.onChange(this.state()); }
  log(level,message) { this.store.log(level,message); }
  schedule(delay) {
    if(this.closed)return;
    clearTimeout(this.timer);
    this.connection.nextSyncAt=new Date(+this.clock()+delay).toISOString();
    this.timer=setTimeout(()=>this.sync().catch(()=>{}),delay); this.timer.unref?.();
  }
  async connect(input) {
    if(!input || typeof input!=='object') throw new Error('连接配置无效');
    const accessToken=input.accessToken?.trim(), refreshToken=input.refreshToken?.trim();
    if(!accessToken && !refreshToken && !this.hasCredentials()) throw new Error('请通过本机配对工具连接，或提供有效的游戏会话');
    if(accessToken && (accessToken.length<30 || accessToken.length>16000)) throw new Error('访问令牌格式无效');
    if(refreshToken && (refreshToken.length<10 || refreshToken.length>16000)) throw new Error('刷新令牌格式无效');
    if(input.airlineId && !/^[a-zA-Z0-9_-]{1,100}$/.test(input.airlineId.trim())) throw new Error('航空公司 ID 格式无效');
    const generation=++this.generation;
    // A newly paired account must never inherit another account's refresh token or airline.
    const replacing=!!(accessToken || refreshToken),previous=replacing?{}:this.config;
    this.config={...previous,...(accessToken?{accessToken}:{}),...(refreshToken?{refreshToken}:{}),...(input.airlineId?.trim()?{airlineId:input.airlineId.trim()}:{}),intervalSeconds:Math.max(60,Math.min(3600,Number(input.intervalSeconds)||60))};
    await this.vault.save(this.config); if(generation!==this.generation || this.closed)return {ok:false,connection:{...this.connection}}; this.applyConfig(); this.failures=0;
    this.log('info','已在本机加密保存授权会话，开始验证只读连接');
    this.connection.message='正在验证游戏会话'; this.emit();
    // Serialize with any old in-flight request, then start using the new session.
    if(this.pending) await this.pending.catch(()=>{});
    if(generation!==this.generation || this.closed)return {ok:false,connection:{...this.connection}};
    return this.sync();
  }
  async sync() {
    if(this.closed)return {ok:false,connection:{...this.connection}};
    if(this.pending) return this.pending;
    if(!this.hasCredentials()) { this.connection.nextSyncAt=null; this.emit(); return {ok:false,connection:{...this.connection}}; }
    const generation=this.generation;
    this.connection.lastAttemptAt=this.clock().toISOString(); this.connection.status='connecting'; this.connection.message='正在读取游戏数据'; this.emit();
    this.pending=(async()=>{
      try {
        const result=await this.adapter.read({...this.config},async updates=>{
          if(generation!==this.generation) return;
          this.config={...this.config,...updates}; await this.vault.save(this.config); this.applyConfig();
        });
        if(generation!==this.generation) return {ok:false,connection:{...this.connection}};
        this.store.save(result,'game'); this.snapshot=result; this.failures=0;
        this.config.airlineId=result.airline.id; await this.vault.save(this.config);
        if(generation!==this.generation || this.closed)return {ok:false,connection:{...this.connection}};
        this.applyConfig();
        Object.assign(this.connection,{status:'live',source:'game',lastSuccessAt:this.clock().toISOString(),message:'游戏只读连接正常，自动同步已启用'});
        this.log('info',`已同步 ${result.aircraft.length} 架飞机、${result.flights.length} 个航班、${result.routes.length} 条航线`);
        const warnings=auditReferences(result),signature=JSON.stringify(warnings);
        if(signature!==this.referenceWarnings){for(const message of warnings)this.log('warn',message);this.referenceWarnings=signature;}
        this.schedule(this.connection.intervalSeconds*1000);
        return {ok:true,connection:{...this.connection}};
      } catch(error) {
        if(generation!==this.generation) return {ok:false,connection:{...this.connection}};
        this.failures++;
        const message=error.safeMessage || '游戏数据暂时不可用；稍后自动重试';
        Object.assign(this.connection,{status:this.snapshot?'stale':'error',message});
        this.log('warn',message);
        if(error.reconnect) { this.connection.nextSyncAt=null; clearTimeout(this.timer); }
        else this.schedule(Math.max(error.retryAfterMs || 0,Math.min(900000,this.connection.intervalSeconds*1000*2**Math.min(this.failures-1,4))));
        return {ok:false,connection:{...this.connection}};
      } finally { this.pending=null; this.emit(); }
    })();
    return this.pending;
  }
  async disconnect() {
    const generation=++this.generation; clearTimeout(this.timer); this.config={}; await this.vault.save({});
    if(generation!==this.generation || this.closed)return;
    Object.assign(this.connection,{status:this.snapshot?'stale':'disconnected',hasCredentials:false,nextSyncAt:null,message:'已断开连接并清除本机会话；保留历史快照'});
    this.log('info','已断开连接并清除加密会话'); this.emit();
  }
  async import(snapshot) {
    const generation=this.generation+1;
    await this.disconnect(); if(generation!==this.generation || this.closed)return; this.snapshot=snapshot; this.store.save(snapshot,'import');
    Object.assign(this.connection,{source:'import',status:'stale',airlineId:snapshot.airline.id,lastSuccessAt:snapshot.capturedAt,message:'已导入快照；此来源不会自动更新'});
    this.log('info','已导入数据快照'); this.emit();
  }
  close() { this.closed=true;this.generation++; clearTimeout(this.timer); }
}
