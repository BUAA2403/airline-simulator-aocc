import {buildDestinationServices} from './destination-services.mjs';
import {filterRoundTrips,compactRotations,roundTripRows,groupDestinations} from './timetable-groups.mjs';

import {PUBLICATION_SECTIONS} from './timetable.mjs';

// Partition before building rotations, so an identical number/time or airport
// pair can never merge the operating airline's own and partner services.
export function buildPublicationSections(flights,aircraft,airports,{basis='local',hub='',hubs=[],base='',...filters}={}){
 return PUBLICATION_SECTIONS.map(section=>{
  const source=flights.filter(f=>section.id==='shared'?f.isCodeshare:!f.isCodeshare);
  const schedule=buildDestinationServices(source,aircraft,airports,{basis,hub,hubs,preferredBase:base});
  const groups=compactRotations(filterRoundTrips(schedule,{...filters,base}));
  return {...section,schedule,groups,destinations:groupDestinations(groups),rows:roundTripRows(groups).map(r=>({...r,trafficSection:section.id}))};
 });
}
