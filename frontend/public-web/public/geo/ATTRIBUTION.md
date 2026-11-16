# Geographic data

The `<ISO2>.json` files in this folder are derived from the
[Countries States Cities Database](https://github.com/dr5hn/countries-states-cities-database)
as packaged in `@countrystatecity/countries` 1.0.9, and are made available under the
[Open Database License (ODbL) v1.0](https://opendatacommons.org/licenses/odbl/1-0/).

They are regenerated with `npm run geo:generate`
(`scripts/generate-geo-data.mjs`). That script keeps only the divisions that
contain cities and reduces each record to its code, name and city names.

The Dominican Republic is not included here. The form uses the curated official
catalog in `src/lib/geo/dominican-republic.ts` (32 provinces, 158 municipalities).
