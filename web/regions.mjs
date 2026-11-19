import countries from './country-regions.json' with {type:'json'};
import subdivisions from './russia-regions.json' with {type:'json'};
export const REGIONS=['国内','港澳台','东北亚','东南亚','南亚','中亚','北亚','中东','欧洲','北美','拉丁美洲','大洋洲','非洲','其他'];
const normalize=s=>String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^\p{Letter}\p{Number}]/gu,'');
const aliases={'United States':'USA','United Kingdom':'GBR',Netherlands:'NLD','Wallis And Futuna':'WLF',Russia:'RUS',Taiwan:'TWN',Kosovo:'XKX',China:'CHN','Hong Kong':'HKG',Macau:'MAC',Macao:'MAC','South Korea':'KOR','North Korea':'PRK',Vietnam:'VNM',Laos:'LAO',Brunei:'BRN',Iran:'IRN',Syria:'SYR',Turkey:'TUR',Moldova:'MDA',Bolivia:'BOL',Venezuela:'VEN',Tanzania:'TZA',Micronesia:'FSM','Ivory Coast':'CIV','Cape Verde':'CPV',Nauru:'NRU','Myanmar (Burma)':'MMR','Timor-Leste (East Timor)':'TLS','Virgin Islands British':'VGB','Virgin Islands Us':'VIR','Curacao':'CUW','Sint Maarten':'SXM','Democratic Republic Of The Congo':'COD'};
const catalog=new Map(countries.map(c=>[c.iso3,c]));
const names=new Map(countries.flatMap(c=>[[normalize(c.name),c.iso3],[normalize(c.iso3),c.iso3]]));
for(const [name,code] of Object.entries(aliases))names.set(normalize(name),code);
// Intl supplies stable ISO-2 and translated aliases, matched to the M49 ISO-3 catalog.
for(const locale of ['en','zh']){
 const display=new Intl.DisplayNames([locale],{type:'region'});
 for(let a=65;a<=90;a++)for(let b=65;b<=90;b++){
  const code=String.fromCharCode(a,b),name=display.of(code),iso=names.get(normalize(code))||names.get(normalize(name));
  if(iso){names.set(normalize(code),iso);names.set(normalize(name),iso);}
 }
}
function contains(ring,lon,lat){
 let inside=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const [xi,yi]=ring[i],[xj,yj]=ring[j];
  if((yi>lat)!==(yj>lat)&&lon<(xj-xi)*(lat-yi)/(yj-yi)+xi)inside=!inside;
 }return inside;
}
function russianRegion(a){
 const lon=Number(a?.lon??a?.longitude),lat=Number(a?.lat??a?.latitude);
 if(!Number.isFinite(lon)||!Number.isFinite(lat))return '其他';
 let nearest=null,distance=Infinity;
 for(const s of subdivisions)for(const polygon of s.polygons){
  if(contains(polygon[0],lon,lat)&&!polygon.slice(1).some(r=>contains(r,lon,lat)))return s.region;
  // Coastal/reclaimed airport land: use nearest boundary rather than a longitude rectangle.
  for(const ring of polygon)for(let i=1;i<ring.length;i++){
   const c=Math.cos(lat*Math.PI/180),x=lon*c,y=lat,ax=ring[i-1][0]*c,ay=ring[i-1][1],dx=ring[i][0]*c-ax,dy=ring[i][1]-ay;
   const t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy||1))),d=(x-ax-t*dx)**2+(y-ay-t*dy)**2;
   if(d<distance){distance=d;nearest=s.region;}
  }
 }
 return distance<1?nearest:'其他';
}
export function destinationRegion(a){
 const id=a?.iata||a?.iata_code||a?.id;
 if(['HKG','MFM','TPE','TSA','KHH','RMQ'].includes(id))return '港澳台';
 const iso=names.get(normalize(a?.countryCode||a?.country));
 if(iso==='NLD'&&Number(a?.lon??a?.longitude)<-30)return '拉丁美洲';
 if(iso==='CHN')return '国内';
 if(['HKG','MAC','TWN'].includes(iso))return '港澳台';
 if(iso==='RUS')return russianRegion(a);
 if(iso==='XKX')return '欧洲';
 const groups=catalog.get(iso)?.groups||[];
 if(groups.includes('Eastern Asia'))return '东北亚';
 if(groups.includes('South-eastern Asia'))return '东南亚';
 if(groups.includes('Central Asia'))return '中亚';
 if(groups.includes('Southern Asia')&&iso!=='IRN')return '南亚';
 if(groups.includes('Western Asia')||iso==='IRN')return '中东';
 if(groups.includes('Europe'))return '欧洲';
 if(groups.includes('Northern America'))return '北美';
 if(groups.includes('Latin America and the Caribbean'))return '拉丁美洲';
 if(groups.includes('Oceania'))return '大洋洲';
 if(groups.includes('Africa'))return '非洲';
 return '其他';
}
