#!/usr/bin/env node

import { REPOSITORY_ROOT, repositoryPath, writeInventory } from "./core.mjs";

try {
  const destination = writeInventory(REPOSITORY_ROOT);
  console.log(`Vault inventory generated: ${repositoryPath(REPOSITORY_ROOT, destination)}`);
} catch (error) {
  console.error(`Vault inventory generation failed: ${error.message}`);
  process.exitCode = 1;
}
