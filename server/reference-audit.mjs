import {destinationRegion} from '../web/regions.mjs';
import {aircraftProfile} from '../web/aircraft-catalog.mjs';

// Run on each successful snapshot; catalog gaps never turn into invented data
// and never prevent an otherwise valid live feed from updating.
export function auditReferences(snapshot){
 const unknownAirports=(snapshot?.airports||[]).filter(a=>destinationRegion(a)==='其他').map(a=>a.iata||a.id);
 const unknownTypes=[...new Set((snapshot?.aircraft||[]).filter(a=>['unknown','family'].includes(aircraftProfile(a).match)).map(a=>a.type))];
 const messages=[];
 if(unknownAirports.length)messages.push(`机场区域待核对：${unknownAirports.join('、')}`);
 if(unknownTypes.length)messages.push(`机型资料待补充：${unknownTypes.join('、')}`);
 return messages;
}
