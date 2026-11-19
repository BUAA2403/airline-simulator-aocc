"""Extract inert vector primitives from Apache-2.0 Jets Seatmap templates.

Upstream: https://github.com/Kwiket/jets-seatmap-react-lib-pub (version-3)
No downloaded JavaScript is executed. Only allowlisted SVG geometry is retained.
"""
from pathlib import Path
import json,re,shutil,xml.etree.ElementTree as ET
root=Path(__file__).resolve().parents[1]
source=root/'research/reference/seatmap'
allowed={'path','g','rect','circle','ellipse','polygon','polyline','line'}
attrs={'d','class','transform','x','y','x1','x2','y1','y2','width','height','rx','ry','r','cx','cy','points','fill','stroke','stroke-width','fill-rule','clip-rule'}
def geometry(svg):
    svg=svg.replace('${preparedStyle}','')
    svg=re.sub(r'\$\{style\.(fillColor|armrestColor)\}','currentColor',svg)
    svg=svg.replace('${style.strokeColor}','#ffffff').replace('${style.strokeWidth}','1.6')
    tree=ET.fromstring(svg)
    def parse(element):
        tag=element.tag.split('}')[-1]
        if tag not in allowed:return None
        props={k:v for k,v in element.attrib.items() if k in attrs}
        return {'tag':tag,'props':props,'children':[child for c in element if (child:=parse(c))]}
    return [p for c in tree if (p:=parse(c))]
s=(source/'src/components/Nose/service.js').read_text(encoding='utf-8')
noses={}
for name,svg in re.findall(r'(\w+):\s*preparedStyle\s*=>\s*`(<svg[\s\S]*?</svg>)`',s):
    height=int(re.search(r'viewBox="0 0 200 (\d+)"',svg)[1])
    noses[name]={'height':height,'geometry':geometry(svg)}
seats={}
s=(source/'src/components/Seat/service.js').read_text(encoding='utf-8')
for label,section,method in [('first','firstClassTemplates','_type1'),('biz','businessClassTemplates','_default'),('premEco','premiumClassTemplates','getTemplate'),('eco','economyClassTemplates','_default')]:
    start=s.index('const '+section);end=s.find('\nconst ',start+10);part=s[start:end if end>=0 else None]
    methodStart=part.index('  '+method+'(')
    svg=re.search(r'return `(<svg[\s\S]*?</svg>)`',part[methodStart:])[1]
    seats[label]={'viewBox':'0 0 140 148' if label=='first' else '0 -3 110 100','geometry':geometry(svg)}
(root/'web/cabin-templates.json').write_text(json.dumps({'noses':noses,'seats':seats},ensure_ascii=False,separators=(',',':')),encoding='utf-8')
out=root/'public/licenses/jets-seatmap';out.mkdir(parents=True,exist_ok=True)
shutil.copyfile(source/'LICENSE.txt',out/'LICENSE.txt')
(out/'NOTICE.txt').write_text('Jets Seatmap vector templates by Quicket GmbH / Kwiket.\nSource: https://github.com/Kwiket/jets-seatmap-react-lib-pub/tree/version-3\nLicense: Apache-2.0 (see LICENSE.txt).\nAOCC modifications: extracted inert SVG geometry; responsive layout, colors, data binding and seat placement replaced.\nNo upstream API or passenger data services are used.\n',encoding='utf-8')
print('nose templates:',len(noses),'seat templates:',len(seats))
