import {CABINS} from './cabin-groups.mjs';
import {aircraftProfile,engineStations} from './aircraft-catalog.mjs';
export function cabinGeometry(a){
 let cursor=176,rowNumber=1,seatSpan=0;
 const sections=[];
 for(const k of CABINS){
  const c=a?.cabins?.[k];if(!Number.isInteger(c?.numSeats)||c.numSeats<=0)continue;
  const groups=String(c.config||'').split('-').map(Number);
  if(!groups.length||groups.some(n=>!Number.isInteger(n)||n<1||n>12)||groups.reduce((x,y)=>x+y,0)>20)continue;
  const across=groups.reduce((x,y)=>x+y,0),span=across*7+(groups.length-1)*9;
  seatSpan=Math.max(seatSpan,span);
  const start=cursor,rows=[];let left=c.numSeats;
  // Count seats from the actual configuration, including a partial final row.
  for(let r=0;r<Math.ceil(c.numSeats/across)&&r<1000;r++){
   const seats=[];let y=-span/2;
   for(const group of groups){for(let j=0;j<group&&left>0;j++,left--){seats.push({x:cursor,y});y+=7;}y+=9;}
   rows.push({number:rowNumber++,x:cursor,seats});cursor+=k==='eco'?11:k==='premEco'?14:21;
  }
  sections.push({k,c,rows,start,end:cursor,span});cursor+=18;
 }
 for(const section of sections){section.seatScale=seatSpan/section.span;for(const row of section.rows)for(const seat of row.seats)seat.y*=section.seatScale;}
 const profile=aircraftProfile(a),width=Math.max(480,cursor+125),half=Math.max(42,seatSpan/2+23),center=half+116,height=center*2;
 return {sections,width,half,center,height,profile,engines:engineStations(profile,width,center,half)};
}
