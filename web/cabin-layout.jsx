import React,{useState,useMemo,useEffect,useId} from 'react';
import {X,Plane,Layers3,ChevronRight,Maximize2,Users,Armchair} from 'lucide-react';
import {downloadCsv} from './dispatch.mjs';
import {CABINS,groupCabins} from './cabin-groups.mjs';
import {cabinGeometry} from './cabin-geometry.mjs';
import {wingOutline} from './aircraft-catalog.mjs';
import {CabinNose,SeatSymbol} from './cabin-template.jsx';
import './cabin-plan.css';
export const CABIN_NAMES={first:'头等舱',biz:'公务舱',premEco:'超级经济舱',eco:'经济舱'};
export const PRODUCTS={super_slim:'超薄座椅',slim:'轻薄座椅',standard:'标准座椅',comfort:'舒适座椅',luxury:'豪华座椅',basic:'基础座椅',european:'欧洲式公务',regional:'区域型座椅',full_flat:'全平躺',parallel_flat:'并列平躺',staggered:'交错式',reverse_herringbone:'反鱼骨',comfort_suite:'舒适套间',studio_suite:'工作室套间',suite:'独立套间',staggered_suite:'交错式套间',wide_suite:'宽体套间',premium_herringbone:'尊享鱼骨',solo_suite:'独立套间',open_suite:'开放套间',diagonal_suite:'斜向套间',private_suite:'私密套间',premium_suite:'尊享套间',apartment:'空中公寓',room_suite:'房间套间'};
const COLORS={first:'#d9b66b',biz:'#ac9aeb',premEco:'#72b8d1',eco:'#67cbb0'};
const SEAT_INK={first:'#d9b66b',biz:'#ac9aeb',premEco:'#72b8d1',eco:'#67cbb0'};
const photo=(k,c={})=>`/game-assets/seat-photos/${k==='premEco'?'prem_eco':k}_${c.seatProduct}.jpg`;
export function CabinLayout({aircraft:a,compact=false,onCabin}){
 const Legend=onCabin?'button':'span',paintId=useId().replace(/:/g,'');
 const [zoom,setZoom]=useState(1),[view,setView]=useState('all');
 const {sections,width,height,center,half,profile,engines}=cabinGeometry(a);
 const top=center-half,bottom=center+half,interactive=!!onCabin&&!compact,focus=interactive&&sections.find(s=>s.k===view);
 const viewWidth=focus?Math.max(450,focus.end-focus.start+44):width,viewStart=focus?Math.max(0,(focus.start+focus.end-viewWidth)/2):0;
 const choose=k=>{if(interactive){setView(k);setZoom(1);}onCabin?.(k);};
 return <div className={`cabin-layout cabin-plan ${compact?'compact':''}`}>
  {interactive&&<div className="cabin-plan-tools"><div><button className={view==='all'?'active':''} onClick={()=>{setView('all');setZoom(1);}}>全舱布局</button>{sections.map(s=><button key={s.k} className={view===s.k?'active':''} onClick={()=>choose(s.k)}>{CABIN_NAMES[s.k]}</button>)}</div><div className="plan-zoom"><button aria-label="缩小客舱图" disabled={zoom<=1} onClick={()=>setZoom(v=>Math.max(1,v-.5))}>−</button><span>{Math.round(zoom*100)}%</span><button aria-label="放大客舱图" disabled={zoom>=3} onClick={()=>setZoom(v=>Math.min(3,v+.5))}>＋</button></div></div>}
  <div className="cabin-plan-viewport"><svg className="cabin-plan-svg" style={{width:`${zoom*100}%`}} viewBox={`${viewStart} ${focus?top-24:0} ${viewWidth} ${focus?half*2+48:height}`} role="img" aria-label={`${a?.registration||a?.type} 客舱平面图，${a?.capacity||0} 个座位`}>
   <defs>{CABINS.map(k=><SeatSymbol key={k} cabin={k} id={`seat-${paintId}-${k}`}/>)}</defs>
   {!focus&&<g className="plan-airframe">
    {[-1,1].map(side=><g key={side}>
     <path className="plan-wing" d={wingOutline(profile,width,center,half,side)}/>
     <path className="plan-tail" d={`M${width-136} ${center+side*(half*.42)} L${width-59} ${center+side*(half+30)} L${width-34} ${center+side*(half+30)} L${width-87} ${center+side*(half*.25)}Z`}/>
    </g>)}
    {engines.map((e,i)=><g key={i} className="plan-engine" data-engine={i+1}><path className="plan-pylon" d={`M${e.pylon.x1} ${e.pylon.y1} L${e.pylon.x2} ${e.pylon.y2}`}/><g transform={`translate(${e.x},${e.y})`}><path className="plan-nacelle" d="M-18 -7 C-24 -7 -25 -4 -25 0 S-24 7 -18 7 L11 5 Q18 0 11 -5Z"/><ellipse className="plan-intake" cx="-20" cy="0" rx="2.1" ry="5.1"/><path className="plan-engine-seam" d="M-12 -4H7M-12 4H7"/>{e.propeller&&<path className="plan-propeller" d="M-27 -17V17"/>}</g></g>)}
   </g>}
   <path className="plan-floor" d={`M159 ${top+.75} H${width-108} Q${width-67} ${top+.75} ${width-43} ${center-17} Q${width-28} ${center} ${width-43} ${center+17} Q${width-67} ${bottom-.75} ${width-108} ${bottom-.75} H159Z`}/>
   <path className="plan-body-rail" d={`M159 ${top+.75} H${width-108} Q${width-67} ${top+.75} ${width-43} ${center-17} Q${width-28} ${center} ${width-43} ${center+17} Q${width-67} ${bottom-.75} ${width-108} ${bottom-.75} H159`}/>
   <CabinNose family={profile.family} x={20} y={top} width={140} height={half*2}/>
   <g className="plan-window-markers">{Array.from({length:Math.max(0,Math.floor((width-285)/13))},(_,i)=><g key={i}><rect x={177+i*13} y={top+2} width="4" height="2" rx="1"/><rect x={177+i*13} y={bottom-4} width="4" height="2" rx="1"/></g>)}</g>
   {sections.map(({k,c,rows,start,end,seatScale})=><g key={k} className={`cabin-zone plan-zone ${focus&&focus.k!==k?'muted':''}`} role={onCabin?'button':undefined} tabIndex={onCabin?0:undefined} aria-label={`${CABIN_NAMES[k]} ${c.numSeats} 座`} onClick={()=>choose(k)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(k);}}}>
    <rect x={start-5} y={top+9} width={end-start+7} height={half*2-18} fill={COLORS[k]} opacity=".08" rx="5"/>
    {rows.map(row=><g key={row.number}><text className="plan-row-number" x={row.x+4} y={bottom-7} textAnchor="middle">{row.number}</text>{row.seats.map((s,i)=><g key={i} transform={`translate(${s.x},${center+s.y+6*seatScale}) rotate(-90)`}><use href={`#seat-${paintId}-${k}`} width={6*seatScale} height={k==='first'?16:k==='biz'?14:k==='premEco'?11:8} preserveAspectRatio="none" style={{color:SEAT_INK[k]}}/></g>)}</g>)}
    <text className="plan-zone-label" x={(start+end)/2} y={top+13} textAnchor="middle" style={{color:COLORS[k]}}>{k==='first'?'F':k==='biz'?'J':k==='premEco'?'W':'Y'} · {c.numSeats}</text>
   </g>)}
  </svg></div>
  <div className="cabin-layout-legend">{sections.map(({k,c})=><Legend key={k} onClick={onCabin?()=>choose(k):undefined}><i style={{background:COLORS[k]}}/>{CABIN_NAMES[k]} <b>{c.numSeats}</b></Legend>)}</div>
 </div>;
}
export function CabinDetail({aircraft:a,members=[a],onClose}){
 const [selected,setSelected]=useState(()=>CABINS.find(k=>a.cabins?.[k]?.numSeats)||'eco');const c=a.cabins?.[selected];
 useEffect(()=>{const before=document.body.style.overflow;document.body.style.overflow='hidden';const close=e=>{if(e.key==='Escape'){e.stopImmediatePropagation();onClose();}};window.addEventListener('keydown',close,true);return()=>{document.body.style.overflow=before;window.removeEventListener('keydown',close,true);};},[]);
 return <><button className="drawer-backdrop cabin-backdrop" aria-label="关闭客舱布局" onClick={onClose}/><aside className="cabin-detail modal-surface" role="dialog" aria-modal="true" aria-labelledby="cabin-title"><header className="drawer-title"><div><span className="eyebrow">CABIN CONFIGURATION</span><h2 id="cabin-title">{a.type}</h2><p>{members.length} 架飞机 · {a.capacity} 座</p></div><button className="icon-button" aria-label="关闭客舱布局" onClick={onClose}><X size={20}/></button></header><CabinLayout aircraft={a} onCabin={setSelected}/>{c?.numSeats?<div className="cabin-product"><img onError={e=>{e.currentTarget.hidden=true;}} src={photo(selected,c)} alt={`${CABIN_NAMES[selected]} · ${PRODUCTS[c.seatProduct]||c.seatProduct}`}/><div><small>{CABIN_NAMES[selected]}</small><h3>{PRODUCTS[c.seatProduct]||c.seatProduct}</h3><dl><div><dt>座位数</dt><dd>{c.numSeats}</dd></div><div><dt>座椅布局</dt><dd>{c.config}</dd></div><div><dt>排数</dt><dd>{c.numRows}</dd></div><div><dt>座椅间距</dt><dd>{c.pitch}″</dd></div></dl></div></div>:<p className="empty-state">客舱配置暂未提供</p>}<section className="assigned-tails"><h3>采用此配置的飞机</h3><div>{members.map(m=><span key={m.id}><Plane size={13}/>{m.registration}</span>)}</div></section></aside></>;
}
export function CabinInventory({aircraft,search,setSearch}){
 const [merged,setMerged]=useState(true),[detail,setDetail]=useState(null);
 const groups=useMemo(()=>groupCabins(aircraft),[aircraft]);
 const rows=(merged?groups:aircraft.map(a=>({...a,key:a.id,members:[a]}))).filter(a=>[a.type,...a.members.map(m=>m.registration)].join(' ').toLowerCase().includes(search.toLowerCase()));
 const seats=CABINS.map(k=>({k,value:aircraft.reduce((n,a)=>n+(a.cabins?.[k]?.numSeats||0),0)})),total=seats.reduce((n,s)=>n+s.value,0);
 return <><div className="cabin-stats">{[['机队规模',aircraft.length,'架'],['客舱配置',groups.length,'种'],['总座位数',total.toLocaleString(),'座'],['平均单机运力',aircraft.length?Math.round(total/aircraft.length):0,'座']].map(([label,v,u])=><div key={label}><span>{label}</span><strong>{v}<small>{u}</small></strong></div>)}</div><section className="panel capacity-summary"><div className="panel-title"><h2>舱等运力分布</h2><span>全机队</span></div><div className="capacity-stack">{seats.filter(s=>s.value).map(({k,value})=><i key={k} style={{flex:value,background:COLORS[k]}} title={`${CABIN_NAMES[k]} ${value} 座`}/>)}</div><div className="capacity-legend">{seats.map(({k,value})=><div key={k}><i style={{background:COLORS[k]}}/><span>{CABIN_NAMES[k]}</span><strong>{value.toLocaleString()}</strong><small>{total?(value/total*100).toFixed(1):0}%</small></div>)}</div></section><section className="panel cabin-inventory"><div className="panel-title"><h2>客舱配置库</h2><span>{rows.length} {merged?'种配置':'架飞机'}</span></div><div className="board-toolbar"><label className="search-input"><input aria-label="搜索客舱飞机" placeholder="注册号 / 机型" value={search} onChange={e=>setSearch(e.target.value)}/></label><label className="merge-toggle"><input type="checkbox" checked={merged} onChange={e=>setMerged(e.target.checked)}/>合并相同配置</label><button className="text-button" onClick={()=>downloadCsv('aocc-cabins.csv',[['注册号','机型','总座位','F','J','W','Y'],...aircraft.map(a=>[a.registration,a.type,a.capacity,...CABINS.map(k=>a.cabins?.[k]?.numSeats)])])}>导出清单</button></div><div className="cabin-grid">{rows.map(a=><article key={a.key} className="cabin-card layout-card"><header><div><strong>{a.type}</strong><small>{a.members.length} 架 · {a.members.map(m=>m.registration).join(' / ')}</small></div><b>{a.capacity}<small> SEATS</small></b></header><button className="layout-preview" aria-label={`查看 ${a.type} ${a.capacity} 座客舱布局`} disabled={!a.cabins} onClick={()=>setDetail(a)}><CabinLayout aircraft={a} compact/><span><Maximize2 size={13}/>查看布局与座椅产品</span></button><div className="layout-specs">{CABINS.filter(k=>a.cabins?.[k]?.numSeats).map(k=><div key={k}><i style={{background:COLORS[k]}}/><span>{CABIN_NAMES[k]}</span><b>{a.cabins[k].numSeats}</b><small>{a.cabins[k].config} · {a.cabins[k].pitch}″</small></div>)}</div></article>)}</div></section>{detail&&<CabinDetail aircraft={detail} members={detail.members} onClose={()=>setDetail(null)}/>}</>;
}
