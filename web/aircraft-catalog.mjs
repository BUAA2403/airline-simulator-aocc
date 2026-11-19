import types from '../server/data/aircraft-types.json' with {type:'json'};
import assets from './aircraft-assets.json' with {type:'json'};

const key=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
// Physical families are independent of the game's seat-product/icon classes.
const families=[
 ['A380',/A38[08]/,4,'wing','jet','full'],['B747',/(?:BOEING)?747|B74[48]/,4,'wing','jet','partial'],
 ['A340',/A34[036]/,4,'wing','jet'],['ATR',/ATR|AT[47]6/,2,'wing','prop'],
 ['DASH8',/DASH8|DH8[A-D]/,2,'wing','prop'],
 ['B717',/(?:BOEING)?717|B712/,2,'rear','jet'],['CRJ',/CRJ/,2,'rear','jet'],
 ['ARJ21',/ARJ21|AJ27|C909/,2,'rear','jet'],['ERJ',/ERJ1[345]|E1[34][05]|E45X/,2,'rear','jet'],
 ['A220',/A220|BCS[13]/,2,'wing','jet'],['A320',/A3(?:1[89]|2[01])|A(?:19|20|21)N/,2,'wing','jet'],
 ['A330',/A33[02389]/,2,'wing','jet'],['A350',/A35[09K]/,2,'wing','jet'],
 ['B737',/(?:BOEING)?737|B73[6-9]|B3[789X]M/,2,'wing','jet'],
 ['B757',/(?:BOEING)?757|B75[23]/,2,'wing','jet'],['B767',/(?:BOEING)?767|B76[34]/,2,'wing','jet'],
 ['B777',/(?:BOEING)?777|B77[239LW]/,2,'wing','jet'],['B787',/(?:BOEING)?787|B78[89X]/,2,'wing','jet'],
 ['C919',/C919/,2,'wing','jet'],['EJET',/EMBRAERE1[789]|E1[789][05]|E29[05]/,2,'wing','jet'],
 ['SSJ',/SUPERJET|SU95|SSJ100/,2,'wing','jet'],
];
const exact=new Map(types.map(t=>[key(t.aircraft_model),t]));
export function aircraftProfile(aircraft){
 const name=typeof aircraft==='string'?aircraft:aircraft?.type||aircraft?.aircraft_model||aircraft?.aircraft_code;
 const normalized=key(name),record=exact.get(normalized);
 const codeMatches=types.filter(t=>key(t.aircraft_code)===normalized);
 const data=record||(codeMatches.length===1?codeMatches[0]:null);
 const family=families.find(([,pattern])=>pattern.test(normalized));
 return {known:!!family,match:record?'model':data?'icao':family?'family':'unknown',family:family?.[0]||'UNKNOWN',engines:family?.[2]??null,mount:family?.[3]??null,propulsion:family?.[4]??null,deck:family?.[5]||'single',tail:family?.[3]==='rear'||family?.[0]==='DASH8'?'T':'conventional',length:data?.length??null,wingspan:data?.wingspan??null,cabinWidth:data?.cabin_width??null,maxAbreast:data?.max_abreast??null,image:data?assets[data.aircraft_model]||null:null};
}
export function engineStations(profile,width,center=155,half=48){
 if(!profile.engines)return [];
 const spans=profile.engines===4?[.3,.73]:[.41];
 return spans.flatMap(t=>[-1,1].map(side=>{
  const rear=profile.mount==='rear',distance=rear?half+10:half-4+96*t;
  // Locate each nacelle from the same leading edge used by the wing polygon.
  // The aft nacelle overlaps that edge; the pylon extends into the wing.
  const leading=width*(profile.propulsion==='prop'?.4+.03*t:.37+.19*t);
  const x=rear?width-150:leading-9,y=center+side*distance;
  return {x,y,side,propeller:profile.propulsion==='prop',pylon:rear?{x1:x+4,y1:center+side*(half-3),x2:x+12,y2:y}:{x1:leading-2,y1:y,x2:leading+22,y2:y},leadingEdgeX:rear?null:leading};
 }));
}
export function wingOutline(profile,width,center,half,side){
 const y=d=>center+side*d;
 return profile.propulsion==='prop'?`M${width*.4} ${y(half-4)} L${width*.43} ${y(half+92)} L${width*.49} ${y(half+92)} L${width*.51} ${y(half-4)}Z`:`M${width*.37} ${y(half-4)} L${width*.56} ${y(half+92)} L${width*.6} ${y(half+92)} L${width*.54} ${y(half+18)} L${width*.54} ${y(half-4)}Z`;
}
