import json
import pathlib
import re

base = pathlib.Path(__file__).parent
source = pathlib.Path(r'C:\Users\sfouts\Downloads\event_export_1790323049840.geojson')
data = json.loads(source.read_text(encoding='utf-8-sig'))
rows = []
for feature in data['features']:
    p = feature['properties']
    rows.append([p['evid'], round(p['lon'], 6), round(p['lat'], 6),
                 p['depth'], p['magnitude'], round(p['datetime'] * 1000)])
html = (base / 'rainier-earthquakes.template.html').read_text(encoding='utf-8')
html = html.replace('__EVENT_DATA__', json.dumps(rows, separators=(',', ':')))
output = base / 'rainier-earthquakes.html'
output.write_text(html, encoding='utf-8')
scripts = re.findall(r'<script>(.*?)</script>', html, flags=re.S)
(base / 'rainier-check.js').write_text('\n'.join(scripts), encoding='utf-8')
print(json.dumps({'events': len(rows), 'bytes': output.stat().st_size}))
