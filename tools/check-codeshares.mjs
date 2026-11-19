import {Vault} from '../server/vault.mjs';
import {GameAdapter} from '../server/adapter.mjs';
import {writeFile} from 'node:fs/promises';
const vault=new Vault('.data');
try{
 const config=await vault.load();
 const snapshot=await new GameAdapter().read(config,updates=>vault.save({...config,...updates}));
 await writeFile('research/codeshares-snapshot.json',JSON.stringify(snapshot));
 const c=snapshot.codeshares;
 console.log(JSON.stringify({capturedAt:snapshot.capturedAt,fleet:snapshot.aircraft.length,sharedStatus:c.status,agreements:c.agreements.length,partners:c.partners,sharedFleet:c.aircraft.length,sharedOccurrences:c.flights.length,sample:c.flights.slice(0,2).map(f=>({number:f.number,operatingNumber:f.operatingNumber,operator:f.operatorName,from:f.origin,to:f.destination}))},null,2));
}catch(e){console.error(e.safeMessage||'Could not verify codeshare data');process.exitCode=1;}
