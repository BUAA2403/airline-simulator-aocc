import {airlineBases,baseLabel} from '../server/bases.mjs';
import React,{useMemo,useState} from 'react';
import {Download,Printer,Search,CalendarDays} from 'lucide-react';
import {DAY_NAMES,equipmentLines,durationText,dayOffsetText,publicationTime,timetableCsv,renderTimetableHtml,timetableAirportCount} from './timetable.mjs';
import {REGIONS} from './timetable-groups.mjs';
import {downloadCsv} from './dispatch.mjs';
import {buildPublicationSections} from './timetable-sections.mjs';
export function WeeklyTimetable({snapshot,aircraft,flights,now,onFlight,connection}){
 const [basis,setBasis]=useState('local'),[base,setBase]=useState(''),[region,setRegion]=useState(''),[destination,setDestination]=useState(''),[type,setType]=useState(''),[query,setQuery]=useState('');
 const hubs=useMemo(()=>airlineBases(snapshot?.airline,snapshot?.airports),[snapshot?.airline,snapshot?.airports]),hub=hubs[0]||'';
 const effectiveBase=hubs.includes(base)||base==='extensions'?base:'';
 const sections=useMemo(()=>buildPublicationSections(snapshot?.flights||[],aircraft,snapshot?.airports||[],{basis,hub,hubs,base:effectiveBase,region,destination,type,query}),[snapshot?.flights,aircraft,snapshot?.airports,basis,hub,hubs,effectiveBase,region,destination,type,query]);
 const schedule=sections.flatMap(s=>s.schedule),rows=sections.flatMap(s=>s.rows);
 const destinationCount=new Set(rows.map(r=>r.destinationKey)).size;
 const exportHtml=()=>{const text=renderTimetableHtml({rows,airline:snapshot?.airline?.name||'航空公司',basis,capturedAt:snapshot?.capturedAt});const url=URL.createObjectURL(new Blob([text],{type:'text/html;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`weekly-timetable-${basis}.html`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 const open=r=>{const matches=flights.filter(f=>r.scheduleKeys.includes([f.scheduleId||f.id,f.aircraftId,f.direction||''].join('|')));const f=matches.find(f=>Date.parse(f.arrival)>+now)||matches.at(-1);if(f)onFlight(f.id);};
 return <div className="weekly-timetable">
  <section className="panel timetable-tools">
   <div className="panel-title"><h2><CalendarDays size={17}/>每周航班计划</h2><div className="timetable-actions">
    <button className="button primary" disabled={!rows.length} onClick={exportHtml}><Download size={14}/>下载时刻表</button>
    <button className="button secondary" disabled={!rows.length} onClick={()=>downloadCsv('weekly-timetable.csv',timetableCsv(rows,basis))}><Download size={14}/>CSV</button>
    <button className="button secondary" disabled={!rows.length} onClick={()=>window.print()}><Printer size={14}/>打印 / PDF</button>
   </div></div>
   <div className="desk-filters">
    <label className="search-input"><Search size={15}/><input aria-label="搜索每周航班计划" value={query} onChange={e=>setQuery(e.target.value)} placeholder="航班 / 机场 / 城市 / 注册号"/></label>
    <select aria-label="时刻表时间基准" value={basis} onChange={e=>setBasis(e.target.value)}><option value="local">机场当地时间</option><option value="utc">UTC 时间</option></select>
    <select aria-label="时刻表基地" value={effectiveBase} onChange={e=>setBase(e.target.value)}><option value="">全部基地 · 按基地编排</option>{hubs.map(id=><option key={id} value={id}>{baseLabel(id,hub)}往返</option>)}{schedule.some(g=>g.extension)&&<option value="extensions">其他始发</option>}</select>
    <select aria-label="时刻表区域" value={region} onChange={e=>setRegion(e.target.value)}><option value="">全部区域</option>{REGIONS.filter(r=>schedule.some(g=>g.region===r)).map(r=><option key={r}>{r}</option>)}</select>
    <select aria-label="时刻表目的机场" value={destination} onChange={e=>setDestination(e.target.value)}><option value="">全部目的机场</option>{[...new Set(schedule.map(g=>g.destination))].sort().map(id=><option key={id}>{id}</option>)}</select>
    <select aria-label="时刻表机型" value={type} onChange={e=>setType(e.target.value)}><option value="">全部机型</option>{[...new Set(schedule.flatMap(g=>g.legs.map(r=>r.type)))].sort().map(t=><option key={t}>{t}</option>)}</select>
    <button className="text-button" onClick={()=>{setBase('');setRegion('');setDestination('');setType('');setQuery('');}}>清除筛选</button>
   </div>
  </section>
  <article className="timetable-sheet">
   <header className="publication-masthead"><div><strong>✦ {snapshot?.airline?.name || 'AIRLINE AOCC'}</strong><small>WEEKLY OPERATING SCHEDULE</small></div><div><h2>每周航班时刻表</h2><span>{hubs.length?`${hubs.join(' / ')} 基地 · `:''}往返编排 · {basis==='local'?'机场当地时间':'UTC 时间'}</span><small>{snapshot?`更新 ${publicationTime(snapshot.capturedAt)} · 北京时间`:'等待数据同步'}{connection?.status==='live'?` · 每 ${connection.intervalSeconds||60} 秒自动同步`:connection?.status==='connecting'?' · 正在同步':connection?.status==='stale'?' · 缓存数据':''}</small></div></header>
   <div className="publication-summary"><span><b>{destinationCount}</b>目的地航线</span><span><b>{rows.reduce((n,r)=>n+r.weeklyFlights,0)}</b>班 / 周</span><span><b>{timetableAirportCount(rows)}</b>机场</span></div>
   {rows.length>0&&<nav className="publication-section-links" aria-label="时刻表承运分区">{sections.filter(s=>s.rows.length).map(s=><a href={`#published-${s.id}`} key={s.id}>{s.label}<b>{s.rows.reduce((n,r)=>n+r.weeklyFlights,0)}</b><span>班 / 周 ↓</span></a>)}</nav>}
   {rows.some(r=>!r.timezoneKnown)&&<p className="timetable-warning">部分机场缺少当地时区，可切换 UTC 时间查看。</p>}
   {sections.filter(s=>s.rows.length).map(s=>{let lastSection='';return <section key={s.id} id={`published-${s.id}`} className={`publication-traffic-section ${s.id}`} aria-label={s.label}>
   <header className="publication-traffic-heading"><div><span>{s.en}</span><h3>{s.label}</h3></div><p><b>{s.destinations.length}</b> 目的地航线 <i/> <b>{s.rows.reduce((n,r)=>n+r.weeklyFlights,0)}</b> 班 / 周</p></header>
   <div className="publication-scroll"><table className="published-timetable"><thead><tr><th>航段</th><th>航班号</th>{DAY_NAMES.map(d=><th key={d} className="operating-day">{d}</th>)}<th>离港</th><th>到港</th><th>航程</th><th>机型 / 承运人</th><th>舱等</th></tr></thead>
    {s.destinations.map(d=>d.rotations.map((g,index)=>{const section=`${d.extension?'其他始发':d.baseLabel||baseLabel(d.base,hub)} · ${d.region}`,heading=index===0&&section!==lastSection;lastSection=section;return <tbody key={g.key} className="publication-pair">
     {heading&&<tr className="publication-station"><td colSpan={14}><b>{d.extension?'其他始发':d.baseLabel||baseLabel(d.base,hub)}</b><span>{d.region}</span></td></tr>}
     {index===0&&<tr className="publication-route"><td colSpan={14}><b>{d.base} <span className="route-double-arrow">↔</span> {d.destination}</b><span>{d.baseCity} — {d.destinationCity}</span><span className="destination-count">{d.rotations.length} 组往返</span></td></tr>}
     {g.path.length>2&&<tr className="publication-via"><td colSpan={14}>经停 <b>{g.path.slice(1,-1).join(' / ')}</b></td></tr>}
     {g.legs.map(r=><tr key={r.key} className="publication-flight" tabIndex={0} onClick={()=>open(r)} onKeyDown={e=>{if(e.key==='Enter')open(r);}} aria-label={`查看计划航班 ${r.number} ${r.origin} 至 ${r.destination}`}>
      <td><span className={`leg-direction ${r.legLabel==='去程'?'outbound':'inbound'}`}>{r.legLabel}</span><strong>{r.origin} <span className="leg-arrow">→</span> {r.destination}</strong></td><td><b>{r.number}</b></td>
      {DAY_NAMES.map((_,i)=><td key={i} className={`operating-day ${r.days.includes(i)?'operates':''}`}>{r.days.includes(i)?'●':'·'}</td>)}
      <td className="publication-time">{r.departure}</td><td className="publication-time">{r.arrival}<sup>{dayOffsetText(r.arrivalDayOffset)}</sup></td><td className="publication-duration">{durationText(r.durationMinutes)}</td><td>{equipmentLines(r).map(line=><span className="equipment-line" key={line}>{line}</span>)}</td><td>{r.classes||'—'}</td>
     </tr>)}
    </tbody>;}))}

   </table></div></section>;})}
   {!rows.length&&<div className="publication-empty">{snapshot?'没有匹配的计划航班':'连接游戏后生成每周航班计划'}</div>}
   <footer className="publication-footnote">{basis==='local'?'各时刻为相应机场当地时间，去返程运营日分别以各自始发地为准。':'时刻与运营日均为 UTC。'} +1 / +2 表示次日 / 第三日，−1 表示前一日。F 头等 · J 公务 · W 超经 · Y 经济。</footer>
  </article>
 </div>;
}
