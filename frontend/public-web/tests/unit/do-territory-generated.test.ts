import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("keeps the Dominican territorial catalog in sync with the DGII source", () => {
  const output = execFileSync(process.execPath, [resolve(__dirname, "../../../../scripts/geo/generate-do-territory.mjs"), "--check"],
    { encoding: "utf8" });
  expect(output).toContain("158 municipalities");
});
