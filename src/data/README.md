# Weather location data

`weather-cities-cn.json` is a reduced GeoNames snapshot downloaded on 2026-10-04.
It contains populated administrative seats (PPLC/PPLA/PPLA2/PPLA3) and city/county
administrative areas (ADM2/ADM3) from `CN.zip`, including Chinese aliases and WGS84
coordinates. It does not claim coverage of every village or current district boundary.
Rows contain name, ASCII name, pipe-separated aliases, province, latitude, longitude,
population, feature code and English province name. Settlement coordinates take priority over an administrative
area with the same name and province. `weather-country-codes.json` contains ISO-style
country/region codes from GeoNames countryInfo; display names come from Intl.

Source: https://download.geonames.org/export/dump/
Copyright GeoNames contributors. Licensed under CC BY 4.0:
https://creativecommons.org/licenses/by/4.0/
Changes: filtering, alias reduction, rounding and deduplication, as described above.

Refresh by downloading CN.zip, admin1CodesASCII.txt and countryInfo.txt from the
source and running `python3 scripts/update-weather-cities.py <CN.zip> <admin1CodesASCII.txt> <countryInfo.txt>`.
Review the resulting diff and location regressions before release.
