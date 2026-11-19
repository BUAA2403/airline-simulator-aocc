export const CABINS=['first','biz','premEco','eco'];
export function cabinSignature(a){
 return JSON.stringify([a.type,...CABINS.map(k=>{const c=a.cabins?.[k];return c?.numSeats?[c.numSeats,c.numRows,c.config,c.pitch,c.seatProduct]:[0];})]);
}
export function groupCabins(aircraft){
 const groups=new Map();
 for(const a of aircraft){const key=cabinSignature(a);if(!groups.has(key))groups.set(key,{...a,key,members:[]});groups.get(key).members.push(a);}
 return [...groups.values()];
}
