"""Refresh the bundled China city/county index (GeoNames CC BY 4.0).
Usage: python3 scripts/update-weather-cities.py CN.zip admin1CodesASCII.txt countryInfo.txt
Download inputs from https://download.geonames.org/export/dump/.
No download runs at plugin startup or build time.
"""
import sys, json, zipfile, re
from pathlib import Path
archive, admins, countries = map(Path, sys.argv[1:])
rows = [line.split('\t') for line in zipfile.ZipFile(archive).read('CN.txt').decode('utf-8').splitlines()]
province_names = {}
province_ascii = {}
for row in rows:
    if row[7] == 'ADM1':
        names = [s for s in row[3].split(',') if re.fullmatch(r'[\u3400-\u9fff]+', s)]
        if names: province_names[row[10]] = min([s for s in names if len(s) >= 2] or names, key=len)
for line in admins.read_text().splitlines():
    code, name, *_ = line.split('\t')
    if code.startswith('CN.'):
        province_names.setdefault(code[3:], name)
        province_ascii[code[3:]] = name
places = []
for row in rows:
    if row[7] not in ('PPLC', 'PPLA', 'PPLA2', 'PPLA3', 'ADM2', 'ADM3'): continue
    aliases = list(dict.fromkeys([row[1], row[2]] + [s for s in row[3].split(',') if re.fullmatch(r'[\u3400-\u9fff]+', s)]))
    names = [s for s in aliases if re.fullmatch(r'[\u3400-\u9fff]+', s)]
    official = [s for s in names if s.endswith(('市', '县', '区', '旗'))]
    name = min(official or names or [row[1]], key=len)
    places.append([name, row[2], '|'.join(aliases), province_names.get(row[10], ''), round(float(row[4]), 5), round(float(row[5]), 5), int(row[14] or 0), row[7], province_ascii.get(row[10], '')])
# Prefer the settlement over the administrative polygon centre when names coincide.
places.sort(key=lambda p: (not p[7].startswith('P'), -p[6]))
unique = {}
for place in places: unique.setdefault((place[0], place[3]), place)
output = Path(__file__).resolve().parent.parent / 'src/data'
(output / 'weather-cities-cn.json').write_text(json.dumps(list(unique.values()), ensure_ascii=False, separators=(',', ':')) + '\n')
codes = sorted({line.split('\t')[0] for line in countries.read_text().splitlines() if line and not line.startswith('#') and re.fullmatch('[A-Z]{2}', line.split('\t')[0])} - {'AN', 'CS'})
(output / 'weather-country-codes.json').write_text(json.dumps(codes, separators=(',', ':')) + '\n')
print(f'{len(unique)} city/county entries; {len(codes)} country/region codes')
