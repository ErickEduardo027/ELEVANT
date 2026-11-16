// Generates public/geo/<ISO2>.json from the Countries States Cities Database
// (ODbL-1.0). The output is committed; run `npm run geo:generate` only to
// refresh the data. The Dominican Republic is excluded because the form uses
// the curated official catalog in src/lib/geo/dominican-republic.ts.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_PACKAGE = "@countrystatecity/countries@1.0.9";
const CURATED_COUNTRIES = new Set(["DO"]);
const outputDir = fileURLToPath(new URL("../public/geo/", import.meta.url));
const workDir = mkdtempSync(join(tmpdir(), "elevant-geo-"));
const collator = new Intl.Collator("es");

try {
  execFileSync("npm", ["pack", SOURCE_PACKAGE, "--silent", "--pack-destination", workDir], { shell: true, stdio: "inherit" });
  const tarball = readdirSync(workDir).find((file) => file.endsWith(".tgz"));
  execFileSync("tar", ["xzf", tarball], { cwd: workDir, stdio: "inherit" });
  const dataDir = join(workDir, "package", "dist", "data");
  const readJson = (...parts) => JSON.parse(readFileSync(join(dataDir, ...parts), "utf8"));

  mkdirSync(outputDir, { recursive: true });
  let written = 0;
  for (const countryDir of readdirSync(dataDir)) {
    const statesFile = join(dataDir, countryDir, "states.json");
    if (!existsSync(statesFile)) continue;
    const code = countryDir.slice(countryDir.lastIndexOf("-") + 1);
    if (!/^[A-Z]{2}$/.test(code) || CURATED_COUNTRIES.has(code)) continue;

    const stateDirs = readdirSync(join(dataDir, countryDir));
    const divisions = readJson(countryDir, "states.json").map((state) => {
      const stateDir = stateDirs.find((dir) => dir.endsWith(`-${state.iso2}`));
      const citiesFile = stateDir && join(dataDir, countryDir, stateDir, "cities.json");
      const cities = citiesFile && existsSync(citiesFile)
        ? [...new Set(JSON.parse(readFileSync(citiesFile, "utf8")).map((city) => city.name.trim()))].sort(collator.compare)
        : [];
      return { code: String(state.iso2), name: state.name.trim(), cities };
    });
    // The source mixes hierarchy levels (e.g. Spanish autonomous communities
    // next to provinces). Cities hang from the lowest level, so keep only the
    // divisions that own cities whenever the country has any.
    const usable = divisions.some((division) => division.cities.length > 0)
      ? divisions.filter((division) => division.cities.length > 0)
      : divisions;
    usable.sort((left, right) => collator.compare(left.name, right.name));
    writeFileSync(join(outputDir, `${code}.json`), JSON.stringify({ divisions: usable }));
    written += 1;
  }
  // Countries without subdivisions get an empty file so the form can tell
  // "no divisions" apart from a missing catalog without a 404.
  for (const country of readJson("countries.json")) {
    const file = join(outputDir, `${country.iso2}.json`);
    if (CURATED_COUNTRIES.has(country.iso2) || existsSync(file)) continue;
    writeFileSync(file, JSON.stringify({ divisions: [] }));
    written += 1;
  }
  console.log(`Wrote ${written} country files to ${outputDir}`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
