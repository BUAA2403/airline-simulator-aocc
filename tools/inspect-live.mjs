import {GameAdapter} from '../server/adapter.mjs';
import {Vault} from '../server/vault.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const vault=new Vault(fileURLToPath(new URL('../.data/',import.meta.url)));
const config=await vault.load(), raw={};
class Inspection extends GameAdapter {
  async request(url,...args){const value=await super.request(url,...args),p=new URL(url).pathname;
    const name=p.endsWith('get_master_player_by_master_uid')?'master':p.endsWith('get_player_by_uid')?'player':p.endsWith('player_aircraft_data')?'aircraft':p.endsWith('new_player_flight_data')?'flights':p.endsWith('player_route_data')?'routes':null;
    if(name)raw[name]=['aircraft','flights','routes'].includes(name)?[...(raw[name]||[]),...value]:value;
    return value;
  }
}
// No auth response, bearer or refresh token is written to the capture or output.
await new Inspection().read(config,async update=>{Object.assign(config,update);await vault.save(config);});
await mkdir(new URL('../.data/',import.meta.url),{recursive:true});
await writeFile(new URL('../.data/source-capture.json',import.meta.url),JSON.stringify(raw),{mode:0o600});
const a=raw.aircraft[0],f=raw.flights[0];
console.log(JSON.stringify({aircraftCount:raw.aircraft.length,flightRows:raw.flights.length,aircraftKeys:Object.keys(a),aircraftCabin:Object.fromEntries(Object.entries(a).filter(([k])=>/eco|biz|first|seat|pitch|cabin|model/i.test(k))),flightKeys:Object.keys(f),assignmentSample:Object.values(typeof f.aircraftAssignments==='string'?JSON.parse(f.aircraftAssignments):f.aircraftAssignments)[0]},null,2));
