export type GeoDivision = {
  code: string;
  name: string;
  cities: readonly string[];
};

const regionNames = new Intl.DisplayNames(["es"], { type: "region" });
const nonCountryRegions = new Set("AC AN BU CP CQ CS DD DG DY EA EU EZ FX HV IC NH QO RH SU TA TP UK UN VD XA XB YD YU ZR ZZ".split(" "));

/** ISO 3166-1 alpha-2 codes, sorted by their Spanish name. */
export const countryCodes: readonly string[] = Array.from({ length: 26 * 26 }, (_, index) =>
  String.fromCharCode(65 + Math.floor(index / 26), 65 + index % 26))
  .filter((code) => !nonCountryRegions.has(code) && regionNames.of(code) !== code)
  .sort((left, right) => countryName(left).localeCompare(countryName(right), "es"));

const countryCodeSet = new Set(countryCodes);

export function countryName(code: string): string {
  return regionNames.of(code) ?? code;
}

export function isCountryCode(code: string): boolean {
  return countryCodeSet.has(code);
}

const divisionsCache = new Map<string, Promise<readonly GeoDivision[]>>();

/**
 * Administrative divisions (province, state, region…) of a country with their
 * cities or municipalities. The Dominican Republic uses the curated official
 * catalog; every other country is served as a static file from /geo.
 */
export function loadDivisions(countryCode: string): Promise<readonly GeoDivision[]> {
  if (!isCountryCode(countryCode)) return Promise.resolve([]);
  const cached = divisionsCache.get(countryCode);
  if (cached) return cached;

  const pending = countryCode === "DO"
    ? import("./dominican-republic").then((module) => module.DOMINICAN_REPUBLIC_DIVISIONS)
    : fetch(`/geo/${countryCode}.json`).then(async (response) => {
      // Countries without published subdivisions have no file.
      if (response.status === 404) return [];
      if (!response.ok) throw new Error(`Geo catalog unavailable (${response.status}).`);
      const data = await response.json() as { divisions?: GeoDivision[] };
      return Array.isArray(data.divisions) ? data.divisions : [];
    });
  divisionsCache.set(countryCode, pending);
  pending.catch(() => divisionsCache.delete(countryCode));
  return pending;
}
