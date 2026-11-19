import {airlineBases} from '../server/bases.mjs';
export const byId=rows=>[...new Map(rows.map(r=>[r.id,r])).values()];
export function trafficSnapshot(snapshot,scope='all'){
 if(!snapshot)return null;
 const shared=snapshot.codeshares||{},own=scope!=='shared',partners=scope!=='own';
 const flights=byId([...(own?snapshot.flights:[]),...(partners?shared.flights||[]:[])]);
 const routes=byId([...(own?snapshot.routes:[]),...(partners?(shared.routes||[]).map(r=>({...r,id:`codeshare:${r.id}`,isCodeshare:true})):[])]);
 const used=new Set([...routes,...flights].flatMap(f=>[f.origin,f.destination]));
 const airports=byId([...snapshot.airports,...shared.airports||[]]).filter(a=>used.has(a.id)||used.has(a.iata)||own&&airlineBases(snapshot.airline,snapshot.airports).includes(a.id));
 return {...snapshot,flights,routes,airports,aircraft:byId([...(own?snapshot.aircraft:[]),...(partners?shared.aircraft||[]:[])])};
}
export function codeshareContext(f,snapshot){
 return (snapshot?.codeshares?.agreements||[]).filter(c=>c.operatingFlightId===f.scheduleId&&(f.isCodeshare?c.role==='marketing':c.role==='operating'));
}
