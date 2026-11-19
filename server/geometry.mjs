const rad = Math.PI / 180;
export function haversine(a, b) {
  const p1 = a.lat * rad, p2 = b.lat * rad, d = (b.lon - a.lon) * rad;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(Math.sin((p2-p1)/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(d/2)**2)));
}
export function position(a, b, progress) {
  const t = Math.max(0, Math.min(1, progress));
  const vector = p => [Math.cos(p.lat*rad)*Math.cos(p.lon*rad), Math.cos(p.lat*rad)*Math.sin(p.lon*rad), Math.sin(p.lat*rad)];
  const av = vector(a), bv = vector(b), omega = Math.acos(Math.max(-1, Math.min(1, av.reduce((s,x,i)=>s+x*bv[i],0))));
  let v;
  if (omega < 1e-8) v = av;
  else if (Math.abs(Math.sin(omega)) < 1e-8) return { lat: a.lat + (b.lat-a.lat)*t, lon: ((a.lon + (((b.lon-a.lon+540)%360)-180)*t+540)%360)-180, heading: 90 };
  else v = av.map((x,i) => (Math.sin((1-t)*omega)*x + Math.sin(t*omega)*bv[i])/Math.sin(omega));
  const lat = Math.atan2(v[2], Math.hypot(v[0],v[1]))/rad, lon = Math.atan2(v[1],v[0])/rad;
  const p1 = lat*rad, p2 = b.lat*rad, d = (b.lon-lon)*rad;
  return { lat, lon, heading: (Math.atan2(Math.sin(d)*Math.cos(p2), Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(d))/rad+360)%360 };
}
