const DAY=86400000,WEEK=DAY*7;
export function gameClock(realNow,{mode='accelerated',potions=[]}={}){
 const real=+new Date(realNow),midnight=Math.floor(real/DAY)*DAY;
 if(!Number.isFinite(real))throw new Error('Invalid clock');
 const monday=midnight-((new Date(real).getUTCDay()+6)%7)*DAY;
 const potionActive=potions.some(p=>Date.parse(p.start)<real&&Date.parse(p.end)>real);
 const rate=mode==='realtime'?1:potionActive?42:7;
 // Native 20749: accelerated time resets at each real UTC midnight, rather
 // than multiplying the Unix epoch. Potion multiplies UTC time-of-day by 42.
 const elapsed=Math.floor((real-midnight)/1000)*1000;
 const weekMs=mode==='realtime'?real-monday:(elapsed*rate)%WEEK;
 return {date:new Date(monday+weekMs),weekSeconds:weekMs/1000,dayIndex:Math.floor(weekMs/DAY),rate,potionActive,mode};
}
