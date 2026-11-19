import {normalizeGame} from './game-normalize.mjs';

const safeId=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(x);
const object=x=>{if(typeof x==='string'){try{return JSON.parse(x);}catch{return {};}}return x&&typeof x==='object'&&!Array.isArray(x)?x:{};};
const unique=xs=>[...new Set(xs)];

// All partner reads follow an agreement belonging to the verified airline.
// Native evidence: 41957, 42818, 41587, 19376; never enumerate partner fleets.
export async function readCodeshares(read,player,owned){
 const paged=async(table,filters,order)=>{
  const rows=[];
  for(let offset=0;offset<50000;offset+=1000){
   const result=await read(`${table}?${new URLSearchParams({select:'*',...filters,order:`${order}.asc`,limit:'1000',offset:String(offset)})}`);
   if(!Array.isArray(result))throw new Error('Invalid codeshare response');
   rows.push(...result);if(result.length<1000)return rows;
  }throw new Error('Codeshare paging exceeded');
 };
 const uid=String(player.uid),records=new Map();
 for(const field of ['operatingUid','marketingUid'])for(const c of await paged('codeshare_flight_data',{[field]:`eq.${uid}`},'codeshareId')){
  if(c&&(c.operatingUid===uid||c.marketingUid===uid)&&safeId(c.codeshareId)&&safeId(c.operatingFlightId)&&safeId(c.operatingUid)&&safeId(c.marketingUid))records.set(c.codeshareId,c);
 }
 const agreements=[...records.values()],partners=[],flights=[],aircraft=[];
 const operators=unique(agreements.filter(c=>c.marketingUid===uid&&c.operatingUid!==uid).map(c=>c.operatingUid));
 const partnerIds=unique(agreements.map(c=>c.operatingUid===uid?c.marketingUid:c.operatingUid));
 for(const partnerId of partnerIds){
  const result=await read(`rpc/get_player_by_uid?${new URLSearchParams({p_uid:partnerId})}`),p=Array.isArray(result)?result[0]:result;
  if(p?.uid===partnerId)partners.push({uid:partnerId,airlineName:String(p.airlineName||''),airlineCode:String(p.airlineCode||''),hubAirports:Array.isArray(p.hubAirports)?p.hubAirports:[]});
 }
 const idsRead=async(table,key,ids,operator)=>{
  const result=[];ids=unique(ids).filter(safeId);
  for(let i=0;i<ids.length;i+=50){const batch=ids.slice(i,i+50);result.push(...(await paged(table,{uid:`eq.${operator}`,[key]:`in.(${batch.join(',')})`},key)).filter(r=>r.uid===operator&&batch.includes(String(r[key]))));}
  return result;
 };
 for(const operator of operators){
  let pending=agreements.filter(c=>c.operatingUid===operator).map(c=>c.operatingFlightId);const seen=new Set(),rows=[];
  for(let depth=0;pending.length&&depth<8;depth++){
   const batch=await idsRead('new_player_flight_data','flightId',pending.filter(id=>!seen.has(id)),operator);
   pending.forEach(id=>seen.add(id));rows.push(...batch);
   pending=unique(batch.map(f=>f.childStopoverFlightId).filter(id=>safeId(id)&&!seen.has(id)));
  }
  flights.push(...rows);
  aircraft.push(...await idsRead('player_aircraft_data','aircraftId',rows.flatMap(f=>Object.entries(object(f.aircraftAssignments)).map(([id,a])=>a?.aircraftId||id)),operator));
 }
 return {status:'available',agreements,partners,flights,aircraft};
}

export function normalizeCodeshares(raw,player,owned,now,options){
 if(raw.status!=='available')return {status:'unavailable',agreements:[],partners:[],aircraft:[],flights:[],routes:[],airports:[]};
 const uid=String(player.uid),agreements=raw.agreements.map(c=>({id:c.codeshareId,operatingFlightId:c.operatingFlightId,operatingUid:c.operatingUid,marketingUid:c.marketingUid,role:c.operatingUid===uid?'operating':'marketing',origin:String(c.originAirport||''),destination:String(c.destinationAirport||''),marketingOutboundFlightNumber:c.marketingOutboundFlightNumber,marketingInboundFlightNumber:c.marketingInboundFlightNumber,weeklyOperatingProfit:Number.isFinite(c.operatingCarrierProfit)?c.operatingCarrierProfit*1000:null,weeklyMarketingProfit:Number.isFinite(c.marketingCarrierProfit)?c.marketingCarrierProfit*1000:null}));
 const fleets=new Map(),movements=new Map(),routes=new Map(),airports=new Map();
 for(const partner of raw.partners.filter(p=>raw.flights.some(f=>f.uid===p.uid))){
  const snapshot=normalizeGame({player:partner,aircraft:raw.aircraft,flights:raw.flights,routes:[]},now,options);
  for(const a of snapshot.aircraft)fleets.set(a.id,{...a,operatorId:partner.uid,operatorName:partner.airlineName,operatorCode:partner.airlineCode});
  // One physical movement, with all marketing aliases attached.
  for(const f of snapshot.flights){
   const deals=agreements.filter(c=>c.role==='marketing'&&c.operatingUid===partner.uid&&c.operatingFlightId===f.scheduleId);
   if(!deals.length)continue;
   const numbers=unique(deals.map(c=>f.direction==='out'?c.marketingOutboundFlightNumber:c.marketingInboundFlightNumber).filter(n=>n!==null&&n!==undefined&&Number(n)>=0).map(n=>`${player.airlineCode}${n}`));
   movements.set(f.id,{...f,isCodeshare:true,number:numbers[0]||f.number,operatingNumber:f.number,marketingNumbers:numbers,codeshareIds:deals.map(c=>c.id),operatorId:partner.uid,operatorName:partner.airlineName,operatorCode:partner.airlineCode,weeklyProfit:null});
  }
  for(const r of snapshot.routes)if([...movements.values()].some(f=>[f.origin,f.destination].sort().join('|')===[r.origin,r.destination].sort().join('|')))routes.set(r.id,r);
  for(const a of snapshot.airports)airports.set(a.id,a);
 }
 return {status:'available',agreements,partners:raw.partners.map(p=>({id:p.uid,name:p.airlineName,code:p.airlineCode})),aircraft:[...fleets.values()],flights:[...movements.values()],routes:[...routes.values()],airports:[...airports.values()]};
}
