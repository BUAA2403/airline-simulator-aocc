import React,{useMemo,useState} from 'react';
import {ArrowRight,ChevronDown,Copy,Plane,Search} from 'lucide-react';
import {DAY_NAMES} from './timetable.mjs';
import {scheduleLocalStamp} from './schedule-assistant.mjs';
import {buildConsistencyIndex,consistencyAdvice,consistencyTargets} from './schedule-consistency.mjs';

const week=day=>'周'+DAY_NAMES[day];
const numbers=rotation=>[...new Set(rotation.legs.map(leg=>leg.number))].join(' / ');
const seatLabel=span=>span[0]===span[1]?span[0]+' 座':span.join('–')+' 座';
const route=rotation=>rotation.origin+' ↔ '+rotation.destination;
const equipment=profile=>profile.type+' · '+profile.capacity+' 座';
const ideaKey=({duty,idea})=>JSON.stringify([duty.day,idea.tail.id,idea.swap?.rotation.id,idea.swap?.day]);
const timeWindow=(match,airports)=>{
  const tz=airports.get(match.origin).utcOffsetSeconds;
  const dep=scheduleLocalStamp(match.utc.start,tz), arr=scheduleLocalStamp(match.utc.end,tz);
  return dep+' – '+(dep.slice(0,2)===arr.slice(0,2)?arr.slice(3):arr);
};

export default function ScheduleConsistency({assistant,flights}) {
  const index=useMemo(()=>buildConsistencyIndex(assistant,flights),[assistant,flights]);
  const [query,setQuery]=useState(''),[selected,setSelected]=useState(''),[limit,setLimit]=useState(5);
  const input=query.trim().toLowerCase();
  const matching=index.reports.filter(({rotation})=>[numbers(rotation),...rotation.path,
    ...rotation.path.map(code=>assistant.airports.get(code)?.city)].join(' ').toLowerCase().includes(input));
  const service=matching.find(s=>s.rotation.id===selected)||matching[0];
  return <section className="planner-consistency" aria-label="产品一致性优化">
    <div className="planner-recommend-head"><h3>产品一致性优化</h3>
      <label className="planner-search consistency-search"><Search size={15}/><input aria-label="查找待优化航班" placeholder="搜索航班号 / 机场" value={query} onChange={e=>{setQuery(e.target.value);setLimit(5);}}/></label></div>
    <div className="consistency-layout">
      <div className="consistency-service-list" aria-label="待优化航班">
        {matching.slice(0,limit).map(item=><button type="button" key={item.rotation.id} aria-pressed={service?.rotation.id===item.rotation.id} onClick={()=>setSelected(item.rotation.id)}>
          <span><strong>{route(item.rotation)}</strong><small>{numbers(item.rotation)}</small></span>
        </button>)}
        {matching.length>limit&&<button type="button" onClick={()=>setLimit(limit+5)}>查看更多</button>}
      </div>
      {service?<ServiceConsistency key={service.rotation.id} assistant={assistant} index={index} service={service}/>:<div className="planner-no-results">{index.reports.length?'没有符合搜索条件的航班':'当前班表中没有明显的产品差异'}</div>}
    </div>
  </section>;
}

function ServiceConsistency({assistant,index,service}) {
  const [target,setTarget]=useState(''),[selected,setSelected]=useState(''),[copyStatus,setCopyStatus]=useState('');
  const targets=useMemo(()=>consistencyTargets(assistant,service),[assistant,service]);
  const advice=useMemo(()=>consistencyAdvice(assistant,index,service,target),[assistant,index,service,target]);
  const {rotation}=service;
  const feasible=advice.results.flatMap(({duty,ideas})=>ideas.map(idea=>({duty,idea})))
    .sort((a,b)=>b.idea.improvement-a.idea.improvement||+!!a.idea.swap-+!!b.idea.swap||a.duty.day-b.duty.day);
  const selectedPlan=feasible.find(plan=>ideaKey(plan)===selected)||feasible[0];
  const others=feasible.filter(plan=>plan!==selectedPlan), blocked=advice.results.filter(result=>result.blocked);
  const airports=assistant.airports;
  const copy=async()=>{
    const {duty,idea}=selectedPlan;
    const lines=[
      numbers(rotation)+' · '+route(rotation)+' · '+timeWindow(idea.match,airports)+'（当地时间）',
      idea.tail.registration+' 接飞 '+numbers(rotation)+(idea.swap?'，交出 '+numbers(idea.swap.rotation)+' '+timeWindow(idea.swap.match,airports):''),
      duty.aircraft.registration+' 交出 '+numbers(rotation)+(idea.swap?'，接飞 '+numbers(idea.swap.rotation)+' '+timeWindow(idea.swap.match,airports):'，腾出原时段')
    ];
    try{await navigator.clipboard.writeText(lines.join('\n'));setCopyStatus('已复制');}
    catch{setCopyStatus('无法访问剪贴板');}
  };
  return <div className="consistency-service">
    <header className="consistency-service-head"><div><h4>{route(rotation)}</h4><span>{numbers(rotation)}{rotation.path.length>2?' · 经停 '+rotation.path.slice(1,-1).join(' / '):''}</span></div>
      <label className="consistency-target">目标运力<select aria-label="目标运力" value={advice.target.key} onChange={e=>{setTarget(e.target.value);setSelected('');setCopyStatus('');}}>
        {targets.map((option,i)=><option key={option.key} value={option.key}>{option.profile.sizeLabel+' · 约 '+Math.round(option.profile.capacity/10)*10+' 座'+(i===0?'（推荐）':'')}</option>)}
      </select></label>
    </header>
    {selectedPlan?<PlanPreview plan={selectedPlan} target={advice.target.profile} rotation={rotation} airports={airports} onCopy={copy} copyStatus={copyStatus}/>:
      <div className="consistency-unavailable"><strong>{advice.results.length?'暂无可直接调整的方案':'各执飞日已接近目标运力'}</strong></div>}
    {!!others.length&&<details className="consistency-disclosure"><summary>其他可行方案 <small>{others.length} 项</small><ChevronDown size={14}/></summary>
      <div className="consistency-ideas">{others.map(plan=><button type="button" className="planner-outline" onClick={e=>{e.currentTarget.closest('details').open=false;setSelected(ideaKey(plan));setCopyStatus('');}} key={ideaKey(plan)}>
        {week(plan.duty.day)} · {plan.idea.swap?'互换':'换成'} {plan.idea.tail.registration}<ArrowRight size={13}/>
      </button>)}</div></details>}
    <details className="consistency-disclosure"><summary>查看原周班表 <small>{seatLabel(service.seatSpan)}</small><ChevronDown size={14}/></summary>
      <div className="consistency-week" aria-label="原周执飞">
        {DAY_NAMES.map((_,day)=>{
          const duty=service.duties.find(item=>item.day===day);
          return <div key={day}><span>{week(day)}</span>{duty?<><strong>{duty.profile.capacity} 座</strong><small>{duty.aircraft.registration}<br/>{duty.profile.type}</small></>:
            <small>{rotation.execution.occupiedDays.has(day)?'分配待核对':'未排班'}</small>}</div>;
        })}
      </div>
      {blocked.map(({duty,blocked:reason})=><p className="consistency-note" key={duty.day}>{week(duty.day)} · {reason==='schedule'?'合适飞机的轮转时段冲突':'相近配置无法覆盖各舱计划载客'}</p>)}
    </details>
  </div>;
}

function PlanPreview({plan,target,rotation,airports,onCopy,copyStatus}) {
  const {duty,idea}=plan;
  const primary={rotation,match:idea.match};
  const swap=idea.swap?{rotation:idea.swap.rotation,match:idea.swap.match}:null;
  const receiverBefore=swap||{match:idea.match};
  const originalAfter=swap||{match:idea.releasedMatch};
  return <section className="consistency-preview" aria-label="产品优化预览">
    <header className="consistency-plan-head"><div><p>{week(duty.day)} · {swap?'互换建议':'换机建议'}</p><h5>{duty.aircraft.registration}<ArrowRight size={18}/><span>{idea.tail.registration}</span></h5></div>
      <button type="button" className="planner-outline" onClick={onCopy}><Copy size={14}/>复制方案</button></header>
    <div className="consistency-impact"><span>{duty.profile.capacity} → <strong>{idea.profile.capacity} 座</strong></span><span>目标约 {Math.round(target.capacity/10)*10} 座</span></div>
    <div className="consistency-changes">
      <TailChange title="原执飞飞机" aircraft={duty.aircraft} profile={duty.profile} before={primary} after={originalAfter} airports={airports}/>
      <TailChange title="接飞飞机" aircraft={idea.tail} profile={idea.profile} before={receiverBefore} after={primary} airports={airports}/>
    </div>
    {!!copyStatus&&<small role="status">{copyStatus}</small>}
  </section>;
}

function TailChange({title,aircraft,profile,before,after,airports}) {
  const {previous,next,origin}=after.match;
  const tz=airports.get(origin).utcOffsetSeconds;
  return <div className="consistency-tail">
    <div className="consistency-tail-head"><Plane size={15}/><div><small>{title}</small><strong>{aircraft.registration}</strong><span>{equipment(profile)}</span></div></div>
    <dl>{[['调整前',before],['调整后',after]].map(([label,task])=><div key={label}>
      <dt>{label}</dt><dd><strong>{task.rotation?numbers(task.rotation):'地面空档'}</strong><span>{task.rotation?route(task.rotation):task.match.origin} · {timeWindow(task.match,airports)}</span></dd>
    </div>)}</dl>
    {(previous||next)&&<details className="consistency-neighbors"><summary>调整后的前后任务</summary>
      <div>{previous&&<span>前班 {previous.schedule.inboundNumber||'—'} 抵达 {scheduleLocalStamp(previous.end,tz)}</span>}
      {next&&<span>后班 {next.schedule.outboundNumber||'—'} 离港 {scheduleLocalStamp(next.start,tz)}</span>}</div></details>}
  </div>;
}
