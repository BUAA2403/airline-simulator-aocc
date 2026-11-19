import React,{useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,ArrowUpRight,CalendarPlus,Check,ChevronDown,Clock3,Copy,ListFilter,MapPin,Plane,Plus,Search,Sparkles,X} from 'lucide-react';
import {minutesText} from './aircraft-week.mjs';
import {DAY_NAMES,operatingDaysText} from './timetable.mjs';
import {aircraftTrialBases,buildScheduleAssistant,extendTrial,GAME_CONNECTION_MINUTES,HAUL_OPTIONS,LONG_HAUL_KM,matchesConflict,plannerHomeBase,recommendForAircraft,recommendTrial,scheduleLocalStamp,trialWithConnections,weeklySpacing} from './schedule-assistant.mjs';
import ScheduleConsistency from './schedule-consistency.jsx';
import './schedule-assistant.css';

const BASE_BUFFERS = [5, 10, 15, 30, 45, 60];
const weeklyRate = minutes => minutes / (7 * 1440) * 100;
const utilization = minutes => `${weeklyRate(minutes).toFixed(1)}%`;
const aircraftRate = aircraft => Number.isFinite(aircraft.weeklyFlightMinutes) ? weeklyRate(aircraft.weeklyFlightMinutes) : aircraft.utilization;
const rateLabel = rate => Number.isFinite(rate) ? `${rate.toFixed(1)}%` : '—';
const sortByUtilization = (a,b) => (aircraftRate(a.aircraft) ?? Infinity) - (aircraftRate(b.aircraft) ?? Infinity) ||
  (a.aircraft.registration || a.aircraft.id).localeCompare(b.aircraft.registration || b.aircraft.id);
const quotedDate = new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const weekText = day => `周${DAY_NAMES[day]}`;
const legNumbers = rotation => [...new Set(rotation.legs.map(leg => leg.number))].join(' / ');
const matchesOf = rows => rows.flatMap(row => row.matches.map(match => ({...match, rotation:row})));
const groundTime = seconds => seconds === null ? '整周待命' : minutesText(seconds / 60);
const rankAircraft = (a,b) => b.full - a.full || b.count - a.count || b.best - a.best || a.aircraft.registration.localeCompare(b.aircraft.registration);
const byWeek = (a,b) => a.day-b.day || a.rotation.root.departureSeconds-b.rotation.root.departureSeconds;
const PAGE_SIZE = 6;
const HAUL_STORAGE='polaris-planner-haul';
const operatingDayCount = row => row.execution.operatingDays.size;
const editsAssignment = (row,aircraft) => row.root.assignedTails.has(aircraft.id);
const editAssignmentLabel = '编辑已有分配';
const assignmentAction = (row,aircraft) => editsAssignment(row,aircraft)?editAssignmentLabel:'增加飞机';
const NO_BASE = 'unbased';
const ScheduleExpansion = React.lazy(()=>import('./schedule-expansion.jsx'));

function trialCoverage(trial) {
  const coverage=new Map();
  for (const {rotation:row,day} of trial) {
    if (!coverage.has(row.id)) coverage.set(row.id,{row,days:[]});
    coverage.get(row.id).days.push(day);
  }
  for (const {days} of coverage.values()) days.sort((a,b)=>a-b);
  return coverage;
}

function sortedFlightGroups(coverage) {
  return [...coverage.values()].sort((a,b)=>a.row.root.outboundNumber.localeCompare(b.row.root.outboundNumber,undefined,{numeric:true})||
    a.row.root.departureSeconds-b.row.root.departureSeconds);
}

const departureClock = row => scheduleLocalStamp(row.root.start,row.root.from.utcOffsetSeconds).slice(3);
function rankTail(assistant,aircraft) {
  const assess = trialBase => {
    const rows = recommendForAircraft(assistant,aircraft,GAME_CONNECTION_MINUTES,trialBase);
    return {aircraft,trialBase,rows,count:rows.reduce((sum,row)=>sum+row.matches.length,0),
      full:rows.filter(row=>row.fillsWeek).length,best:Math.max(0,...rows.map(row=>row.extraMinutes))};
  };
  const choices = aircraftTrialBases(assistant,aircraft)?.map(assess);
  const best = choices?.reduce((top,choice)=>!top||rankAircraft(choice,top)<0?choice:top,null);
  return {...(best||assess()),choices};
}

function fitLabel(fit) {
  if (!fit.source) return '缺少机队对照';
  if (fit.sizeMatch<0.35) return '机型差异较大';
  if (fit.sizeMatch<0.65) return '机型混飞';
  const size = fit.sizeMatch===1?'同为'+fit.candidate.sizeLabel:'机型相近';
  if (fit.capacityRatio!==null && (fit.capacityRatio<0.8 || fit.capacityRatio>1.25)) return size+' · 座位数有差异';
  if (fit.cabinFit===null) return size;
  return size+(fit.cabinFit<0.7?' · 客舱有差异':' · 客舱相近');
}

function FeedStatus({snapshot, connection}) {
  if (!snapshot?.capturedAt) return null;
  const active = connection?.source === 'game' && ['live','connecting'].includes(connection.status);
  const label = active ? '自动同步中' : connection?.source==='import' ? '导入快照' : '缓存快照';
  return <span className={`planner-feed ${active?'live':''}`}><i/>{label}<time dateTime={snapshot.capturedAt}>{quotedDate.format(new Date(snapshot.capturedAt))} 北京时间</time></span>;
}

function PlannerEmpty({status, snapshot, connection, embedded = false}) {
  const message = status === 'incomplete' ? ['班表数据暂不完整','连接恢复或收到完整周班表后，将自动重新计算。'] :
    snapshot ? ['等待首份完整的游戏班表','下一次成功同步后，即可核对现有航班号的空缺日。'] : ['等待游戏数据','接入游戏后，按飞机查找每周可补飞的航班。'];
  return <section className={`schedule-assistant planner-empty ${embedded?'embedded':'panel'}`}><FeedStatus snapshot={snapshot} connection={connection}/><CalendarPlus size={31}/><h3>{message[0]}</h3><p>{message[1]}</p></section>;
}

export default function FleetScheduleAssistant({snapshot, connection, onAircraft}) {
  const assistant = useMemo(() => buildScheduleAssistant(snapshot), [snapshot]);
  const [mode,setMode] = useState('fill'), [selected,setSelected] = useState('');
  const fleet = snapshot?.aircraft;
  const rankings = useMemo(() => (fleet || []).map(aircraft=>rankTail(assistant,aircraft)).sort(rankAircraft), [assistant,fleet]);
  const chosen = rankings.find(r => r.aircraft.id === selected);
  const fillEntry=chosen||rankings[0];
  const expansionEntry=useMemo(()=>chosen||rankings.filter(({aircraft,choices})=>aircraft.status!=='maintenance' &&
    (assistant.bases?.includes(plannerHomeBase(aircraft)) || choices?.length))
    .sort(sortByUtilization)[0]||fillEntry,
    [chosen,rankings,assistant.bases,fillEntry]);
  const entry=mode==='expansion'?expansionEntry:fillEntry;
  if (assistant.status !== 'ready') return <PlannerEmpty status={assistant.status} snapshot={snapshot} connection={connection}/>;
  return <section className="schedule-assistant panel"><div className="planner-heading"><div className="planner-heading-title"><div className="planner-icon"><CalendarPlus size={20}/></div>
      <PlannerModes mode={mode} setMode={setMode} consistency/>
    </div><FeedStatus snapshot={snapshot} connection={connection}/></div>
    <div hidden={mode==='consistency'}>{entry?<>
      <AircraftPicker entry={entry} fleet={rankings} bases={assistant.bases} showFillSuggestions={mode!=='expansion'} onSelect={setSelected} onAircraft={onAircraft}/>
      <div hidden={mode==='expansion'}><AircraftRecommendations key={fillEntry.aircraft.id} assistant={assistant} entry={fillEntry}/></div>
      {mode==='expansion'&&<AircraftRecommendations key={entry.aircraft.id} assistant={assistant} entry={entry} snapshot={snapshot} expansion onlyExpansion/>}
    </>:<div className="planner-no-results">暂无可选飞机</div>}</div>
    {mode==='consistency'&&<ScheduleConsistency assistant={assistant} flights={snapshot.flights}/>}
  </section>;
}

function PlannerModes({mode,setMode,consistency}) {
  return <div className="planner-segments" role="group" aria-label="排班工作模式">
    <button type="button" aria-pressed={mode==='fill'} onClick={()=>setMode('fill')}>补班推荐</button>
    <button type="button" aria-pressed={mode==='expansion'} onClick={()=>setMode('expansion')}>开航与增班</button>
    {consistency&&<button type="button" aria-pressed={mode==='consistency'} onClick={()=>setMode('consistency')}>产品一致性</button>}
  </div>;
}

function AircraftPicker({entry,fleet,bases,showFillSuggestions,onSelect,onAircraft}) {
  const [open,setOpen]=useState(false),[base,setBase]=useState(''),[query,setQuery]=useState(''),[candidatesOnly,setCandidatesOnly]=useState(false);
  const button=useRef(null), input=useRef(null);
  useEffect(()=>{if(open)input.current?.focus();},[open]);
  const term=query.trim().toLowerCase();
  const baseFilters=['',...bases,NO_BASE];
  const activeBase=baseFilters.includes(base)?base:'';
  const rows=fleet.filter(({aircraft:a,count})=>(!activeBase||(activeBase===NO_BASE?!plannerHomeBase(a):plannerHomeBase(a)===activeBase))&&
    (!showFillSuggestions||!candidatesOnly||count)&&[a.registration,a.type].join(' ').toLowerCase().includes(term))
    .sort(sortByUtilization);
  const aircraft=entry.aircraft;
  const homeBase=plannerHomeBase(aircraft);
  const close=()=>{setOpen(false);button.current?.focus();};
  return <section className="planner-fleet-picker" aria-label="选择执行飞机" onKeyDown={e=>{if(open&&e.key==='Escape'){e.stopPropagation();close();}}}>
    <div className="planner-picker-current">
      <div className="planner-picker-tail"><Plane size={22}/><div><strong>{aircraft.registration||aircraft.id}</strong><span>{aircraft.type} · {homeBase?`${homeBase} 基地`:'未分配基地'} · 周利用率 {rateLabel(aircraftRate(aircraft))}</span></div></div>
      <div className="planner-actions"><button className="planner-outline" type="button" onClick={()=>onAircraft(aircraft.id)}>查看周排班<ArrowUpRight size={14}/></button>
      <button ref={button} className="planner-outline picker-switch" type="button" aria-expanded={open} onClick={()=>setOpen(!open)}>{open?'收起机队':'更换飞机'}<ChevronDown size={14}/></button></div>
    </div>
    {open&&<>
      <div className="planner-picker-tools">
        <label className="planner-search"><Search size={15}/><input ref={input} aria-label="搜索飞机注册号或机型" placeholder="搜索注册号 / 机型" value={query} onChange={e=>setQuery(e.target.value)}/></label>
        <div className="planner-segments" role="group" aria-label="机队基地筛选">{baseFilters.map(code=><button key={code} type="button" aria-pressed={activeBase===code} onClick={()=>{setBase(code);if(code===NO_BASE)setCandidatesOnly(false);}}>{code===NO_BASE?'未分配基地':code||'全部飞机'}</button>)}</div>
        {showFillSuggestions&&<button className="planner-outline" type="button" aria-pressed={candidatesOnly} onClick={()=>setCandidatesOnly(value=>!value)}>仅有补班建议</button>}
      </div>
      {!!rows.length&&<>
        <div className="planner-picker-sort"><span>周利用率 · 从低到高</span><span>{rows.length} 架</span></div>
        <div className="planner-picker-list" aria-label="飞机搜索结果">{rows.map(({aircraft:a,rows:plans})=><button type="button" key={a.id} aria-pressed={a.id===aircraft.id} onClick={()=>{onSelect(a.id);close();}}>
          <span><strong>{a.registration||a.id}</strong><small>{a.type}</small></span>
          <span><strong className="planner-picker-rate">{rateLabel(aircraftRate(a))}</strong><small>{plannerHomeBase(a)||'未分配'}{showFillSuggestions&&` · ${plans.length} 组建议`}</small></span>
        </button>)}</div>
      </>}
      {!rows.length&&<div className="planner-no-results">没有符合筛选条件的飞机</div>}
    </>}
  </section>;
}

export function AircraftScheduleAssistant({snapshot,connection,aircraft}) {
  const assistant = useMemo(() => buildScheduleAssistant(snapshot), [snapshot]);
  const entry = useMemo(()=>rankTail(assistant,aircraft),[assistant,aircraft]);
  const [mode,setMode]=useState('fill');
  if (assistant.status !== 'ready') return <PlannerEmpty status={assistant.status} snapshot={snapshot} connection={connection} embedded/>;
  return <section className="schedule-assistant embedded"><div className="planner-heading"><div className="planner-heading-title"><div className="planner-icon"><CalendarPlus size={20}/></div><PlannerModes mode={mode} setMode={setMode}/></div><FeedStatus snapshot={snapshot} connection={connection}/></div><AircraftRecommendations key={aircraft.id} assistant={assistant} entry={entry} snapshot={snapshot} expansion={mode==='expansion'}/></section>;
}

function AircraftRecommendations({assistant,entry,snapshot,expansion,onlyExpansion}) {
  const [base,setBase]=useState(entry.trialBase);
  const active=entry.choices?.find(choice=>choice.trialBase===base)||entry;
  return <>
    {entry.choices&&<div className="planner-trial-base">
      <div><MapPin size={16}/><strong>试排基地</strong></div>
      {!!entry.choices.length&&<div className="planner-segments" role="group" aria-label="选择试排基地">{entry.choices.map(choice=><button type="button" key={choice.trialBase} aria-pressed={active.trialBase===choice.trialBase} onClick={()=>setBase(choice.trialBase)}>{choice.trialBase}</button>)}</div>}
      <span>{entry.choices.length?'仅用于预览，不会更改游戏中的基地。':'没有与这架飞机当前位置匹配的基地。'}</span>
    </div>}
    {!onlyExpansion&&<div hidden={expansion}><PlannerResults key={active.trialBase||''} assistant={assistant} aircraft={active.aircraft} initialRows={active.rows} trialBase={active.trialBase}/></div>}
    {expansion&&<React.Suspense fallback={<div className="planner-no-results" role="status">正在计算航线方案…</div>}>
      <ScheduleExpansion snapshot={snapshot} assistant={assistant} aircraft={active.aircraft} fillRows={active.rows} trialBase={active.trialBase}/>
    </React.Suspense>}
  </>;
}

function PlannerResults({assistant, aircraft, initialRows, trialBase}) {
  const [minimum,setMinimum] = useState(GAME_CONNECTION_MINUTES), [weekday,setWeekday] = useState(-1);
  const [query,setQuery] = useState(''), [sort,setSort] = useState('recommended'), [expanded,setExpanded] = useState(null);
  const [activeDays,setActiveDays] = useState({}), [limit,setLimit] = useState(PAGE_SIZE), [picked,setPicked] = useState([]);
  const [preview,setPreview] = useState(false), [copyStatus,setCopyStatus] = useState(''),[planHaul,setPlanHaul]=useState(null);
  const [pinned,setPinned]=useState([]),[haul,setHaul]=useState(()=>{
    const value=localStorage.getItem(HAUL_STORAGE);
    return Object.hasOwn(HAUL_OPTIONS,value)?value:'balanced';
  });
  const recommendButton = useRef(null);
  const rows = useMemo(() => minimum===GAME_CONNECTION_MINUTES ? initialRows : recommendForAircraft(assistant,aircraft,minimum,trialBase), [assistant,aircraft,initialRows,minimum,trialBase]);
  const matchById = useMemo(() => new Map(matchesOf(rows).map(match => [match.id,match])), [rows]);
  const trial = useMemo(()=>extendTrial([],picked.map(id=>matchById.get(id)).filter(Boolean),minimum),[picked,matchById,minimum]);
  const term = query.trim().toLowerCase();
  const filtered = rows.filter(row => (weekday<0||row.matches.some(match=>match.day===weekday)) &&
    [...row.path, ...row.path.map(id=>assistant.airports.get(id).city), legNumbers(row)].join(' ').toLowerCase().includes(term));
  if (sort==='flight') filtered.sort((a,b)=>weekday<0?b.extraMinutes-a.extraMinutes:b.flightMinutes-a.flightMinutes);
  const resetList = () => {setExpanded(null);setLimit(PAGE_SIZE);};
  const showPreview = () => {setPreview(true);setCopyStatus('');};
  const returnToResults = () => {
    setPreview(false);
    requestAnimationFrame(()=>recommendButton.current?.focus());
  };
  const recommend = () => {
    setPicked(recommendTrial(rows,trial.filter(match=>pinned.includes(match.id)),minimum,haul).map(match=>match.id));
    setPlanHaul(haul);
    showPreview();
  };
  const toggle = match => {
    setCopyStatus('');
    const removing=trial.some(item=>item.id===match.id);
    setPicked(removing?trial.filter(item=>item.id!==match.id).map(item=>item.id):[...trial.map(item=>item.id),match.id]);
    setPinned(pinned=>removing?pinned.filter(id=>id!==match.id):[...pinned,match.id]);
  };
  const copyTrial = async () => {
    const trialMinutes = trial.reduce((sum,match)=>sum+match.flightMinutes,0);
    const summary=sortedFlightGroups(trialCoverage(trial)).map(({row,days})=>
      [legNumbers(row),row.path.join(' → '),departureClock(row),operatingDaysText(days),assignmentAction(row,aircraft)].join(' · '));
    const lines = trial.slice().sort(byWeek).flatMap(match => [
      [weekText(match.day),legNumbers(match.rotation),match.rotation.path.join(' → ')+'（往返）',
        assignmentAction(match.rotation,aircraft)].join(' · '),
      ...match.legs.map(leg=>['  '+leg.number,leg.origin,scheduleLocalStamp(leg.start,assistant.airports.get(leg.origin).utcOffsetSeconds),
        '→',leg.destination,scheduleLocalStamp(leg.end,assistant.airports.get(leg.destination).utcOffsetSeconds)].join(' ')), ''
    ]);
    try {
      await navigator.clipboard.writeText([aircraft.registration+' · '+aircraft.type+(trialBase?' · 试排基地 '+trialBase:''),
        '建议补飞 '+trial.length+' 个往返 · 周飞行 +'+minutesText(trialMinutes),'起降时刻为当地时间','',
        '按航班添加',...summary,'','逐日明细',...lines].join('\n'));
      setCopyStatus('已复制');
    } catch { setCopyStatus('无法访问剪贴板'); }
  };

  if (preview) return <TrialPreview trial={trial} invalidCount={picked.length-trial.length} aircraft={aircraft} trialBase={trialBase}
    minimum={minimum} haul={planHaul} airports={assistant.airports} onBack={returnToResults} onCopy={copyTrial}
    onRemove={toggle} onClear={()=>{setPicked([]);setPinned([]);setPlanHaul(null);returnToResults();}} copyStatus={copyStatus}/>;

  return <>
    <div className="planner-recommend-head">
      <div><h3>补班推荐</h3><p>{filtered.length} 组可接飞 <span>·</span> 当前周利用率 {utilization(aircraft.weeklyFlightMinutes??0)}</p></div>
      <div className="planner-actions">
        <div className="planner-segments" role="group" aria-label="智能推荐航程偏好">{Object.entries(HAUL_OPTIONS).map(([id,label])=><button type="button" key={id} aria-pressed={haul===id} onClick={()=>{setHaul(id);localStorage.setItem(HAUL_STORAGE,id);}}>{label}</button>)}</div>
        {!!picked.length&&<button type="button" className="planner-outline" onClick={showPreview}>查看试排（{trial.length}）</button>}
        <button type="button" className="planner-accent" ref={recommendButton} onClick={recommend} disabled={!rows.length}><Sparkles size={15}/>一键智能推荐</button>
      </div>
    </div>
    <details className="planner-filters">
      <summary><ListFilter size={14}/>筛选与排序<small>{sort==='recommended'?'推荐程度':'飞行增量'}{weekday>=0?' · '+weekText(weekday):''}{term?' · '+query.trim():''}</small><ChevronDown size={13}/></summary>
      <div className="planner-toolbar">
        <label className="planner-search"><Search size={15}/><input aria-label="搜索可补班航班" placeholder="航班号 / 机场" value={query} onChange={e=>{setQuery(e.target.value);resetList();}}/></label>
        <label>日期<select aria-label="筛选补班日" value={weekday} onChange={e=>{setWeekday(Number(e.target.value));resetList();}}><option value={-1}>全周</option>{DAY_NAMES.map((_,day)=><option key={day} value={day}>{weekText(day)}</option>)}</select></label>
        <label>前后衔接<select aria-label="前后最小衔接时间" value={minimum} onChange={e=>{setMinimum(Number(e.target.value));resetList();}}>{BASE_BUFFERS.map(m=><option key={m} value={m}>{m} 分钟</option>)}</select></label>
        <label>排序<select aria-label="排班建议排序" value={sort} onChange={e=>{setSort(e.target.value);resetList();}}><option value="recommended">推荐程度</option><option value="flight">飞行增量</option></select></label>
      </div>
      <div className="planner-criteria"><strong>推荐依据</strong><p>满足基地、航程、机场和衔接条件后，兼顾补齐班次、航班号和同航线的周分布、机型产品与飞行增量。长短途以去程累计 {LONG_HAUL_KM.toLocaleString('en-US')} 公里为界，经停航班按各去程航段相加。</p></div>
    </details>
    {filtered.length?<div className="planner-list">{filtered.slice(0,limit).map(row=>{
      const isOpen = row.id===expanded;
      const offered = weekday<0 ? row.suggestedMatches : row.matches.filter(match=>match.day===weekday);
      const selectedDay = (weekday<0 ? row.matches.find(match=>match.day===activeDays[row.id]) : offered[0]) || row.suggestedMatches[0];
      const chosen = trial.some(match=>match.id===selectedDay.id);
      const conflicts = trial.some(match=>matchesConflict(match,selectedDay,minimum));
      const after = operatingDayCount(row)+offered.length;
      return <article className={isOpen?'planner-rotation open':'planner-rotation'} key={row.id}>
        <button type="button" className="planner-rotation-summary" aria-expanded={isOpen} onClick={()=>setExpanded(isOpen?null:row.id)}>
          <RouteLabel row={row} editAssignment={editsAssignment(row,aircraft)}/>
          <div className="planner-match-days"><strong>{operatingDaysText(offered.map(match=>match.day))}</strong><span>原排 {operatingDayCount(row)} 天 → {after===7?'每日':after+' 天'}</span></div>
          <div className="planner-row-gain"><strong>+{minutesText(row.flightMinutes*offered.length)}</strong></div>
          <ChevronDown size={16} className="planner-chevron"/>
        </button>
        {isOpen&&<div className="planner-detail">
          <div className="planner-detail-head">
            <div role="group" aria-label="选择补班日">{row.matches.filter(match=>weekday<0||match.day===weekday).map(match=><button type="button" className="planner-outline" aria-pressed={selectedDay.day===match.day} key={match.day} onClick={()=>setActiveDays(days=>({...days,[row.id]:match.day}))}>{weekText(match.day)}{trial.some(item=>item.id===match.id)&&<Check size={12}/>}</button>)}</div>
            <button type="button" className={chosen?'planner-outline':'planner-accent'} onClick={()=>toggle(selectedDay)} disabled={conflicts}>{chosen?<Check size={15}/>:<Plus size={15}/>} {chosen?'移出试排':conflicts?'与试排冲突':'加入试排'}</button>
          </div>
          {editsAssignment(row,aircraft)&&<EditAssignmentHint aircraft={aircraft}/>}
          <PublishedWeek row={row} extraDays={offered.some(match=>match.id===selectedDay.id)?offered.map(match=>match.day):[selectedDay.day]}/>
          <RotationDetail match={selectedDay} airports={assistant.airports}/>
        </div>}
      </article>;
    })}{filtered.length>limit&&<button type="button" className="planner-outline planner-more" onClick={()=>setLimit(v=>v+PAGE_SIZE)}>查看更多 · 还有 {filtered.length-limit} 组<ChevronDown size={14}/></button>}</div>:<div className="planner-no-results"><CalendarPlus size={24}/><strong>{rows.length?'没有符合筛选条件的航班':'当前班表没有可直接补飞的组合'}</strong>{!!rows.length&&<span>试试其他星期或航班号。</span>}</div>}
  </>;
}

function RouteLabel({row,editAssignment}) {
  return <div><div className="planner-route">{row.origin}<span>↔</span>{row.destination}</div><div className="planner-flight-numbers">{legNumbers(row)}{row.path.length>2&&<span>经停 {row.path.slice(1,-1).join(' / ')}</span>}{editAssignment&&<span className="planner-edit-assignment">{editAssignmentLabel}</span>}</div></div>;
}

function EditAssignmentHint({aircraft}) {
  return <p className="planner-feedback">在游戏里打开 {aircraft.registration||aircraft.id} 的现有执飞分配，勾选要补的日期。</p>;
}

function TrialPreview({trial,invalidCount,aircraft,trialBase,minimum,haul,airports,onBack,onCopy,onRemove,onClear,copyStatus}) {
  const [expanded,setExpanded] = useState(null);
  const title = useRef(null);
  useEffect(()=>{title.current?.focus();},[]);
  const days = new Map();
  const coverage = trialCoverage(trial);
  let extraMinutes = 0;
  for (const match of trialWithConnections(trial).sort(byWeek)) {
    if (!days.has(match.day)) days.set(match.day,[]);
    days.get(match.day).push(match);
    extraMinutes += match.flightMinutes;
  }
  const completed = [...coverage.values()].filter(({row,days})=>operatingDayCount(row)+days.length===7).length;
  const baseMinutes = aircraft.weeklyFlightMinutes ?? 0;
  return <section className="planner-preview" aria-label="整周试排预览">
    <button type="button" className="planner-back" onClick={onBack}><ArrowLeft size={15}/>返回补班推荐</button>
    <div className="planner-preview-head">
      <div className="planner-heading-title"><div className="planner-icon"><CalendarPlus size={20}/></div><div><h3 ref={title} tabIndex={-1}>整周试排预览</h3><p>{aircraft.registration||aircraft.id}{trialBase&&` · 试排基地 ${trialBase}`} · {HAUL_OPTIONS[haul]||'手动试排'} · 前后至少 {minimum} 分钟 · 当地时间</p></div></div>
      <div className="planner-actions"><button type="button" className="planner-outline" onClick={onClear}>清空</button><button type="button" className="planner-accent" onClick={onCopy} disabled={!trial.length}><Copy size={14}/>复制方案</button></div>
    </div>
    <div className="planner-preview-stats"><div><span>补班往返</span><strong>{trial.length} 班</strong></div><div><span>补齐至每日</span><strong>{completed} 组</strong></div><div><span>新增周飞行</span><strong>+{minutesText(extraMinutes)}</strong></div><div><span>周利用率</span><strong>{utilization(baseMinutes)} <span>→</span> {utilization(baseMinutes+extraMinutes)}</strong></div></div>
    {!!copyStatus&&<p className="planner-feedback" role="status">{copyStatus}</p>}
    {!!invalidCount&&<p className="planner-feedback warning" role="status">{invalidCount} 个往返因班表更新或衔接设置变动已失效。</p>}
    {!!coverage.size&&<table className="planner-trial-summary">
      <caption>按航班添加</caption>
      <thead><tr><th scope="col">航班</th><th scope="col">新增日期</th><th scope="col">游戏内操作</th></tr></thead>
      <tbody>{sortedFlightGroups(coverage).map(({row,days:addedDays})=><tr key={row.id}>
        <th scope="row"><strong>{legNumbers(row)}</strong><small>{row.path.join(' → ')} · {departureClock(row)}</small></th>
        <td>{operatingDaysText(addedDays)}</td><td>{assignmentAction(row,aircraft)}</td>
      </tr>)}</tbody>
    </table>}
    {[...days].map(([day,matches])=><div className="planner-preview-day" key={day}>
      <h4>{weekText(day)}</h4>
      <div>{matches.map(match=>{
        const tz = airports.get(match.origin).utcOffsetSeconds;
        const dep = scheduleLocalStamp(match.utc.start,tz), arr = scheduleLocalStamp(match.utc.end,tz);
        const open = expanded===match.id;
        return <article className={open?'planner-preview-item open':'planner-preview-item'} key={match.id}>
          <div className="planner-preview-row">
            <button type="button" className="planner-preview-toggle" aria-expanded={open} onClick={()=>setExpanded(open?null:match.id)}>
              <RouteLabel row={match.rotation} editAssignment={editsAssignment(match.rotation,aircraft)}/><span className="planner-preview-time">{dep.slice(3)} — {dep.slice(0,2)===arr.slice(0,2)?arr.slice(3):arr}</span><ChevronDown size={15} className="planner-chevron"/>
            </button>
            <button type="button" className="planner-remove" aria-label={'移除 '+weekText(day)+' '+match.rotation.root.outboundNumber} onClick={()=>onRemove(match)}><X size={15}/></button>
          </div>
          {open&&<div className="planner-detail">{editsAssignment(match.rotation,aircraft)&&<EditAssignmentHint aircraft={aircraft}/>}<PublishedWeek row={match.rotation} extraDays={coverage.get(match.rotation.id).days}/><RotationDetail match={match} airports={airports}/></div>}
        </article>;
      })}</div>
    </div>)}
    {!trial.length&&<div className="planner-no-results">当前没有有效的试排航班。</div>}
  </section>;
}

function PublishedWeek({row,extraDays}) {
  const {assignments,operatingDays,occupiedDays} = row.execution;
  const partialDays = occupiedDays.size-operatingDays.size;
  const fit = row.fit;
  const reference = fit.referenceMix?.map(({size,share})=>size+' '+share+'%').join(' / ');
  const capacity = fit.referenceCapacity?.[0]===fit.referenceCapacity?.[1]?fit.referenceCapacity?.[0]:fit.referenceCapacity?.join('–');
  const candidate = fit.candidate;
  const candidateCabins = Object.keys(candidate?.cabins||{}).join('/');
  const longest=weeklySpacing(operatingDays).longest, after=weeklySpacing([...operatingDays,...extraDays]).longest;
  const routeLongest=weeklySpacing(row.routeDays).longest;
  const routeAfter=weeklySpacing([...row.routeDays,...row.matches.filter(match=>extraDays.includes(match.day)).map(match=>match.routeDay)]).longest;
  return <section className="planner-published-week" aria-label="原周班表与机型匹配">
    <div className="planner-week-execution">
      <div className="planner-published-title"><strong>原周班表</strong><span>每周 {operatingDays.size} → {operatingDays.size+extraDays.length} 天</span></div>
      {longest!==null&&after<longest&&<p className="planner-spacing">最长班次间隔 {longest} → {after} 天</p>}
      {routeLongest!==null&&routeAfter<routeLongest&&(routeLongest!==longest||routeAfter!==after)&&<p className="planner-spacing">同航线最长间隔 {routeLongest} → {routeAfter} 天</p>}
      <div className="planner-week-strip" aria-label="按始发地星期对照">
        {DAY_NAMES.map((day,index)=>{
          const tone = operatingDays.has(index)?'existing':occupiedDays.has(index)?'partial':extraDays.includes(index)?'added':'free';
          return <span className={tone} key={day} aria-label={'周'+day+' · '+{existing:'原有班次',partial:'仅部分航段',added:'拟补班',free:'空缺'}[tone]}>{day}</span>;
        })}
      </div>
      <div className="planner-week-key"><span className="existing">原有班次</span>{!!partialDays&&<span className="partial">仅部分航段</span>}<span className="added">拟补班</span></div>
      {assignments.length?<ul className="planner-executions">{assignments.map(assignment=><li key={assignment.aircraftId+':'+assignment.days.join(',')}>
        <span>{operatingDaysText(assignment.days)}</span><strong>{assignment.registration||'注册号待确认'}</strong><span>{assignment.type||'机型待确认'}</span>
        {!!assignment.sectors.length&&<small>仅 {assignment.sectors.join(' / ')}</small>}
      </li>)}</ul>:<p>原班表暂无执飞安排。</p>}
    </div>
    <div className="planner-product">
      <div className="planner-published-title"><strong>机型与客舱</strong><span>{fitLabel(fit)}</span></div>
      <dl>
        <div><dt>拟补班</dt><dd>{[candidate?.sizeLabel,candidate?.capacity?candidate.capacity+' 座':null,candidateCabins].filter(Boolean).join(' · ')||'机型待确认'}</dd></div>
        {fit.source&&<div><dt>{fit.source==='service'?'原执飞机队':'同航线机队'}</dt><dd>{[reference,capacity?capacity+' 座':null].filter(Boolean).join(' · ')}</dd></div>}
      </dl>
      {!fit.source&&<p>暂未看到可对照的执飞机队。</p>}
    </div>
  </section>;
}

function RotationDetail({match,airports}) {
  const {previous,next,before,after,legs,origin} = match;
  const beforeLabel = previous ? `${previous.schedule.inboundNumber || '前序任务'} 抵达` : `${origin} 待命`;
  const afterLabel = next ? `${next.schedule.outboundNumber || '下一任务'} 离港` : `${origin} 待命`;
  const stamp = (seconds, airport) => scheduleLocalStamp(seconds,airports.get(airport).utcOffsetSeconds);
  return <div className="planner-detail-grid"><div className="planner-connection"><span className="planner-detail-label"><Clock3 size={14}/>地面衔接 · {origin}</span><ol>
    <li><i/><div><strong>{beforeLabel}</strong>{previous&&<small>{stamp(previous.end,origin)}</small>}</div><span>{groundTime(before)}</span></li>
    <li className="candidate"><i/><div><strong>补班往返</strong><small>{stamp(match.utc.start,origin)} — {stamp(match.utc.end,origin)}</small></div><span>{minutesText(match.flightMinutes)}飞行</span></li>
    <li><i/><div><strong>{afterLabel}</strong>{next&&<small>{stamp(next.start,origin)}</small>}</div><span>{groundTime(after)}</span></li>
  </ol></div><div className="planner-legs"><span className="planner-detail-label"><Plane size={14}/>补班航段</span><ol>{legs.map((leg,index)=><li key={`${leg.number}:${index}`}><strong>{leg.number}</strong><span>{leg.origin}<ArrowRight size={11}/>{leg.destination}</span><span>{stamp(leg.start,leg.origin)} <i>–</i> {stamp(leg.end,leg.destination)}</span></li>)}</ol></div></div>;
}
