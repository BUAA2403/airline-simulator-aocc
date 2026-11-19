import {haversine,position} from './geometry.mjs';

export function turnaroundMinutes(distanceKm, offset = 0) {
  // Native getTurnaroundTimeFromPlayerFlightDataAndOffset, function 17583.
  return (distanceKm < 1500 ? 60 : distanceKm < 4000 ? 90 : distanceKm < 10000 ? 120 : 150) + offset * 15;
}

const gaussian = (value,center,spread) => Math.exp(-((value-center)**2)/spread);
const clamp = (value,min,max) => Math.max(min,Math.min(max,value));

// Wind model used by game functions 17614 and 17615.
function gameWind(latitude,longitude) {
  const lat=Math.abs(latitude), lon=(longitude+360)%360, north=latitude>=0;
  const regional=north
    ? 1+(-0.3+1.3*gaussian(lon,140,648)+0.9*gaussian(lon,295,450)+0.3*gaussian(lon,200,800)+0.2*gaussian(Math.min(lon,360-lon),0,800))*gaussian(lat,40,800)
    : 1+(-0.05+0.15*gaussian(lon,45,800)+0.1*gaussian(lon,155,800))*gaussian(lat,50,288);
  const jet=Math.max(78*gaussian(lat,30,128),80*gaussian(lat,north?52:50,200))*clamp(regional,0.5,2);
  const tropical=25*(1-gaussian(lat,0,288));
  const polarFade=lat>65?Math.max(0.15,1-(lat-65)/25):1;
  const inJetBand=lat>=25&&lat<=60;
  let from=north||!inJetBand?270:275;
  if (north&&inJetBand&&jet>60) {
    const distance=Math.min(...[140,280].map(center=>Math.min(Math.abs(lon-center),360-Math.abs(lon-center))));
    from-=Math.max(0,15*(1-distance/40));
  }
  return {speed:Math.round(Math.max(10,Math.max(jet,tropical)*polarFade)*10)/10,from:Math.round(from*10)/10};
}

// Approximate the game's flight-time calculation (17613) along a great
// circle. Saved game times take precedence because the client adds airways.
export function estimateGameFlightMinutes(origin,destination) {
  const airspeed=900, bufferMinutes=30;
  const segments=Math.max(1,Math.ceil(haversine(origin,destination)/100));
  let hours=0, start=origin;
  for (let i=1;i<=segments;i++) {
    const end=i===segments?destination:position(origin,destination,i/segments);
    const bearing=position(start,end,0).heading;
    const {speed,from}=gameWind((start.lat+end.lat)/2,(start.lon+end.lon)/2);
    const angle=((from+180)%360-bearing)*Math.PI/180;
    const crosswind=speed*Math.sin(angle);
    const groundSpeed=Math.max(10,Math.sqrt(airspeed**2-crosswind**2)+speed*Math.cos(angle));
    hours+=haversine(start,end)/groundSpeed;
    start=end;
  }
  return Math.round((hours*60+bufferMinutes)/5)*5;
}
