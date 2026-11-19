import React,{useMemo,useState,useRef} from 'react';
import {feature} from 'topojson-client';
import {geoPath,geoGraticule10} from 'd3-geo';
import countries from 'world-atlas/countries-110m.json';
import {Plus,Minus,Focus,Globe2,Maximize2,Minimize2} from 'lucide-react';
import {makeProjection,routeLine} from './map-geometry.mjs';
import {position} from '../server/geometry.mjs';
const land=feature(countries,countries.objects.countries);
const graticule=geoGraticule10();
export default function AircraftReplayMap({week,frame,cursor,airports,playing,expanded,onExpand,finished}){
 const [center,setCenter]=useState(150),[manual,setManual]=useState(null),[dragging,setDragging]=useState(false),drag=useRef(null);
 const projection=useMemo(()=>makeProjection(center),[center]),path=useMemo(()=>geoPath(projection),[projection]);
 const landPaths=useMemo(()=>land.features.map(f=>path(f)),[path]),gridPath=useMemo(()=>path(graticule),[path]);
 const stations=useMemo(()=>week.airports.map(id=>airports[id]).filter(a=>a&&Number.isFinite(a.lat)&&Number.isFinite(a.lon)),[week.airports,airports]);
 const points=stations.map(a=>projection([a.lon,a.lat]));
 const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
 const fit=points.length?{x:(Math.min(...xs)+Math.max(...xs))/2,y:(Math.min(...ys)+Math.max(...ys))/2,zoom:Math.max(1,Math.min(5,850/Math.max(100,Math.max(...xs)-Math.min(...xs)),340/Math.max(80,Math.max(...ys)-Math.min(...ys))))}:{x:510,y:247,zoom:1};
 const view=manual||fit,scale=view.zoom;
 const arcs=useMemo(()=>[...new Map(week.tasks.map(f=>[`${f.origin}|${f.destination}`,{origin:f.origin,destination:f.destination}])).values()].map(r=>({...r,path:routeLine(airports[r.origin],airports[r.destination],projection)})),[week.tasks,airports,projection]);
 const completed=new Set(week.tasks.filter(f=>f.end<=cursor).map(f=>`${f.origin}|${f.destination}`));
 const active=frame.phase==='airborne'?frame.task:null,activePath=arcs.find(r=>r.origin===frame.task?.origin&&r.destination===frame.task?.destination)?.path,point=frame.coordinates?projection([frame.coordinates.lon,frame.coordinates.lat]):null;
 let angle=0;
 if(active&&airports[active.origin]&&airports[active.destination]){
  const a=position(airports[active.origin],airports[active.destination],Math.max(0,frame.progress-.002)),b=position(airports[active.origin],airports[active.destination],Math.min(1,frame.progress+.002));
  const p=projection([a.lon,a.lat]),q=projection([b.lon,b.lat]);angle=Math.atan2(q[1]-p[1],q[0]-p[0])*180/Math.PI+90;
 }
 const labels=new Map(),occupied=[];
 for(const a of [...stations].sort((a,b)=>Number(b.id===active?.origin||b.id===active?.destination||b.id===frame.location)-Number(a.id===active?.origin||a.id===active?.destination||a.id===frame.location))){
  const p=projection([a.lon,a.lat]),x=(p[0]-view.x)*scale+510,y=(p[1]-view.y)*scale+247;
  for(const [dx,dy] of [[9,-8],[9,17],[-36,-8],[-36,17]]){
   const rect={x:x+dx,y:y+dy-11,w:32,h:15};
   if(occupied.some(b=>rect.x<b.x+b.w&&rect.x+rect.w>b.x&&rect.y<b.y+b.h&&rect.y+rect.h>b.y))continue;
   occupied.push(rect);labels.set(a.id,{dx,dy});break;
  }
 }
 const zoom=delta=>setManual({...view,zoom:Math.max(.8,Math.min(8,scale*delta))});
 return <div className={`aircraft-replay-map ${dragging?'dragging':''}`}>
  <div className="replay-map-toolbar"><span><i/>{finished?'本周回放结束':active?'航段飞行':frame.phase==='complete'?'回放完成':frame.phase==='ground'?'地面等待':'周航迹'}</span><div><select aria-label="回放地图视角" value={center} onChange={e=>{setCenter(Number(e.target.value));setManual(null);}}><option value={150}>太平洋视角</option><option value={0}>大西洋视角</option></select><button onClick={onExpand} aria-label={expanded?'收起回放地图':'展开回放地图'}>{expanded?<Minimize2 size={15}/>:<Maximize2 size={15}/>}</button></div></div>
  <svg viewBox="0 0 1020 494" role="img" aria-label="该飞机每周航迹回放地图，可缩放和拖动" onPointerDown={e=>{if(e.button!==0)return;const r=e.currentTarget.getBoundingClientRect();drag.current={x:e.clientX,y:e.clientY,view,ratio:1020/r.width};e.currentTarget.setPointerCapture(e.pointerId);setDragging(true);}} onPointerMove={e=>{if(!drag.current)return;const d=drag.current;setManual({...d.view,x:d.view.x-(e.clientX-d.x)*d.ratio/d.view.zoom,y:d.view.y-(e.clientY-d.y)*d.ratio/d.view.zoom});}} onPointerUp={()=>{drag.current=null;setDragging(false);}} onPointerCancel={()=>{drag.current=null;setDragging(false);}}>
   <g transform={`translate(510 247) scale(${scale}) translate(${-view.x} ${-view.y})`}>
    <path className="replay-graticule" d={gridPath} strokeWidth={.5/scale}/>
    {landPaths.map((d,i)=><path key={i} className="replay-land" d={d} strokeWidth={.55/scale}/>)}
    {arcs.map(r=>{const d=r.path;return d?<path key={`${r.origin}-${r.destination}`} d={d} className={`replay-arc ${completed.has(`${r.origin}|${r.destination}`)?'completed':''}`} strokeWidth={1.5/scale}/>:null;})}
    {active&&<><path className="replay-active-halo" d={activePath} strokeWidth={8/scale}/><path className="replay-active-arc" d={activePath} strokeWidth={2/scale}/></>}
    {stations.map(a=>{const p=projection([a.lon,a.lat]),selected=active&&(a.id===active.origin||a.id===active.destination)||frame.location===a.id;return <g key={a.id} transform={`translate(${p[0]} ${p[1]}) scale(${1/scale})`} className={`replay-airport ${selected?'selected':''}`}><circle r={selected?5:3}/><text x={labels.get(a.id)?.dx||9} y={labels.get(a.id)?.dy||-8} style={{display:labels.has(a.id)?undefined:'none'}}>{a.iata||a.id}</text></g>;})}
    {point&&<g transform={`translate(${point[0]} ${point[1]}) scale(${1/scale})`} className={`replay-aircraft ${playing?'playing':''}`}><circle className="replay-plane-glow" r="23"/><circle className="replay-plane-ring" r="15"/><path transform={`rotate(${angle})`} d="M0 -12 L3 -3 L12 3 L12 6 L2 3 L2 9 L5 12 L5 14 L0 12 L-5 14 L-5 12 L-2 9 L-2 3 L-12 6 L-12 3 L-3 -3Z"/><text x="19" y="27">{active?.number||frame.location||''}</text></g>}
   </g>
  </svg>
  {!points.length&&<div className="replay-map-empty">暂无可用航迹</div>}
  <div className="replay-map-zoom"><button aria-label="放大回放地图" onClick={()=>zoom(1.4)}><Plus size={16}/></button><button aria-label="缩小回放地图" onClick={()=>zoom(1/1.4)}><Minus size={16}/></button><button aria-label="适配全部周航迹" onClick={()=>setManual(null)}><Focus size={16}/></button><button aria-label="回放地图显示全球" onClick={()=>setManual({x:510,y:247,zoom:1})}><Globe2 size={16}/></button></div>
  <div className="replay-map-key"><span><i/>已执行</span><span><i/>后续航段</span><span>周计划回放 · 航迹按计划推算</span></div>
 </div>;
}
