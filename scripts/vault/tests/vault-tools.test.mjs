import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  INVENTORY_RELATIVE_PATH,
  VaultValidationError,
  validateVault,
  writeInventory,
} from "../core.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";

function note({
  id,
  title,
  type = "guide",
  area = "vault",
  status = "verified",
  maturity = "stable",
  evidence = "repo-verified",
  verifiedCommit = SHA,
  sources = ["AGENTS.md"],
  tags = ["prueba"],
  body = "",
}) {
  return `---
id: ${id}
title: "${title}"
type: ${type}
area: ${area}
status: ${status}
maturity: ${maturity}
evidence: ${evidence}
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "${verifiedCommit}"
sources:
${sources.map((source) => `  - ${source}`).join("\n")}
tags:
${tags.map((tag) => `  - ${tag}`).join("\n")}
---

# ${title}

${body}
`;
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "elevant-vault-test-"));
  mkdirSync(path.join(root, "Vault", "guides"), { recursive: true });
  mkdirSync(path.join(root, ".github", "workflows"), { recursive: true });
  mkdirSync(
    path.join(
      root,
      "database",
      "DevelopmentDB",
      "Elevant.Persistence",
      "Persistence",
      "Migrations",
    ),
    { recursive: true },
  );
  mkdirSync(path.join(root, "packages", "api-client", "openapi"), {
    recursive: true,
  });
  mkdirSync(path.join(root, ".obsidian"), { recursive: true });
  const obsidianConfig = {
    "app.json": {
      alwaysUpdateLinks: true,
      newFileLocation: "current",
      newLinkFormat: "relative",
      useMarkdownLinks: true,
    },
    "appearance.json": {},
    "core-plugins.json": {
      backlink: true,
      bases: true,
      canvas: true,
      "file-explorer": true,
      "global-search": true,
      graph: true,
      "outgoing-link": true,
      "page-preview": true,
      properties: true,
      templates: true,
    },
    "graph.json": {
      search: 'path:"Vault" -path:"Vault/99-plantillas"',
    },
    "templates.json": {
      folder: "Vault/99-plantillas",
    },
  };
  for (const [name, value] of Object.entries(obsidianConfig)) {
    writeFileSync(
      path.join(root, ".obsidian", name),
      `${JSON.stringify(value, null, 2)}\n`,
      "utf8",
    );
  }
  writeFileSync(path.join(root, "AGENTS.md"), "# Rules\n", "utf8");
  writeFileSync(
    path.join(root, "Vault", "README.md"),
    note({
      id: "vault-readme",
      title: "Vault",
      type: "index",
      body: "[Guide](guides/guide.md)",
    }),
    "utf8",
  );
  writeFileSync(
    path.join(root, "Vault", "guides", "guide.md"),
    note({ id: "guide", title: "Guide", body: "[Home](../README.md)" }),
    "utf8",
  );
  writeFileSync(
    path.join(root, ".github", "workflows", "ci.yml"),
    "name: CI\n",
    "utf8",
  );
  writeFileSync(
    path.join(root, "packages", "api-client", "openapi", "elevant-v1.json"),
    '{"openapi":"3.1.0","info":{"title":"ELEVANT","version":"1"}}\n',
    "utf8",
  );
  writeFileSync(
    path.join(
      root,
      "database",
      "DevelopmentDB",
      "Elevant.Persistence",
      "Persistence",
      "Migrations",
      "20260912000000_Test.cs",
    ),
    "// migration\n",
    "utf8",
  );
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Vault Tests"], { cwd: root });
  execFileSync("git", ["config", "user.email", "vault-tests@example.invalid"], {
    cwd: root,
  });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: root });
  const verifiedCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  for (const relativePath of ["Vault/README.md", "Vault/guides/guide.md"]) {
    const filePath = path.join(root, relativePath);
    writeFileSync(
      filePath,
      readFileSync(filePath, "utf8").replaceAll(SHA, verifiedCommit),
      "utf8",
    );
  }
  writeInventory(root);
  return root;
}

function withFixture(run) {
  const root = fixture();
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function issuesFrom(run) {
  try {
    run();
    assert.fail("expected Vault validation to fail");
  } catch (error) {
    assert.ok(error instanceof VaultValidationError);
    return error.errors.join("\n");
  }
}

test("accepts a connected, metadata-complete and drift-free Vault", () => {
  withFixture((root) => {
    assert.deepEqual(validateVault(root), { notes: 2, canvases: 0, bases: 0 });
  });
});

test("generator writes only the documented generated inventory", () => {
  withFixture((root) => {
    const before = readFileSync(path.join(root, "AGENTS.md"), "utf8");
    const destination = writeInventory(root);
    assert.equal(
      path.relative(root, destination).split(path.sep).join("/"),
      INVENTORY_RELATIVE_PATH,
    );
    assert.equal(readFileSync(path.join(root, "AGENTS.md"), "utf8"), before);
    assert.doesNotThrow(() => JSON.parse(readFileSync(destination, "utf8")));
  });
});

test("generated hashes are stable across LF and CRLF worktrees", () => {
  withFixture((root) => {
    const workflowPath = path.join(root, ".github", "workflows", "ci.yml");
    writeFileSync(workflowPath, "name: CI\r\non:\r\n  push:\r\n", "utf8");
    writeInventory(root);
    const crlfInventory = readFileSync(path.join(root, INVENTORY_RELATIVE_PATH), "utf8");

    writeFileSync(workflowPath, "name: CI\non:\n  push:\n", "utf8");
    writeInventory(root);
    const lfInventory = readFileSync(path.join(root, INVENTORY_RELATIVE_PATH), "utf8");
    assert.equal(lfInventory, crlfInventory);
  });
});

test("reports missing metadata, duplicate ids and orphan notes", () => {
  withFixture((root) => {
    const orphanPath = path.join(root, "Vault", "orphan.md");
    writeFileSync(
      orphanPath,
      note({ id: "guide", title: "Orphan" }).replace("maturity: stable\n", ""),
      "utf8",
    );
    const issues = issuesFrom(() => validateVault(root, { checkInventory: false }));
    assert.match(issues, /missing required frontmatter key 'maturity'/);
    assert.match(issues, /duplicate id 'guide'/);
    assert.match(issues, /not reachable from Vault\/README\.md/);
  });
});

test("reports broken and absolute Markdown links", () => {
  withFixture((root) => {
    const guidePath = path.join(root, "Vault", "guides", "guide.md");
    writeFileSync(
      guidePath,
      note({
        id: "guide",
        title: "Guide",
        body: "[Missing](missing.md)\n\n[Absolute](/etc/passwd)",
      }),
      "utf8",
    );
    const issues = issuesFrom(() => validateVault(root, { checkInventory: false }));
    assert.match(issues, /link target 'missing\.md' does not exist/);
    assert.match(issues, /must be relative/);
  });
});

test("enforces exact link and source casing on case-insensitive filesystems", () => {
  withFixture((root) => {
    const readmePath = path.join(root, "Vault", "README.md");
    writeFileSync(
      readmePath,
      note({
        id: "vault-readme",
        title: "Vault",
        type: "index",
        sources: ["agents.md"],
        body: "[Guide](guides/Guide.md)",
      }),
      "utf8",
    );
    const issues = issuesFrom(() => validateVault(root, { checkInventory: false }));
    assert.match(issues, /source 'agents\.md' does not exist/);
    assert.match(issues, /link target 'guides\/Guide\.md' does not exist/);
  });
});

test("rejects values outside the controlled metadata taxonomies", () => {
  withFixture((root) => {
    const guidePath = path.join(root, "Vault", "guides", "guide.md");
    writeFileSync(
      guidePath,
      note({ id: "guide", title: "Guide", type: "memo", area: "other" }),
      "utf8",
    );
    const issues = issuesFrom(() => validateVault(root, { checkInventory: false }));
    assert.match(issues, /'type' must be one of/);
    assert.match(issues, /'area' must be one of/);
  });
});

test("requires ordered, non-empty and commit-verifiable evidence metadata", () => {
  withFixture((root) => {
    const guidePath = path.join(root, "Vault", "guides", "guide.md");
    writeFileSync(
      guidePath,
      note({
        id: "guide",
        title: "Guide",
        verifiedCommit: "0123456",
        sources: [],
        tags: [],
        body: "[Home](../README.md)",
      }).replace("title: \"Guide\"\ntype: guide", "type: guide\ntitle: \"Guide\""),
      "utf8",
    );
    const issues = issuesFrom(() => validateVault(root, { checkInventory: false }));
    assert.match(issues, /frontmatter keys must use the documented order/);
    assert.match(issues, /'verified_commit' must be a full 40-character/);
    assert.match(issues, /status 'verified' requires a full verified_commit/);
    assert.match(issues, /'sources' must be a non-empty YAML list/);
    assert.match(issues, /'tags' must be a non-empty YAML list/);
  });
});

test("rejects evidence introduced after the claimed verified commit", () => {
  withFixture((root) => {
    const verifiedCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    writeFileSync(path.join(root, "late-evidence.md"), "# Too late\n", "utf8");
    writeFileSync(
      path.join(root, "Vault", "guides", "guide.md"),
      note({
        id: "guide",
        title: "Guide",
        verifiedCommit,
        sources: ["late-evidence.md"],
        body: "[Home](../README.md)",
      }),
      "utf8",
    );
    const issues = issuesFrom(() => validateVault(root, { checkInventory: false }));
    assert.match(issues, /source 'late-evidence\.md' does not exist at verified_commit/);
  });
});

test("reports source drift and sensitive operational values without echoing secrets", () => {
  withFixture((root) => {
    const guidePath = path.join(root, "Vault", "guides", "guide.md");
    writeFileSync(
      guidePath,
      note({
        id: "guide",
        title: "Guide",
        sources: ["missing.md"],
        body: [
          "Contact: operator@real-company.test",
          "Endpoint: hidden.tailabc123.ts.net",
          "Private endpoint: db.corp.internal",
          `container_id=${"a".repeat(64)}`,
          "Authorization: Basic ZWxldmFudDpTdXBlclNlY3JldDEyMyE=",
          "PASSWORD=ThisMustNeverBePrinted123!",
        ].join("\n"),
      }),
      "utf8",
    );
    const issues = issuesFrom(() => validateVault(root, { checkInventory: false }));
    assert.match(issues, /source 'missing\.md' does not exist/);
    assert.match(issues, /real email address detected/);
    assert.match(issues, /real Tailscale FQDN detected/);
    assert.match(issues, /private FQDN detected/);
    assert.match(issues, /Docker container identifier detected/);
    assert.match(issues, /HTTP Basic credential detected/);
    assert.match(issues, /possible literal secret detected/);
    assert.doesNotMatch(issues, /ThisMustNeverBePrinted123/);
  });
});

test("validates Canvas node references and Obsidian Base structure", () => {
  withFixture((root) => {
    writeFileSync(
      path.join(root, "Vault", "map.canvas"),
      JSON.stringify({
        nodes: [
          { id: "home", type: "file", file: "Vault/README.md", x: 0, y: 0, width: 100, height: 100 },
          { id: "escape", type: "file", file: "../AGENTS.md", x: 0, y: 0, width: 100, height: 100 },
          { id: "invalid", type: "not-a-canvas-node" },
        ],
        edges: [{ id: "bad-edge", fromNode: "home", toNode: "missing" }],
      }),
      "utf8",
    );
    writeFileSync(path.join(root, "Vault", "notes.base"), "filters:\n  and: []\n", "utf8");
    writeFileSync(path.join(root, "Vault", "broken.base"), "views: definitely-not-a-list\n", "utf8");
    const issues = issuesFrom(() => validateVault(root, { checkInventory: false }));
    assert.match(issues, /edge 'bad-edge' has invalid toNode/);
    assert.match(issues, /file node 'escape' points to missing/);
    assert.match(issues, /node 'invalid' has an unsupported type/);
    assert.match(issues, /node 'invalid' requires a finite numeric x/);
    assert.match(issues, /must define a top-level 'views' key/);
    assert.match(issues, /Obsidian Base 'views' must be a YAML sequence/);
  });
});

test("rejects invalid UTF-8 and malformed Obsidian JSON configuration", () => {
  withFixture((root) => {
    mkdirSync(path.join(root, ".obsidian"), { recursive: true });
    writeFileSync(path.join(root, ".obsidian", "app.json"), "{broken", "utf8");
    writeFileSync(path.join(root, "Vault", "asset.bin"), Buffer.from([0xc3, 0x28]));
    const issues = issuesFrom(() => validateVault(root, { checkInventory: false }));
    assert.match(issues, /invalid JSON/);
    assert.match(issues, /invalid UTF-8/);
  });
});

test("validates Mermaid declarations, fences and delimiters", () => {
  withFixture((root) => {
    const guidePath = path.join(root, "Vault", "guides", "guide.md");
    writeFileSync(
      guidePath,
      note({
        id: "guide",
        title: "Guide",
        body: [
          "```mermaid",
          "notADiagram",
          "A[Unclosed",
          "```",
          "",
          "```mermaid",
          "flowchart LR",
          "A --> B",
          "```",
          "",
          "```mermaid",
          "flowchart LR / A -->",
          "```",
          "",
          "```mermaid",
          "flowchart LR",
          "A ??? B",
          "```",
          "",
          "```mermaid",
          "flowchart LR",
          "A -->",
          "```",
          "",
          "```mermaid",
          "flowchart LR",
          "A --> B",
        ].join("\n"),
      }),
      "utf8",
    );
    const issues = issuesFrom(() => validateVault(root, { checkInventory: false }));
    assert.match(issues, /unsupported or malformed declaration/);
    assert.match(issues, /unbalanced delimiters/);
    assert.match(issues, /statement outside the supported syntax/);
    assert.match(issues, /incomplete relationship/);
    assert.match(issues, /is not closed/);
  });
});

test("detects generated inventory drift without rewriting it", () => {
  withFixture((root) => {
    const inventoryPath = path.join(root, INVENTORY_RELATIVE_PATH);
    const stale = readFileSync(inventoryPath, "utf8");
    writeFileSync(
      path.join(root, ".github", "workflows", "ci.yml"),
      "name: Changed CI\n",
      "utf8",
    );
    const issues = issuesFrom(() => validateVault(root));
    assert.match(issues, /generated inventory has drift/);
    assert.equal(readFileSync(inventoryPath, "utf8"), stale);
  });
});
