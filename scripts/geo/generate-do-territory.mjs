#!/usr/bin/env node
// Generates the Dominican Republic territorial catalog (province → municipality → municipal
// district) from the DGII e-CF schema committed in the repository, for both the backend
// validator and the public web form. Run with --check to fail when the generated files are stale.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = 'backend/Elevant.Infrastructure/Finance/XmlSchemas/e-CF-31-v1.0.xsd';
const TS_OUT = 'frontend/public-web/src/lib/geo/dominican-republic.ts';
const CS_OUT = 'backend/Elevant.Domain/Reference/DominicanTerritory.Data.cs';

// Province names as written by the Oficina Nacional de Estadística; codes are ISO 3166-2:DO,
// which match the first two digits of the DGII codes.
const PROVINCES = {
  '01': 'Distrito Nacional', '02': 'Azua', '03': 'Bahoruco', '04': 'Barahona', '05': 'Dajabón',
  '06': 'Duarte', '07': 'Elías Piña', '08': 'El Seibo', '09': 'Espaillat', '10': 'Independencia',
  '11': 'La Altagracia', '12': 'La Romana', '13': 'La Vega', '14': 'María Trinidad Sánchez',
  '15': 'Monte Cristi', '16': 'Pedernales', '17': 'Peravia', '18': 'Puerto Plata',
  '19': 'Hermanas Mirabal', '20': 'Samaná', '21': 'San Cristóbal', '22': 'San Juan',
  '23': 'San Pedro de Macorís', '24': 'Sánchez Ramírez', '25': 'Santiago', '26': 'Santiago Rodríguez',
  '27': 'Valverde', '28': 'Monseñor Nouel', '29': 'Monte Plata', '30': 'Hato Mayor',
  '31': 'San José de Ocoa', '32': 'Santo Domingo',
};

// The DGII schema predates a few changes recorded by the Oficina Nacional de Estadística (2021):
// official long names of some municipalities and San Víctor, raised from municipal district of
// Moca to municipality of Espaillat. Keyed by DGII code.
const MUNICIPALITY_NAMES = {
  '0201': 'Azua de Compostela', '3001': 'Hato Mayor del Rey', '2201': 'San Juan de la Maguana',
  '2501': 'Santiago de los Caballeros',
};
const MUNICIPALITY_NAME_BY_LABEL = { 'Los Llanos': 'San José de Los Llanos', 'Bisonó': 'Villa Bisonó' };
const PROMOTED_DISTRICTS = { '090103': '09P1' };

// Connectors are always lower-case; articles only right after "de"/"del" ("Monte de la Jagua",
// but "Padre Las Casas"). The first word and every hyphen or bracket part start upper-case.
const CONNECTORS = new Set(['de', 'del', 'al', 'y', 'e', 'en']);
const ARTICLES = new Set(['la', 'las', 'los', 'el']);
const capitalize = part => part ? part[0].toLocaleUpperCase('es') + part.slice(1) : part;

function titleCase(upper) {
  const words = upper.toLocaleLowerCase('es').split(' ');
  return words.map((word, index) => {
    const previous = words[index - 1];
    if (index > 0 && CONNECTORS.has(word)) return word;
    if (index > 0 && ARTICLES.has(word) && (previous === 'de' || previous === 'del')) return word;
    return word.split(/([-(])/).map(capitalize).join('');
  }).join(' ');
}

function cleanName(comment) {
  return comment
    .replace(/^(PROVINCIA|MUNICIPIO)\s+/u, '')
    .replace(/\s*\(\s*D\.\s*M\.?\s*\)\.?\s*$/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function buildTerritory(xsd) {
  const start = xsd.indexOf('<xs:simpleType name="ProvinciaMunicipioType">');
  const end = xsd.indexOf('</xs:simpleType>', start);
  if (start < 0 || end < 0) throw new Error('ProvinciaMunicipioType not found in the DGII schema.');
  const entries = [...xsd.slice(start, end)
    .matchAll(/value=\s*"(\d{6})"\s*\/>\s*<!--(.*?)-->/gu)]
    .map(([, code, comment]) => ({ code, name: titleCase(cleanName(comment)) }));

  const provinces = new Map();
  for (const { code } of entries) {
    const province = code.slice(0, 2);
    if (!PROVINCES[province]) throw new Error(`Unknown province code ${province}.`);
    if (!provinces.has(province)) provinces.set(province, { code: province, name: PROVINCES[province], municipalities: new Map() });
  }
  for (const { code, name } of entries) {
    const province = provinces.get(code.slice(0, 2));
    const municipality = code.slice(2, 4);
    const district = code.slice(4, 6);
    if (municipality === '00') continue;
    if (!province.municipalities.has(municipality))
      province.municipalities.set(municipality, { code: code.slice(0, 4), name: null, districts: [] });
    const entry = province.municipalities.get(municipality);
    if (district === '00') entry.name = name;
    else if (PROMOTED_DISTRICTS[code]) {
      province.municipalities.set(PROMOTED_DISTRICTS[code], { code: PROMOTED_DISTRICTS[code], name, districts: [] });
    } else entry.districts.push({ code, name });
  }
  for (const province of provinces.values())
    for (const municipality of province.municipalities.values()) {
      // A few schema rows list districts without their municipality row; the head district names it.
      municipality.name ??= municipality.districts[0]?.name;
      municipality.schemaName = municipality.name;
      municipality.name = MUNICIPALITY_NAMES[municipality.code] ?? MUNICIPALITY_NAME_BY_LABEL[municipality.name] ?? municipality.name;
      if (!municipality.name) throw new Error(`Municipality ${municipality.code} has no name.`);
    }
  return [...provinces.values()]
    .map(province => ({
      code: province.code,
      name: province.name,
      municipalities: [...province.municipalities.values()]
        .map(municipality => ({
          code: municipality.code,
          name: municipality.name,
          // The head district repeats the municipality name; only the others are separate places.
          districts: municipality.districts.map(item => item.name)
            .filter(name => ![municipality.name, municipality.schemaName].some(head =>
              name.localeCompare(head, 'es', { sensitivity: 'base' }) === 0)),
        }))
        .sort((left, right) => left.name.localeCompare(right.name, 'es')),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'es'));
}

const quote = value => JSON.stringify(value);

function renderTypeScript(territory) {
  const lines = territory.map(province => {
    const cities = province.municipalities.map(item => item.name);
    const districts = province.municipalities.filter(item => item.districts.length)
      .map(item => `${quote(item.name)}: [${item.districts.map(quote).join(', ')}]`);
    return `  { code: ${quote(province.code)}, name: ${quote(province.name)}, cities: [${cities.map(quote).join(', ')}],\n` +
      `    districts: { ${districts.join(', ')} } },`;
  });
  return `// GENERATED by scripts/geo/generate-do-territory.mjs from ${SOURCE}. Do not edit by hand.
import type { GeoDivision } from "./catalog";

/**
 * Official territorial division of the Dominican Republic as published by the DGII
 * (e-CF schema, ProvinciaMunicipioType): provinces, their municipalities and the
 * municipal districts (D. M.) of each municipality. Province codes follow ISO 3166-2:DO.
 */
export const DOMINICAN_REPUBLIC_DIVISIONS: readonly GeoDivision[] = [
${lines.join('\n')}
];
`;
}

function renderCSharp(territory) {
  const provinces = territory.map(province => {
    const municipalities = province.municipalities.map(item =>
      `            new(${quote(item.code)}, ${quote(item.name)}, [${item.districts.map(quote).join(', ')}]),`);
    return `        new(${quote(province.code)}, ${quote(province.name)},\n        [\n${municipalities.join('\n')}\n        ]),`;
  });
  return `// <auto-generated>
// Generated by scripts/geo/generate-do-territory.mjs from ${SOURCE}. Do not edit by hand.
// </auto-generated>
namespace Elevant.Domain.Reference;

public static partial class DominicanTerritory
{
    private static readonly TerritoryProvince[] Data =
    [
${provinces.join('\n')}
    ];
}
`;
}

function main() {
  const check = process.argv.includes('--check');
  const territory = buildTerritory(readFileSync(resolve(root, SOURCE), 'utf8'));
  const outputs = [[TS_OUT, renderTypeScript(territory)], [CS_OUT, renderCSharp(territory)]];
  const stale = [];
  for (const [path, content] of outputs) {
    const target = resolve(root, path);
    let current = null;
    try { current = readFileSync(target, 'utf8'); } catch { /* missing */ }
    if (current === content) continue;
    if (check) stale.push(path); else writeFileSync(target, content);
  }
  const municipalities = territory.reduce((sum, item) => sum + item.municipalities.length, 0);
  const districts = territory.reduce((sum, item) =>
    sum + item.municipalities.reduce((inner, municipality) => inner + municipality.districts.length, 0), 0);
  if (stale.length) {
    console.error(`Stale territorial catalog: ${stale.join(', ')}. Run node scripts/geo/generate-do-territory.mjs`);
    process.exit(1);
  }
  console.log(`${territory.length} provinces, ${municipalities} municipalities, ${districts} municipal districts.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
