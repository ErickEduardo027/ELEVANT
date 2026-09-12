#!/usr/bin/env node

import {
  REPOSITORY_ROOT,
  VaultValidationError,
  validateVault,
} from "./core.mjs";

try {
  const result = validateVault(REPOSITORY_ROOT);
  console.log(
    `Vault validation passed: ${result.notes} notes, ${result.canvases} canvases, ${result.bases} bases.`,
  );
} catch (error) {
  if (error instanceof VaultValidationError) {
    console.error(error.message);
    for (const issue of error.errors) {
      console.error(`- ${issue}`);
    }
  } else {
    console.error(`Vault validation failed: ${error.stack ?? error.message}`);
  }
  process.exitCode = 1;
}
