import { describe, expect, it } from 'vitest';
import { REGION_RADIUS_NM, parseCsv, selectMdpcRows } from './ourAirports.mjs';
import { overpassQuery, trimOverpassResponse } from './overpass.mjs';

// Synthetic rows in the shape of the OurAirports CSV tables: invented identifiers and positions, no real extract.
const AIRPORTS = [
  'id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,iso_country,municipality,icao_code,iata_code,gps_code',
  '1,MDPC,large_airport,"Test Field, East",18.567,-68.364,47,DO,"Punta ""Test""",MDPC,PUJ,MDPC',
  '2,ZZNA,medium_airport,Near Field,18.4,-68.9,20,DO,Near,,ZNA,ZZNA',
  '3,ZZFA,large_airport,Far Field,25.8,-80.3,8,US,Far,ZZFA,ZFA,ZZFA',
  '4,ZZSM,small_airport,Small Strip,18.5,-68.4,10,DO,Small,,,ZZSM',
].join('\r\n');
const RUNWAYS = [
  'id,airport_ref,airport_ident,length_ft,width_ft,surface,lighted,closed,le_ident,le_latitude_deg,le_longitude_deg,'
    + 'le_elevation_ft,le_heading_degT,le_displaced_threshold_ft,he_ident,he_latitude_deg,he_longitude_deg,'
    + 'he_elevation_ft,he_heading_degT,he_displaced_threshold_ft',
  '10,1,MDPC,10171,148,ASP,1,0,09,18.566,-68.378,47,83,,27,18.5686,-68.3488,36,263,',
  '11,1,MDPC,10171,148,ASP,1,0,08,18.5703,-68.3831,43,74,328,26,18.5781,-68.3548,37,254,',
  '12,1,MDPC,3000,60,GRS,0,1,18,18.6,-68.4,40,180,,36,18.59,-68.4,40,0,',
  '13,2,ZZNA,5000,100,ASP,1,0,10,18.4,-68.9,20,100,,28,18.4,-68.88,20,280,',
].join('\n');
const FREQUENCIES = [
  'id,airport_ref,airport_ident,type,description,frequency_mhz',
  '20,1,MDPC,TWR,TOWER,118.8',
  '21,1,MDPC,GND,GROUND,121.9',
  '22,2,ZZNA,TWR,TOWER,119.1',
].join('\n');
const NAVAIDS = [
  'id,filename,ident,name,type,frequency_khz,latitude_deg,longitude_deg,elevation_ft,iso_country',
  '30,x,PNA,Test VOR,VOR-DME,112700,18.567,-68.383,40,DO',
  '31,x,PCA,Test NDB,NDB,425,18.564,-68.371,40,DO',
  '32,x,PNA,Elsewhere,VOR-DME,112700,40.0,-3.0,40,ES',
  '33,x,PCA,Wrong frequency,NDB,300,18.5,-68.3,40,DO',
  '34,x,XYZ,Other,VOR,113000,18.5,-68.3,40,DO',
].join('\n');

describe('OurAirports selection', () => {
  it('parses quoted CSV fields and selects MDPC runways, PNA and PCA and airports within 300 NM (synthetic rows)', () => {
    const airports = parseCsv(AIRPORTS);
    expect(airports).toHaveLength(4);
    expect(airports[0].name).toBe('Test Field, East');
    expect(airports[0].municipality).toBe('Punta "Test"');
    expect(parseCsv('a,b\n"x\ny",2\n')).toEqual([{ a: 'x\ny', b: '2' }]);
    expect(parseCsv('a,b\n1,\n')).toEqual([{ a: '1', b: '' }]);

    const rows = selectMdpcRows({
      airports, runways: parseCsv(RUNWAYS), frequencies: parseCsv(FREQUENCIES), navaids: parseCsv(NAVAIDS),
    });
    expect(rows.airport).toMatchObject({ icao: 'MDPC', iata: 'PUJ', lat: 18.567, lon: -68.364, elevationFt: 47 });
    // Open runways only, sorted by ident, in metres, with the displaced threshold converted.
    expect(rows.runways.map(runway => `${runway.leIdent}/${runway.heIdent}`)).toEqual(['08/26', '09/27']);
    expect(rows.runways[0].lengthM).toBeCloseTo(3100.1, 1);
    expect(rows.runways[0].widthM).toBeCloseTo(45.1, 1);
    expect(rows.runways[0].le).toMatchObject({ ident: '08', lat: 18.5703, lon: -68.3831, headingTrue: 74 });
    expect(rows.runways[0].le.displacedThresholdM).toBeCloseTo(100, 0);
    expect(rows.runways[0].he.displacedThresholdM).toBe(0);
    expect(rows.frequencies).toEqual([
      { type: 'GND', description: 'GROUND', frequencyMhz: 121.9 },
      { type: 'TWR', description: 'TOWER', frequencyMhz: 118.8 },
    ]);
    // The navaids by ident, type and frequency, the nearest one when the ident repeats elsewhere.
    expect(rows.navaids.map(navaid => [navaid.ident, navaid.name, navaid.frequencyKhz])).toEqual([
      ['PNA', 'Test VOR', 112700], ['PCA', 'Test NDB', 425],
    ]);
    // Large and medium airports within 300 NM, nearest first; small strips and far fields are left out.
    expect(rows.regionalAirports.map(airport => airport.ident)).toEqual(['MDPC', 'ZZNA']);
    expect(rows.regionalAirports[1].distanceNm).toBeGreaterThan(20);
    expect(rows.regionalAirports[1].icao).toBe('ZZNA');
    expect(REGION_RADIUS_NM).toBe(300);
    expect(() => selectMdpcRows({ airports: [] })).toThrow(/MDPC/u);
  });
});

describe('Overpass extract', () => {
  it('asks for the aeroway ways and nodes around the ARP and keeps only the allowed tags', () => {
    const query = overpassQuery();
    expect(query).toContain('(around:4000,18.5674,-68.3634)');
    expect(query).toContain('way["aeroway"~"^(runway|taxiway|taxilane|apron|parking_position|terminal|holding_position)$"]');
    expect(query).toContain('node["aeroway"~"^(gate|parking_position|holding_position)$"]');
    expect(query).toContain('out body geom;');

    const trimmed = trimOverpassResponse({
      version: 0.6,
      generator: 'Overpass API test',
      osm3s: { timestamp_osm_base: '2026-01-01T00:00:00Z', copyright: 'ODbL' },
      elements: [
        { type: 'way', id: 9, tags: { aeroway: 'taxiway', ref: 'A', note: 'drop', 'fixme': 'drop' },
          nodes: [1, 2], geometry: [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }] },
        { type: 'node', id: 5, lat: 1, lon: 2, tags: { aeroway: 'gate', ref: '7', operator: 'drop' } },
        { type: 'relation', id: 1, members: [] },
      ],
    });
    expect(trimmed.osm3s).toEqual({ timestamp_osm_base: '2026-01-01T00:00:00Z', copyright: 'ODbL' });
    expect(trimmed.license).toBe('ODbL-1.0');
    expect(trimmed.elements).toEqual([
      { type: 'node', id: 5, lat: 1, lon: 2, tags: { aeroway: 'gate', ref: '7' } },
      { type: 'way', id: 9, tags: { aeroway: 'taxiway', ref: 'A' }, nodes: [1, 2],
        geometry: [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }] },
    ]);
  });
});
