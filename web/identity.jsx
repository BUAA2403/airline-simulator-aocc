import React from 'react';
import {Plane} from 'lucide-react';

export const VIEW_IDENTITY={
 control:['01','OPERATIONS','FLIGHT CONTROL'],map:['01','GLOBAL ATLAS','LIVE NETWORK'],overview:['01','DAILY BRIEF','OPERATIONS INTELLIGENCE'],
 fleet:['02','FLEET DISPATCH','AIRCRAFT & ROTATIONS'],cabins:['02','CABIN ATELIER','SEATS & CAPACITY'],planner:['02','SCHEDULE ASSISTANT','FLEET PLANNING'],
 routes:['03','NETWORK ATLAS','ROUTES & REACH'],timetable:['03','FLIGHT SCHEDULE','WEEKLY PUBLICATION'],
 analytics:['04','PERFORMANCE','COMMERCIAL INTELLIGENCE'],connection:['05','DATA SERVICES','CONNECTION & ARCHIVE'],
};

export function PolarisMark(){return <svg viewBox="0 0 52 52" className="polaris-mark" aria-hidden="true"><circle cx="26" cy="26" r="22" fill="none" stroke="currentColor" strokeWidth=".6" opacity=".4"/><path d="M26 1 31 21 51 26 31 31 26 51 21 31 1 26 21 21Z" fill="currentColor"/><path d="m26 11 2.8 12.2L41 26l-12.2 2.8L26 41l-2.8-12.2L11 26l12.2-2.8Z" fill="#10191f"/><circle cx="26" cy="26" r="2.5" fill="currentColor"/></svg>;}

export function StationIdentity({hub,airport,connected}){return <div className="station-identity"><div className="station-label"><span>HOME STATION</span><span className={connected?'station-signal live':'station-signal'} aria-label={connected?'数据连接正常':'数据未连接'}><i/><i/><i/></span></div><div className="station-code">{hub||'—'}<svg viewBox="0 0 68 38" aria-hidden="true"><path d="M4 32Q34-13 64 32M4 32H64M34 5V35" fill="none" stroke="currentColor" strokeWidth=".7"/><circle cx="34" cy="18" r="2" fill="currentColor"/><path d="M22 30 34 18 48 26" fill="none" stroke="currentColor" strokeWidth=".7"/></svg></div><p>{airport?.city||'本地工作台'}<span>运行控制中心</span></p></div>;}

export function ViewTitle({view,title,description}){const [index,name,caption]=VIEW_IDENTITY[view];return <div className="view-title"><div className="eyebrow"><span className="view-index">{index}</span>{caption}</div><h1>{title}</h1><div className="view-subtitle"><span className="view-english">{name}</span><span className="view-description">{description}</span></div></div>;}

export function FlightArc({progress}){const known=Number.isFinite(progress),p=known?Math.max(0,Math.min(1,progress)):.5,x=8+134*p,y=50-132*p*(1-p),angle=Math.atan2(-132+264*p,134)*180/Math.PI+45;return <svg className="flight-arc" viewBox="0 0 150 67" aria-hidden="true"><path className="flight-arc-baseline" d="M8 50H142"/><path className="flight-arc-track" d="M8 50Q75 -16 142 50" pathLength="1"/>{known&&<path className="flight-arc-progress" d="M8 50Q75 -16 142 50" pathLength="1" strokeDasharray={`${p} 1`}/>}<circle className="flight-arc-station" cx="8" cy="50" r="2.5"/><circle className="flight-arc-station" cx="142" cy="50" r="2.5"/><g transform={`translate(${x} ${y}) rotate(${angle})`}><circle className="flight-arc-halo" r="11"/><Plane size={17} x={-8.5} y={-8.5}/></g></svg>;}
