import React,{useDeferredValue,useMemo,useState} from 'react';
import {ArrowRight,ChevronDown,Copy,Globe2,Search} from 'lucide-react';
import {minutesText} from './aircraft-week.mjs';
import {HAUL_OPTIONS,LONG_HAUL_KM,scheduleLocalStamp} from './schedule-assistant.mjs';
import {buildExpansionIndex,recommendExpansion} from './schedule-expansion.mjs';
import {DAY_NAMES,operatingDaysText} from './timetable.mjs';

const number = new Intl.NumberFormat('zh-CN');
const percent = value => `${Math.round(value*100)}%`;
const PAGE_SIZE = 5;

export default function ScheduleExpansion({snapshot,assistant,aircraft,trialBase,fillRows}) {
  const [mode,setMode]=useState('new');
  const [preference,setPreference]=useState('balanced');
  const [maxTrips,setMaxTrips]=useState(3);
  const [minimum,setMinimum]=useState(15);
  const [demandOnly,setDemandOnly]=useState(true);
  const [allowOvernight,setAllowOvernight]=useState(false);
  const [query,setQuery]=useState('');
  const [selected,setSelected]=useState(null);
  const [limit,setLimit]=useState(PAGE_SIZE);
  const deferredQuery=useDeferredValue(query);
  const index=useMemo(()=>buildExpansionIndex(snapshot),[snapshot]);
  const {plans,base}=useMemo(()=>recommendExpansion(assistant,index,aircraft,{
    mode,preference,maxTrips,minimum,query:deferredQuery,demandOnly,trialBase,allowOvernight,
  }),[assistant,index,aircraft,mode,preference,maxTrips,minimum,deferredQuery,demandOnly,trialBase,allowOvernight]);
  const visiblePlans=plans.slice(0,limit);
  const active=selected===false?null:visiblePlans.find(plan=>plan.airport.id===selected)||visiblePlans[0];
  const isExtra=mode==='extra';

  function changeMode(next) {
    setMode(next);
    setQuery('');
    setSelected(null);
    setLimit(PAGE_SIZE);
  }

  return <section className="expansion" aria-label="开航与增班方案">
    <div className="expansion-toolbar">
      <div className="planner-segments" role="group" aria-label="航线计划类型">
        <button type="button" aria-pressed={!isExtra} onClick={()=>changeMode('new')}>开新直飞航线</button>
        <button type="button" aria-pressed={isExtra} onClick={()=>changeMode('extra')}>现有航线增班</button>
      </div>
      <div className="planner-segments" role="group" aria-label="开航与增班航程偏好">
        {Object.entries(HAUL_OPTIONS).map(([id,label])=><button key={id} type="button" aria-pressed={preference===id} onClick={()=>setPreference(id)}>{label}</button>)}
      </div>
    </div>
    <div className="planner-toolbar expansion-filters">
      <label className="planner-search"><Search size={15}/><input aria-label="搜索新航线或增班目的地" placeholder="机场代码 / 英文城市名" value={query} onChange={event=>{setQuery(event.target.value);setLimit(PAGE_SIZE);setSelected(null);}}/></label>
      <label>每周往返上限<select value={maxTrips} onChange={event=>setMaxTrips(Number(event.target.value))}>{[1,2,3,4,5,6,7].map(n=><option key={n} value={n}>{n} 班</option>)}</select></label>
      <label>基地衔接<select value={minimum} onChange={event=>setMinimum(Number(event.target.value))}>{[5,15,30,45,60].map(n=><option key={n} value={n}>至少 {n} 分钟</option>)}</select></label>
      {isExtra&&<label>需求筛选<select value={demandOnly?'strong':'any'} onChange={event=>setDemandOnly(event.target.value==='strong')}><option value="strong">计划客座率 ≥ 80%</option><option value="any">全部可排航线</option></select></label>}
      <button className="planner-outline" type="button" aria-pressed={allowOvernight} onClick={()=>setAllowOvernight(value=>!value)}>允许凌晨出发</button>
    </div>
    <div className="expansion-status" aria-live="polite">{base&&<strong>{base} 出发</strong>}<span>{plans.length} 个推荐方案</span></div>
    {plans.length?<div className="planner-list">{visiblePlans.map(plan=>{
      const open=active===plan;
      const {airport,reference,market,matches,distanceKm,timing}=plan;
      const first=matches&&scheduleLocalStamp(matches[0].legs[0].start,index.airports.get(base).utcOffsetSeconds).slice(3);
      const canFill=fillRows.some(row=>row.origin===base&&row.destination===airport.id||row.origin===airport.id&&row.destination===base);
      return <article className={open?'planner-rotation open':'planner-rotation'} key={airport.id}>
        <button type="button" className="planner-rotation-summary expansion-row" aria-expanded={open} onClick={()=>setSelected(open?false:airport.id)}>
          <div><div className="planner-route">{base}<span>↔</span>{airport.id}</div><div className="planner-flight-numbers">{airport.city} <span>{number.format(Math.round(distanceKm))} km</span></div></div>
          <div className="planner-match-days">
            <strong>{matches?`${operatingDaysText(matches.map(match=>match.day))} · ${first}`:'当前无合适空档'}</strong>
            <span>{timing.source==='estimate'?'往返约':'往返'} {minutesText(timing.outboundMinutes+timing.inboundMinutes+timing.turnaroundMinutes)}</span>
          </div>
          <div className="expansion-signal"><strong>{isExtra?(market.load===null?'载客数据不足':`计划客座率 ${percent(market.load)}`):(reference?'同航线有现实参考':plan.traffic?'民航局机场客流':'游戏市场指标')}</strong></div>
          <ChevronDown size={16} className="planner-chevron"/>
        </button>
        {open&&<ExpansionPreview key={`${base}:${airport.id}`} plan={plan} airports={index.airports} aircraft={aircraft} canFill={canFill}/>}
      </article>;
    })}{plans.length>limit&&<button type="button" className="planner-outline planner-more" onClick={()=>setLimit(value=>value+PAGE_SIZE)}>更多方案<ChevronDown size={14}/></button>}</div>:
      <div className="planner-no-results"><Globe2 size={24}/><strong>{base?'当前条件下没有可试排航线':'这架飞机没有可用于试排的基地'}</strong>{base&&<span>{isExtra&&demandOnly?'可以切换到「全部可排航线」，或放宽出发时段。':'可以更换飞机，或开启「允许凌晨出发」。'}</span>}</div>}
    <details className="planner-filters expansion-method"><summary>推荐依据<ChevronDown size={13}/></summary><div className="planner-criteria">
      <p>开航参考已公布的现实航线、机场客流和游戏市场指标。增班优先考虑计划客座率至少 80%、且载客数据覆盖至少 75% 执飞班次的航线。客座率是已排航班的游戏预估，新班需求需在游戏内复核。</p>
      <p>每周使用同一当地出发时刻，优先分散执飞日。增班与原班表同方向出发至少相隔 90 分钟，单程 {number.format(LONG_HAUL_KM)} 公里及以上至少相隔 120 分钟。</p>
      <p>默认短途两端在 06:00–23:29 出发，长途避开 02:00–04:59。需要填补夜间空档时可放宽。</p>
      <p>往返用时含过站。没有游戏班表的航线，用游戏的巡航和风场规则按大圆航迹预估。</p>
    </div></details>
  </section>;
}

function ExpansionPreview({plan,airports,aircraft,canFill}) {
  const [copied,setCopied]=useState('');
  const {rotation,matches,market,reference,traffic,trafficSource,timing,atOtherBase,codeshare,hasStopover,fit}=plan;
  const stamp=(seconds,airportId)=>scheduleLocalStamp(seconds,airports.get(airportId).utcOffsetSeconds);
  function interval(leg,day) {
    const departure=stamp(leg.start,leg.origin), arrival=stamp(leg.end,leg.destination);
    const label=`周${DAY_NAMES[day]}`;
    return [departure,arrival].map(value=>value.startsWith(label)?value.slice(3):value).join(' → ');
  }
  const smallestMargin=Math.min(...(matches||[]).flatMap(match=>[match.before,match.after]).filter(value=>value!==null));
  const sourceLabels={schedule:'游戏班表',codeshare:'游戏共享班表',estimate:'游戏规则预估'};

  async function copy() {
    const header=`${market?'现有航线增班':'新航线试排'} · ${aircraft.registration||aircraft.id} · ${rotation.origin} ↔ ${rotation.destination}`;
    const schedule=matches.map(match=>match.legs.map(leg=>`${leg.origin} ${stamp(leg.start,leg.origin)} → ${leg.destination} ${stamp(leg.end,leg.destination)}`).join(' / '));
    try {
      await navigator.clipboard.writeText([header,...schedule,`当地时间 · 过站 ${timing.turnaroundMinutes} 分钟 · ${sourceLabels[timing.source]}`].join('\n'));
      setCopied('已复制');
    } catch {
      setCopied('无法复制，请直接查看下方方案');
    }
  }

  return <div className="planner-detail expansion-preview">
    <div className="expansion-evidence">
      {market&&<p><strong>现有运力</strong><span>{market.rotations?`每周 ${market.rotations} 个往返`:'尚无计划班次'}{market.load!==null&&` · 计划载客 ${number.format(market.passengers)} / ${number.format(market.seats)} 座（单向${market.coverage<1?'，仅计有数据的班次':''}）`}</span></p>}
      {fit?.referenceMix?.length>0&&<p><strong>原执飞机型</strong><span>{fit.referenceMix.map(item=>`${item.size} ${item.share}%`).join(' · ')}</span></p>}
      {reference&&<p><strong>现实航线</strong><span>{reference.note} · <a href={reference.url} target="_blank" rel="noreferrer">{reference.label}</a></span></p>}
      {traffic&&<p><strong>目的地机场</strong><span>2025 年客流 {Math.round(traffic/10_000)} 万人次 · <a href={trafficSource.url} target="_blank" rel="noreferrer">中国民航局</a></span></p>}
      {(atOtherBase||codeshare||hasStopover||canFill)&&<p><strong>自家航网</strong><span>{[atOtherBase&&`${atOtherBase} 已覆盖`,codeshare&&'已有共享航班',hasStopover&&'已有经停服务',canFill&&'该飞机也可补现有航班号'].filter(Boolean).join(' · ')}</span></p>}
      <p><strong>{sourceLabels[timing.source]}</strong><span>去程 {minutesText(timing.outboundMinutes)} · 返程 {minutesText(timing.inboundMinutes)} · 过站 {minutesText(timing.turnaroundMinutes)}</span></p>
    </div>
    {matches&&<><div className="expansion-preview-head">
      <div><strong>整周试排</strong><span>当地时间{Number.isFinite(smallestMargin)&&` · 最紧衔接 ${Math.floor(smallestMargin/60)} 分钟`}</span></div>
      <button type="button" className="planner-outline" onClick={copy}><Copy size={14}/>{copied==='已复制'?copied:'复制方案'}</button>
    </div>
    <div className="expansion-week" role="list" aria-label="拟新增的每周往返">
      <div className="expansion-week-row expansion-week-head" aria-hidden="true"><span>始发日</span><span>{rotation.origin}<ArrowRight size={11}/>{rotation.destination}</span><span>{rotation.destination}<ArrowRight size={11}/>{rotation.origin}</span></div>
      {matches.map(match=><div className="expansion-week-row" key={match.id} role="listitem"><strong>周{DAY_NAMES[match.day]}</strong><span>{interval(match.legs[0],match.day)}</span><span>{interval(match.legs[1],match.day)}</span></div>)}
    </div>
    {copied&&<p className="planner-feedback" role="status">{copied}</p>}</>}
  </div>;
}
