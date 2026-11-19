"""Extract only native blank aircraft profiles for this local, game-connected AOCC."""
import json,re,zipfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]
normalize=lambda text:re.sub('[^a-z0-9]','',text.lower())
archive=zipfile.ZipFile(next(root.glob('*.apk*')))
prefix='assets_resized_blank_aircraft_liveries_'
available={normalize(Path(n).stem.split(prefix)[1]):n for n in archive.namelist() if prefix in n and n.endswith('.webp')}
output=root/'public/game-assets/aircraft';output.mkdir(exist_ok=True)
manifest={}
for aircraft in json.loads((root/'server/data/aircraft-types.json').read_text(encoding='utf-8')):
    identifier=normalize(aircraft['livery_aircraft_model'])
    if identifier=='embraere145':identifier='embraere145xr' if aircraft['aircraft_model'].endswith('XR') else 'embraere145lr'
    if identifier not in available:raise ValueError('Missing native profile: '+identifier)
    (output/(identifier+'.webp')).write_bytes(archive.read(available[identifier]))
    manifest[aircraft['aircraft_model']]='/game-assets/aircraft/'+identifier+'.webp'
(root/'web/aircraft-assets.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print(len(manifest),'model mappings;',len(set(manifest.values())),'native profiles')
