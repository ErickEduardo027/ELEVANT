import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { relative, resolve } from "node:path";
import { packageRoot, validateTrackedSnapshot } from "./snapshot-utils.mjs";

const generatedRoot = resolve(packageRoot, "generated");

async function snapshotDirectory(root) {
  const files = new Map();

  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return;
      }
      throw error;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        files.set(relative(root, path).replaceAll("\\", "/"), await readFile(path));
      }
    }
  }

  await visit(root);
  return files;
}

function changedFiles(before, after) {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths]
    .sort()
    .filter((path) => {
      const oldContents = before.get(path);
      const newContents = after.get(path);
      return !oldContents || !newContents || !oldContents.equals(newContents);
    });
}

try {
  await validateTrackedSnapshot();
  const before = await snapshotDirectory(generatedRoot);
  const require = createRequire(import.meta.url);
  const orvalCli = require.resolve("orval/bin/orval");
  const generation = spawnSync(process.execPath, [orvalCli, "--config", "orval.config.ts"], {
    cwd: packageRoot,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (generation.status !== 0) {
    if (generation.stdout) process.stdout.write(generation.stdout);
    if (generation.stderr) process.stderr.write(generation.stderr);
    throw new Error("OpenAPI client generation failed.");
  }

  const after = await snapshotDirectory(generatedRoot);
  const changed = changedFiles(before, after);

  if (changed.length > 0) {
    console.error("Generated OpenAPI output was stale:");
    for (const path of changed) console.error(`- generated/${path}`);
    process.exit(1);
  }

  console.log("Generated OpenAPI output is current.");
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Generated output check failed.",
  );
  process.exit(1);
}
