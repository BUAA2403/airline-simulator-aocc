"""Rebuild the offline geographic catalog from saved public reference snapshots.

Sources: UNSD M49 https://unstats.un.org/unsd/methodology/m49/
Natural Earth (public domain), ne_50m_admin_1_states_provinces.geojson:
https://github.com/nvkelso/natural-earth-vector/tree/master/geojson
No source airport identifiers or credentials are used.
"""
import json
from pathlib import Path
from bs4 import BeautifulSoup

root=Path(__file__).resolve().parents[1]
reference=root/'research/reference'
soup=BeautifulSoup((reference/'m49.html').read_bytes(),'html.parser')
rows={}
for row in soup.select('#GeoGroupsENG tr[data-tt-id]'):
    cells=[c.get_text(' ',strip=True) for c in row.select('td')]
    rows[row['data-tt-id']]={'name':cells[0],'iso3':cells[2],'parent':row.get('data-tt-parent-id')}
countries=[]
for row in rows.values():
    if not row['iso3']: continue
    groups=[]
    parent=row['parent']
    while parent:
        groups.append(rows[parent]['name'])
        parent=rows[parent]['parent']
    countries.append({'name':row['name'],'iso3':row['iso3'],'groups':groups})
subdivisions=[]
def simplify(points,epsilon=.025):
    if len(points)<4:return points
    a,b=points[0],points[-1]
    dx,dy=b[0]-a[0],b[1]-a[1]
    distances=[]
    for x,y in points[1:-1]:
        t=max(0,min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy or 1)))
        distances.append((x-a[0]-t*dx)**2+(y-a[1]-t*dy)**2)
    maximum=max(distances,default=0)
    if maximum<=epsilon*epsilon:return [a,b]
    split=distances.index(maximum)+1
    return simplify(points[:split+1])[:-1]+simplify(points[split:])
for feature in json.loads((reference/'admin1-50m.json').read_bytes())['features']:
    p=feature['properties']
    if p.get('adm0_a3')!='RUS':continue
    # Buryatia and Zabaykalsky joined the Far Eastern district in 2018.
    region='东北亚' if p['region']=='Far Eastern' or p['iso_3166_2'] in ['RU-BU','RU-ZAB'] else '北亚' if p['region'] in ['Siberian','Urals'] else '欧洲'
    geometry=feature['geometry']
    polygons=geometry['coordinates'] if geometry['type']=='MultiPolygon' else [geometry['coordinates']]
    for polygon in polygons:
        for i,ring in enumerate(polygon):
            midpoint=len(ring)//2
            reduced=simplify(ring[:midpoint+1])[:-1]+simplify(ring[midpoint:])
            polygon[i]=[[round(x,4),round(y,4)] for x,y in (reduced if len(reduced)>=4 else ring)]
    subdivisions.append({'code':p['iso_3166_2'],'region':region,'polygons':polygons})
for filename,data in [('country-regions.json',countries),('russia-regions.json',subdivisions)]:
    (root/'web'/filename).write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print(filename,len(data))
