import React,{useMemo,useState,useEffect} from 'react';
import {X,Plane,Layers3,ArrowRight,Navigation} from 'lucide-react';
import {CabinLayout} from './cabin-layout.jsx';
import {flightContext,scheduledOccurrence} from './flight-context.mjs';
import {flightCountdown} from './dispatch.mjs';
import {operatingDaysText,dayOffsetText} from './timetable.mjs';
import './flight-details.css';
import {FlightArc} from './identity.jsx';
import {codeshareContext} from './codeshares.mjs';
const num=v=>Number.isFinite(v)?v.toLocaleString('en-US',{maximumFractionDigits:1}):'—';
const money=v=>Number.isFinite(v)?`$${Math.round(v).toLocaleString('en-US')}`:'—';
const time=t=>t?new Date(t).toISOString().slice(11,16):'—';
const day=t=>t?new Intl.DateTimeFormat('zh-CN',{timeZone:'UTC',weekday:'short'}).format(new Date(t)):'—';
const scopes=[['movement','本次航班'],['number','航班号'],['route','航线'],['tail','飞机']];
function Metrics({items}){return <div className="inspector-metrics">{items.map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>;}
function Tails({aircraft,onCabin}){return <div className="inspector-tails">{aircraft.map(a=><button key={a.id} onClick={()=>onCabin(a)}><Plane size={14}/><strong>{a.registration}</strong><span>{a.type.replace(/^(Airbus|Boeing|Comac)\s+/,'')}</span></button>)}</div>;}
export function FlightDetails({clockRate=1,onCabin,now,flight:f,aircraft:a,airportMap,onClose,snapshot,flights=[],onFlight,onAircraft}){
 const [scope,setScope]=useState('movement');
 const agreements=codeshareContext(f,snapshot);
 useEffect(()=>setScope('movement'),[f.id]);
 const context=useMemo(()=>flightContext(f,snapshot),[f.number,f.scheduleId,f.direction,f.origin,f.destination,f.aircraftId,snapshot]);
 const open=(r,assignment)=>{const target=scheduledOccurrence(r,flights,now,assignment);if(target)onFlight(target.id);};
 const rows=scope==='number'?context.number.rows:scope==='route'?context.route.rows:context.tail.rows;
 const status={airborne:'飞行中',scheduled:'计划中',arrived:'已抵达'}[f.status]||'待核实';
 const load=Number.isFinite(f.plannedPassengers)&&a?.capacity>0?f.plannedPassengers/a.capacity:null;
 const progress=Number.isFinite(f.progress)?Math.max(0,Math.min(1,f.progress)):null;
 const next=flights.filter(x=>x.aircraftId===a?.id&&Date.parse(x.departure)>+now).sort((x,y)=>Date.parse(x.departure)-Date.parse(y.departure))[0];
 return <><button className="drawer-backdrop flight-inspector-backdrop" onClick={onClose} aria-label="关闭航班详情"/><aside className="flight-drawer flight-inspector" role="dialog" aria-modal="true" aria-labelledby="flight-detail-title">
  <header className="drawer-title"><div><span className="eyebrow">FLIGHT CONTROL</span><h2 id="flight-detail-title">{f.number||'未编号航班'}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭航班详情"><X size={22}/></button></header>
  <div className="flight-detail-status"><span className="inspector-tail">{a?.registration||'执飞机待定'} · {a?.type}</span><span className={`badge ${f.status==='airborne'?'green':'gray'}`}><i/>{status}</span></div>
  {f.isCodeshare&&<div className="codeshare-detail"><span className="codeshare-pill">代码共享</span><div><strong>{f.operatorName} 承运</strong><span>实际执飞 {f.operatingNumber} · 我方挂号 {(f.marketingNumbers||[f.number]).join(' / ')}</span></div></div>}
  {!f.isCodeshare&&agreements.length>0&&<div className="codeshare-detail"><span className="codeshare-pill">我方承运</span><div><strong>本航班开放代码共享</strong><span>{agreements.map(c=>{const p=snapshot.codeshares.partners.find(p=>p.id===c.marketingUid);return `${p?.name||'合作航司'} ${p?.code||''}${f.direction==='out'?c.marketingOutboundFlightNumber:c.marketingInboundFlightNumber}`;}).join(' · ')}</span></div></div>}
  <div className="detail-route"><div><strong>{f.origin}</strong><span>{airportMap[f.origin]?.city}</span><b>{time(f.departure)} <small>UTC</small></b><small>{day(f.departure)}</small></div><div className="detail-route-line"><FlightArc progress={progress}/></div><div><strong>{f.destination}</strong><span>{airportMap[f.destination]?.city}</span><b>{time(f.arrival)} <small>UTC</small></b><small>{day(f.arrival)}</small></div></div>
  <div className="detail-progress"><div><span>航程进度</span><b>{progress!==null?`${Math.round(progress*100)}%`:'—'} · {f.status==='arrived'?'已抵达':(f.status==='airborne'?'剩余 ':'距起飞 ')+flightCountdown(f,now,clockRate)}</b></div><div className="progress-track"><i style={{width:`${(progress||0)*100}%`}}/></div></div>
  <div className="inspector-tabs" role="tablist" aria-label="航班详情视角">{scopes.map(([id,label])=><button key={id} role="tab" aria-selected={scope===id} onClick={()=>setScope(id)}>{label}</button>)}</div>
  <div role="tabpanel" aria-label={scopes.find(([id])=>id===scope)[1]}>
   {scope==='movement'?<>
    <Metrics items={[[f.isCodeshare?"承运航班预计旅客":"预计旅客",Number.isFinite(f.plannedPassengers)?`${num(f.plannedPassengers)} 人`:'—'],[f.isCodeshare?'承运航班客座率':'预计客座率',load!==null?`${(load*100).toFixed(1)}%`:'—'],['计划过站',Number.isFinite(f.turnaroundMinutes)?`${f.turnaroundMinutes} 分钟`:'—']]}/>
    <section className="detail-section inspector-cabin"><h3><Layers3 size={15}/>本次客舱<button className="text-button" onClick={()=>onCabin(a)}>展开布局</button></h3><CabinLayout aircraft={a} compact/></section>
    <details className="inspector-disclosure"><summary>分舱旅客预估</summary><table className="detail-cabin-table"><thead><tr><th>舱等</th><th>座位</th><th>单班预估</th><th>该任务单向周预估</th></tr></thead><tbody>{['first','biz','premEco','eco'].filter(k=>a?.cabins?.[k]?.numSeats).map((k,i)=><tr key={k}><td>{{first:'头等 F',biz:'公务 J',premEco:'超经 W',eco:'经济 Y'}[k]}</td><td>{a.cabins[k].numSeats}</td><td>{num(f.cabinPlan?.[k]?.averagePassengers)}</td><td>{num(f.cabinPlan?.[k]?.weeklyPassengers)}</td></tr>)}</tbody></table></details>
    <details className="inspector-disclosure"><summary>位置与任务数据</summary><dl><div><dt>计划推算坐标</dt><dd>{Number.isFinite(f.lat)&&Number.isFinite(f.lon)?`${f.lat.toFixed(2)}°, ${f.lon.toFixed(2)}°`:'地面'}</dd></div><div><dt>航向</dt><dd>{Number.isFinite(f.heading)?`${f.heading.toFixed(0)}°`:'—'}</dd></div><div><dt>该往返任务周计划利润</dt><dd>{money(f.weeklyProfit)}</dd></div></dl></details>
   </>:<>
    <section className="inspector-scope-heading"><h3>{scope==='number'?`${f.number||'未编号'} · 全部执行计划`:scope==='route'?`${f.origin} ↔ ${f.destination} · 双向航线`:`${a?.registration||'—'} · 执飞机`}</h3></section>
    {scope==='number'&&<Metrics items={[["单向周航段",context.number.weeklyLegs],['执飞机',`${context.number.aircraft.length} 架`],['覆盖机场',new Set(context.number.rows.flatMap(r=>[r.origin,r.destination])).size]]}/>}
    {scope==='route'&&<Metrics items={[["双向周航段",context.route.weeklyLegs],['周计划利润',money(context.route.plan?.weeklyProfit)],['预计客座率',context.route.plan?.loadFactor!=null?`${(context.route.plan.loadFactor*100).toFixed(1)}%`:'—']]}/>}
    {scope==='tail'&&<>{onAircraft&&<button className="inspector-open-week" onClick={()=>onAircraft(a.id)}>查看完整周排班、时间轴与航迹回放<ArrowRight size={14}/></button>}<Metrics items={[["客舱座位",a?.capacity??'—'],[f.isCodeshare?'共享周航段':'周航段',context.tail.weeklyLegs],[f.isCodeshare?'共享任务利用率':'计划利用率',Number.isFinite(a?.utilization)?`${a.utilization}%`:'—']]}/><section className="detail-section inspector-cabin"><h3><Layers3 size={15}/>客舱配置<button className="text-button" onClick={()=>onCabin(a)}>展开布局</button></h3><CabinLayout aircraft={a} compact/></section>{next&&<button className="inspector-next" onClick={()=>onFlight(next.id)}><Navigation size={15}/><span>下一任务 <b>{next.number}</b></span><strong>{next.origin} → {next.destination}</strong><span>{day(next.departure)} {time(next.departure)} UTC</span></button>}</>}
    {scope!=='tail'&&<section className="detail-section"><h3>执飞机队</h3><Tails aircraft={scope==='number'?context.number.aircraft:context.route.aircraft} onCabin={onCabin}/></section>}
    <section className="detail-section"><h3>{scope==='tail'?'每周执行计划':'每周时刻'}<span className="inspector-basis">机场当地时间</span></h3><div className="inspector-schedule">{rows.map(r=><article className="inspector-schedule-card" key={r.key}>
     <button className="inspector-service" onClick={()=>open(r)} aria-label={`查看 ${r.number} ${r.origin} 至 ${r.destination} 最近执行`}><div><strong>{r.number}</strong><span>{r.origin}<ArrowRight size={11}/>{r.destination}</span><b>{r.departure} — {r.arrival}<sup>{dayOffsetText(r.arrivalDayOffset)}</sup></b></div><div><span>{operatingDaysText(r.days)}</span><span>{r.weeklyFlights} 班 / 周</span></div></button>
     <div className="inspector-assignments">{r.assignments.map(assignment=>{
      const selected=assignment.aircraftId===f.aircraftId&&assignment.scheduleKeys.includes([f.scheduleId||f.id,f.aircraftId,f.direction||''].join('|'));
      const target=scheduledOccurrence(r,flights,now,assignment);
      return <button key={assignment.aircraftId} className={`inspector-assignment ${selected?'selected':''}`} onClick={()=>open(r,assignment)} disabled={!target} aria-label={`查看 ${r.number} ${assignment.registration} ${operatingDaysText(assignment.days)} 执行任务`}><Plane size={12}/><span className="assignment-aircraft"><strong>{assignment.registration}</strong><small>{assignment.type.replace(/^(Airbus|Boeing|Comac)\s+/,'')}</small></span><span className="assignment-days">{operatingDaysText(assignment.days)}</span>{selected&&<em>本次</em>}<ArrowRight size={12}/></button>;
     })}</div>
    </article>)}</div></section>
   </>}
  </div>
  <details className="data-definitions"><summary>数据口径</summary>{f.isCodeshare&&<p>合作飞机仅展示已接入的共享任务；旅客与座位为承运航班总量，不代表我方销售份额。</p>}<p>位置与状态按游戏班表推算。旅客及客座率为计划预估；周计划利润按原生往返任务去重汇总。航班号统计包含同号经停航段，航线统计为当前两机场双向航段。</p></details>
 </aside></>;
}
