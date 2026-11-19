// A base comes from airline configuration, never from a flight's destination
// or an aircraft's current location. Legacy snapshots retain their single hub.
export function airlineBases(airline={},airports=[]){
 const stations=new Map(airports.flatMap(a=>[[a.id,a.id],[a.iata,a.id]]));
 const supplied=Array.isArray(airline.hubs)?airline.hubs.filter(x=>typeof x==='string'&&x.trim()):[];
 const source=supplied.length?supplied:[airline.hub].filter(x=>typeof x==='string'&&x.trim());
 return [...new Set(source.map(x=>stations.get(x.trim())||x.trim()))];
}
export const baseLabel=(base,primary)=>`${base} ${base===primary?'主基地':'基地'}`;
export function aircraftBase(aircraft,airline={},airports=[]){
 const home=aircraft?.homeBase;
 const stations=new Map(airports.flatMap(a=>[[a.id,a.id],[a.iata,a.id]]));
 return typeof home==='string'&&home?(stations.get(home)||home):airlineBases(airline,airports)[0]||'';
}
