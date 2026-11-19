import {geoNaturalEarth1,geoPath,geoInterpolate} from 'd3-geo';
export const MAP_PRESETS={
 world:{label:'全球航网',center:150,focus:[150,0],zoom:1},
 pacific:{label:'跨太平洋',center:150,focus:[160,28],zoom:1.45},
 asia:{label:'东亚放大',center:115,focus:[112,33],zoom:3.8},
 europe:{label:'欧洲放大',center:10,focus:[13,50],zoom:3.8},
 atlantic:{label:'大西洋视角',center:0,focus:[0,0],zoom:1},
};
export function makeProjection(center=150){return geoNaturalEarth1().rotate([-center,0]).scale(174).translate([510,247]);}
export function routeLine(origin,destination,projection=makeProjection()){
 if(!origin||!destination||![origin.lon,origin.lat,destination.lon,destination.lat].every(Number.isFinite))return null;
 const interpolate=geoInterpolate([origin.lon,origin.lat],[destination.lon,destination.lat]);
 return geoPath(projection)({type:'LineString',coordinates:Array.from({length:81},(_,i)=>interpolate(i/80))});
}
