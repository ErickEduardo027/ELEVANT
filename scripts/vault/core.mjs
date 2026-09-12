import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";

export const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "../..");
export const INVENTORY_RELATIVE_PATH =
  "Vault/_generated/repository-inventory.json";

export const REQUIRED_FRONTMATTER = Object.freeze([
  "id",
  "title",
  "type",
  "area",
  "status",
  "maturity",
  "evidence",
  "owner",
  "last_verified",
  "verified_commit",
  "sources",
  "tags",
]);

export const ENUMS = Object.freeze({
  type: new Set([
    "index",
    "guide",
    "concept",
    "architecture",
    "capability",
    "incident",
    "status",
    "policy",
    "template",
    "diagram",
    "runbook",
    "decision",
    "history",
    "backlog",
    "reference",
  ]),
  area: new Set([
    "vault",
    "product",
    "architecture",
    "domain",
    "applications",
    "backend",
    "database",
    "private-web",
    "public-web",
    "mobile",
    "api-client",
    "development",
    "ci-cd",
    "operations",
    "security",
    "governance",
    "history",
    "reference",
    "backlog",
  ]),
  status: new Set([
    "verified",
    "documented",
    "draft",
    "deferred",
    "deprecated",
    "historical",
  ]),
  maturity: new Set(["seed", "evolving", "stable", "retired"]),
  evidence: new Set([
    "repo-verified",
    "operator-recorded",
    "planned",
    "unknown",
  ]),
});

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const NOTE_EXTENSION = ".md";
const TEMPLATE_PREFIX = "Vault/99-plantillas/";

function isVaultNote(root, filePath) {
  const relativePath = repositoryPath(root, filePath);
  return (
    filePath.endsWith(NOTE_EXTENSION) &&
    relativePath !== "Vault/AGENTS.md" &&
    !relativePath.startsWith("Vault/.obsidian/")
  );
}

export class VaultValidationError extends Error {
  constructor(errors) {
    super(`Vault validation failed with ${errors.length} error(s).`);
    this.name = "VaultValidationError";
    this.errors = errors;
  }
}

export function toPosix(value) {
  return value.split(path.sep).join("/");
}

export function repositoryPath(root, absolutePath) {
  return toPosix(path.relative(root, absolutePath));
}

export function readUtf8(filePath) {
  const buffer = readFileSync(filePath);
  try {
    const text = UTF8_DECODER.decode(buffer);
    if (text.includes("\u0000")) {
      throw new Error("contains a NUL byte");
    }
    return text;
  } catch (error) {
    throw new Error(`invalid UTF-8 (${error.message})`);
  }
}

export function walkFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }

  const files = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name, "en"),
    )) {
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        files.push(absolute);
      } else if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile()) {
        files.push(absolute);
      }
    }
  };
  visit(directory);
  return files;
}

function pathExistsWithExactCase(anchorPath, absolutePath) {
  const anchor = path.resolve(anchorPath);
  const resolved = path.resolve(absolutePath);
  const relative = path.relative(anchor, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return false;
  }
  const segments = relative.split(path.sep).filter(Boolean);
  let current = anchor;
  for (const segment of segments) {
    if (!existsSync(current) || !statSync(current).isDirectory()) {
      return false;
    }
    if (!readdirSync(current).includes(segment)) {
      return false;
    }
    current = path.join(current, segment);
  }
  return existsSync(current);
}

function parseScalar(raw, location) {
  const value = raw.trim();
  if (value.length === 0) {
    return "";
  }
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`${location}: invalid double-quoted scalar`);
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length === 1) {
      throw new Error(`${location}: invalid single-quoted scalar`);
    }
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (value === "[]") {
    return [];
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (inner.length === 0) {
      return [];
    }
    return inner.split(",").map((item) => parseScalar(item, location));
  }
  return value;
}

export function parseFrontmatter(text, relativePath = "note") {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  if (lines[0]?.replace(/^\uFEFF/, "") !== "---") {
    throw new Error(`${relativePath}: frontmatter must start on line 1`);
  }
  const closingIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  if (closingIndex < 0) {
    throw new Error(`${relativePath}: frontmatter closing delimiter is missing`);
  }

  const metadata = Object.create(null);
  let activeArray = null;
  for (let index = 1; index < closingIndex; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    if (line.trim().length === 0 || line.trimStart().startsWith("#")) {
      continue;
    }
    if (line.includes("\t")) {
      throw new Error(`${relativePath}:${lineNumber}: tabs are not valid YAML indentation`);
    }

    const listMatch = /^  -\s+(.*)$/.exec(line);
    if (listMatch) {
      if (!activeArray) {
        throw new Error(`${relativePath}:${lineNumber}: list item has no parent key`);
      }
      metadata[activeArray].push(
        parseScalar(listMatch[1], `${relativePath}:${lineNumber}`),
      );
      continue;
    }

    const keyMatch = /^([a-z][a-z0-9_]*):(?:\s*(.*))?$/.exec(line);
    if (!keyMatch) {
      throw new Error(`${relativePath}:${lineNumber}: unsupported frontmatter syntax`);
    }
    const [, key, rawValue = ""] = keyMatch;
    if (Object.hasOwn(metadata, key)) {
      throw new Error(`${relativePath}:${lineNumber}: duplicate frontmatter key '${key}'`);
    }
    if (rawValue.length === 0) {
      metadata[key] = [];
      activeArray = key;
    } else {
      metadata[key] = parseScalar(rawValue, `${relativePath}:${lineNumber}`);
      activeArray = null;
    }
  }

  return {
    metadata,
    body: lines.slice(closingIndex + 1).join("\n"),
    bodyLineOffset: closingIndex + 1,
  };
}

function isTemplate(relativePath) {
  return relativePath.startsWith(TEMPLATE_PREFIX);
}

function isTemplateValue(value) {
  return (
    typeof value === "string" &&
    (/^<[^>]+>$/.test(value) || /^\{\{[^}]+\}\}$/.test(value))
  );
}

function addError(errors, relativePath, message) {
  errors.push(`${relativePath}: ${message}`);
}

function validateDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function resolveRepositorySource(root, notePath, source) {
  const clean = source.split("#", 1)[0];
  if (!clean) {
    return null;
  }
  if (/^(?:[a-z][a-z0-9+.-]*:|\/|\\|[A-Za-z]:[\\/])/i.test(clean)) {
    return null;
  }
  const absolute = clean.startsWith("./") || clean.startsWith("../")
    ? path.resolve(path.dirname(notePath), clean)
    : path.resolve(root, clean);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return absolute;
}

function validateMetadata(root, notePath, relativePath, metadata, errors) {
  const template = isTemplate(relativePath);
  for (const key of REQUIRED_FRONTMATTER) {
    if (!Object.hasOwn(metadata, key)) {
      addError(errors, relativePath, `missing required frontmatter key '${key}'`);
    }
  }
  for (const key of Object.keys(metadata)) {
    if (!REQUIRED_FRONTMATTER.includes(key)) {
      addError(errors, relativePath, `unknown frontmatter key '${key}'`);
    }
  }
  if (REQUIRED_FRONTMATTER.some((key) => !Object.hasOwn(metadata, key))) {
    return;
  }

  const metadataKeys = Object.keys(metadata);
  if (
    metadataKeys.length !== REQUIRED_FRONTMATTER.length ||
    metadataKeys.some((key, index) => key !== REQUIRED_FRONTMATTER[index])
  ) {
    addError(
      errors,
      relativePath,
      `frontmatter keys must use the documented order: ${REQUIRED_FRONTMATTER.join(", ")}`,
    );
  }

  for (const key of ["id", "title", "type", "area", "status", "maturity", "evidence", "owner", "last_verified", "verified_commit"]) {
    if (typeof metadata[key] !== "string" || metadata[key].trim().length === 0) {
      addError(errors, relativePath, `'${key}' must be a non-empty string`);
    }
  }

  if (
    typeof metadata.id === "string" &&
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.id) &&
    !(template && isTemplateValue(metadata.id))
  ) {
    addError(errors, relativePath, "'id' must be a lowercase kebab-case identifier");
  }
  if (
    typeof metadata.owner === "string" &&
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.owner) &&
    !(template && isTemplateValue(metadata.owner))
  ) {
    addError(errors, relativePath, "'owner' must be a lowercase kebab-case identifier");
  }

  for (const [key, allowed] of Object.entries(ENUMS)) {
    if (
      !allowed.has(metadata[key]) &&
      !(template && isTemplateValue(metadata[key]))
    ) {
      addError(
        errors,
        relativePath,
        `'${key}' must be one of: ${[...allowed].join(", ")}`,
      );
    }
  }

  if (
    !validateDate(metadata.last_verified) &&
    !(template && isTemplateValue(metadata.last_verified))
  ) {
    addError(errors, relativePath, "'last_verified' must be a real YYYY-MM-DD date");
  }
  const fullCommit =
    typeof metadata.verified_commit === "string" &&
    /^[0-9a-f]{40}$/.test(metadata.verified_commit);
  const lifecycleCommit =
    typeof metadata.verified_commit === "string" &&
    /^(?:unknown|pending|not-applicable)$/.test(metadata.verified_commit);
  if (
    !fullCommit &&
    !lifecycleCommit &&
    !(template && isTemplateValue(metadata.verified_commit))
  ) {
    addError(
      errors,
      relativePath,
      "'verified_commit' must be a full 40-character lowercase Git SHA or an explicit lifecycle marker",
    );
  }

  let commitExists = false;
  if (fullCommit) {
    commitExists = gitObjectExists(root, `${metadata.verified_commit}^{commit}`);
    if (!commitExists) {
      addError(errors, relativePath, `'verified_commit' does not identify a commit in this repository`);
    }
  }
  if (metadata.status === "verified") {
    if (!fullCommit) {
      addError(errors, relativePath, "status 'verified' requires a full verified_commit");
    }
    if (metadata.evidence === "planned" || metadata.evidence === "unknown") {
      addError(errors, relativePath, "status 'verified' requires repo-verified or operator-recorded evidence");
    }
  }

  for (const key of ["sources", "tags"]) {
    if (!Array.isArray(metadata[key])) {
      addError(errors, relativePath, `'${key}' must be a YAML list`);
    } else if (metadata[key].length === 0) {
      addError(errors, relativePath, `'${key}' must be a non-empty YAML list`);
    } else if (
      metadata[key].some(
        (item) => typeof item !== "string" || item.trim().length === 0,
      )
    ) {
      addError(errors, relativePath, `'${key}' must contain only non-empty strings`);
    }
  }

  if (Array.isArray(metadata.tags)) {
    for (const tag of metadata.tags) {
      if (
        typeof tag === "string" &&
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag) &&
        !(template && isTemplateValue(tag))
      ) {
        addError(errors, relativePath, `tag '${tag}' must be lowercase kebab-case`);
      }
    }
  }

  if (Array.isArray(metadata.sources)) {
    for (const source of metadata.sources) {
      if (typeof source !== "string" || (template && isTemplateValue(source))) {
        continue;
      }
      const resolved = resolveRepositorySource(root, notePath, source);
      if (!resolved) {
        addError(errors, relativePath, `source '${source}' must be a repository-relative path`);
      } else if (!pathExistsWithExactCase(root, resolved)) {
        addError(errors, relativePath, `source '${source}' does not exist`);
      } else if (lstatSync(resolved).isSymbolicLink()) {
        addError(errors, relativePath, `source '${source}' must not be a symbolic link`);
      } else if (
        metadata.status === "verified" &&
        fullCommit &&
        commitExists &&
        !gitObjectExists(
          root,
          `${metadata.verified_commit}:${repositoryPath(root, resolved)}`,
        )
      ) {
        addError(
          errors,
          relativePath,
          `source '${source}' does not exist at verified_commit`,
        );
      }
    }
  }
}

function stripCode(text) {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "")
    .replace(/`[^`\n]*`/g, "");
}

export function extractLinks(body) {
  const withoutCode = stripCode(body);
  const links = [];
  const markdown = /!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g;
  for (const match of withoutCode.matchAll(markdown)) {
    links.push(match[1] ?? match[2]);
  }
  const wiki = /!?\[\[([^\]]+)\]\]/g;
  for (const match of withoutCode.matchAll(wiki)) {
    links.push(match[1].split("|", 1)[0]);
  }
  return links;
}

function cleanLinkTarget(rawTarget) {
  const raw = rawTarget.trim();
  if (!raw || raw.startsWith("#")) {
    return null;
  }
  if (/^(?:https?:|mailto:|tel:)/i.test(raw)) {
    return { external: true, target: raw };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    return { unsupported: true, target: raw };
  }
  let target;
  try {
    target = decodeURIComponent(raw.split("#", 1)[0].split("?", 1)[0]);
  } catch {
    return { malformed: true, target: raw };
  }
  return target ? { external: false, target } : null;
}

function candidatesForLink(vaultRoot, notePath, target, allNotes) {
  const candidates = [];
  const addCandidate = (candidate) => {
    const normalized = path.normalize(candidate);
    if (!candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  addCandidate(path.resolve(path.dirname(notePath), target));
  addCandidate(path.resolve(vaultRoot, target));
  for (const base of [...candidates]) {
    if (!path.extname(base)) {
      addCandidate(`${base}.md`);
      addCandidate(path.join(base, "README.md"));
    }
  }

  if (!target.includes("/") && !target.includes("\\") && !path.extname(target)) {
    const byStem = allNotes.filter(
      (note) => path.basename(note, NOTE_EXTENSION) === target,
    );
    if (byStem.length === 1) {
      addCandidate(byStem[0]);
    }
  }
  return candidates;
}

function resolveMarkdownLink(root, vaultRoot, notePath, rawTarget, allNotes) {
  const cleaned = cleanLinkTarget(rawTarget);
  if (!cleaned || cleaned.external || cleaned.unsupported || cleaned.malformed) {
    return cleaned;
  }
  if (/^(?:\/|\\|[A-Za-z]:[\\/])/.test(cleaned.target)) {
    return { absolute: true, target: cleaned.target };
  }
  for (const candidate of candidatesForLink(vaultRoot, notePath, cleaned.target, allNotes)) {
    const relative = path.relative(root, candidate);
    if (
      !relative.startsWith("..") &&
      !path.isAbsolute(relative) &&
      pathExistsWithExactCase(root, candidate)
    ) {
      return { external: false, target: cleaned.target, resolved: candidate };
    }
  }
  return { external: false, target: cleaned.target, resolved: null };
}

function scanSensitiveData(relativePath, text, errors) {
  const lines = text.split(/\r?\n/);
  const patterns = [
    ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ["HTTP Basic credential", /\bAuthorization\s*:\s*Basic\s+[A-Za-z0-9+/]{8,}={0,2}(?![A-Za-z0-9+/=])/i],
    ["GitHub token", /\bgh[opusr]_[A-Za-z0-9_]{20,}\b/],
    ["Tailscale auth key", /\btskey-[A-Za-z0-9_-]{20,}\b/],
    ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
    ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const [label, pattern] of patterns) {
      if (pattern.test(line)) {
        addError(errors, relativePath, `${label} detected on line ${index + 1}`);
      }
    }

    for (const email of line.matchAll(/\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi)) {
      const domain = email[1].toLowerCase();
      if (!/^(?:example\.(?:com|net|org)|example\.invalid)$/.test(domain)) {
        addError(errors, relativePath, `real email address detected on line ${index + 1}`);
      }
    }
    if (/\b(?:[a-z0-9-]+\.)+ts\.net\b/i.test(line)) {
      addError(errors, relativePath, `real Tailscale FQDN detected on line ${index + 1}`);
    }
    if (/\bsrv\d{4,}\b/i.test(line)) {
      addError(errors, relativePath, `real host identifier detected on line ${index + 1}`);
    }
    if (/\b(?:[a-z0-9-]+\.)+(?:internal|local|lan|home|corp)\b/i.test(line)) {
      addError(errors, relativePath, `private FQDN detected on line ${index + 1}`);
    }
    if (
      /\b(?:container(?:[_ -]?id)?|docker[_ -]?id)\b\s*[:=]\s*["']?[0-9a-f]{64}\b/i.test(
        line,
      )
    ) {
      addError(errors, relativePath, `Docker container identifier detected on line ${index + 1}`);
    }

    for (const match of line.matchAll(/(?<![\d.])(\d{1,3}(?:\.\d{1,3}){3})(?![\d.])/g)) {
      const octets = match[1].split(".").map(Number);
      if (octets.some((octet) => octet > 255)) {
        continue;
      }
      const allowed =
        octets[0] === 127 ||
        octets.every((octet) => octet === 0) ||
        (octets[0] === 192 && octets[1] === 0 && octets[2] === 2) ||
        (octets[0] === 198 && octets[1] === 51 && octets[2] === 100) ||
        (octets[0] === 203 && octets[1] === 0 && octets[2] === 113);
      if (!allowed) {
        addError(errors, relativePath, `real IPv4 address detected on line ${index + 1}`);
      }
    }
    if (/\bfd7a:[0-9a-f:]+\b/i.test(line)) {
      addError(errors, relativePath, `real Tailscale IPv6 address detected on line ${index + 1}`);
    }

    const assignment = /\b(?:password|passwd|pwd|secret|token|api[_-]?key)\b\s*[:=]\s*["']?([^\s"']+)/i.exec(line);
    if (assignment) {
      const value = assignment[1].replace(/[;,]$/, "");
      const placeholder = /^(?:<[^>]+>|\$\{[^}]+\}|\{\{[^}]+\}\}|example|placeholder|redacted|REDACTED|unknown|none)$/i.test(value);
      if (!placeholder && value.length >= 8) {
        addError(errors, relativePath, `possible literal secret detected on line ${index + 1}`);
      }
    }
  }
}

function validateMermaidStatements(relativePath, startLine, content, errors) {
  const declaration = content[0];
  const statements = content.slice(1);

  if (/^(?:flowchart|graph)\s+/.test(declaration)) {
    let subgraphDepth = 0;
    for (const statement of statements) {
      const line = statement.replace(/;$/, "").trim();
      if (/^subgraph\s+[A-Za-z_][A-Za-z0-9_-]*(?:\[[\s\S]+\])?$/.test(line)) {
        subgraphDepth += 1;
        continue;
      }
      if (line === "end") {
        subgraphDepth -= 1;
        if (subgraphDepth < 0) {
          addError(errors, relativePath, `Mermaid block on line ${startLine} closes an unopened subgraph`);
          subgraphDepth = 0;
        }
        continue;
      }
      if (
        /^(?:direction\s+(?:TB|TD|BT|RL|LR)|classDef\s+[A-Za-z_][A-Za-z0-9_-]*\s+.+|class\s+[A-Za-z_][A-Za-z0-9_,-]*\s+[A-Za-z_][A-Za-z0-9_-]*|style\s+[A-Za-z_][A-Za-z0-9_-]*\s+.+|linkStyle\s+.+|click\s+.+)$/.test(
          line,
        )
      ) {
        continue;
      }

      const nodeDeclaration =
        /^[A-Za-z_][A-Za-z0-9_-]*\s*(?:\[\(|\[\[|\[\||\[|\(\(|\(|\{\{|\{)[\s\S]+/;
      const relationship = /(?:-->|---|==>|-\.->|-\.[\s\S]+\.->)/;
      if (!nodeDeclaration.test(line) && !relationship.test(line)) {
        addError(
          errors,
          relativePath,
          `Mermaid flowchart block on line ${startLine} contains a statement outside the supported syntax`,
        );
      }
    }
    if (subgraphDepth !== 0) {
      addError(errors, relativePath, `Mermaid block on line ${startLine} has an unclosed subgraph`);
    }
    return;
  }

  if (declaration === "sequenceDiagram") {
    for (const statement of statements) {
      const line = statement.trim();
      if (
        /^(?:(?:actor|participant)\s+[A-Za-z_][A-Za-z0-9_-]*(?:\s+as\s+.+)?|[A-Za-z_][A-Za-z0-9_-]*\s*(?:->>|-->>|->|-->|-x|--x|-\)|--\))[A-Za-z_][A-Za-z0-9_-]*\s*:\s*.+|(?:activate|deactivate)\s+[A-Za-z_][A-Za-z0-9_-]*|(?:loop|alt|else|opt|par|and|critical|option|break|rect)\b.*|end|Note\s+(?:left of|right of|over)\s+.+:\s*.+)$/.test(
          line,
        )
      ) {
        continue;
      }
      addError(
        errors,
        relativePath,
        `Mermaid sequence block on line ${startLine} contains a statement outside the supported syntax`,
      );
    }
  }
}

function validateMermaidBlocks(relativePath, text, errors) {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const declarations = /^(?:(?:flowchart|graph)\s+(?:TB|TD|BT|RL|LR)|sequenceDiagram)$/;
  const pairs = new Map([["(", ")"], ["[", "]"], ["{", "}"]]);

  for (let index = 0; index < lines.length; index += 1) {
    const opening = /^\s*(```|~~~)mermaid\s*$/.exec(lines[index]);
    if (!opening) {
      continue;
    }
    const fence = opening[1];
    const startLine = index + 1;
    const body = [];
    index += 1;
    while (index < lines.length && !new RegExp(`^\\s*${fence}\\s*$`).test(lines[index])) {
      body.push(lines[index]);
      index += 1;
    }
    if (index >= lines.length) {
      addError(errors, relativePath, `Mermaid block opened on line ${startLine} is not closed`);
      return;
    }

    const content = body
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("%%"));
    if (content.length === 0) {
      addError(errors, relativePath, `Mermaid block on line ${startLine} is empty`);
      continue;
    }
    if (!declarations.test(content[0])) {
      addError(
        errors,
        relativePath,
        `Mermaid block on line ${startLine} has an unsupported or malformed declaration`,
      );
    } else {
      validateMermaidStatements(relativePath, startLine, content, errors);
    }
    if (content.length === 1) {
      addError(errors, relativePath, `Mermaid block on line ${startLine} has no diagram statements`);
    }
    if (
      content.slice(1).some((line) => /(?:-->|-\.->|==>|---)\s*(?:\|[^|]*\|\s*)?$/.test(line))
    ) {
      addError(errors, relativePath, `Mermaid block on line ${startLine} has an incomplete relationship`);
    }
    if (content.some((line) => /\bjavascript\s*:/i.test(line))) {
      addError(errors, relativePath, `Mermaid block on line ${startLine} contains a javascript URL`);
    }

    const stack = [];
    let quote = null;
    let escaped = false;
    for (const character of body.join("\n")) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\" && quote) {
        escaped = true;
        continue;
      }
      if (quote) {
        if (character === quote) {
          quote = null;
        }
        continue;
      }
      if (character === '"') {
        quote = character;
      } else if (pairs.has(character)) {
        stack.push(character);
      } else if ([...pairs.values()].includes(character)) {
        const openingCharacter = stack.pop();
        if (!openingCharacter || pairs.get(openingCharacter) !== character) {
          addError(errors, relativePath, `Mermaid block on line ${startLine} has unbalanced delimiters`);
          stack.length = 0;
          break;
        }
      }
    }
    if (stack.length > 0 || quote) {
      addError(errors, relativePath, `Mermaid block on line ${startLine} has unbalanced delimiters or quotes`);
    }
  }
}

function validateJsonFile(relativePath, text, errors) {
  try {
    return JSON.parse(text);
  } catch (error) {
    addError(errors, relativePath, `invalid JSON (${error.message})`);
    return null;
  }
}

function validateObsidianConfig(relativePath, document, errors) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    addError(errors, relativePath, "shared Obsidian configuration must be a JSON object");
    return;
  }

  if (relativePath === ".obsidian/app.json") {
    const expected = {
      alwaysUpdateLinks: true,
      newFileLocation: "current",
      newLinkFormat: "relative",
      useMarkdownLinks: true,
    };
    for (const [key, value] of Object.entries(expected)) {
      if (document[key] !== value) {
        addError(errors, relativePath, `'${key}' must remain ${JSON.stringify(value)}`);
      }
    }
    const requiredIgnoreFilters = [
      "/(^|\\/)node_modules\\//",
      "/(^|\\/)(\\.git|\\.worktrees|\\.expo|\\.next|\\.astro)\\//",
      "/(^|\\/)(bin|obj|dist|build|coverage|artifacts|TestResults)\\//",
    ];
    if (
      !Array.isArray(document.userIgnoreFilters) ||
      requiredIgnoreFilters.some((filter) => !document.userIgnoreFilters.includes(filter))
    ) {
      addError(errors, relativePath, "generated dependency and build directories must remain excluded");
    }
  } else if (relativePath === ".obsidian/core-plugins.json") {
    for (const [plugin, enabled] of Object.entries(document)) {
      if (typeof enabled !== "boolean") {
        addError(errors, relativePath, `core plugin '${plugin}' must use a boolean state`);
      }
    }
    for (const plugin of [
      "backlink",
      "bases",
      "canvas",
      "file-explorer",
      "global-search",
      "graph",
      "outgoing-link",
      "page-preview",
      "properties",
      "templates",
    ]) {
      if (document[plugin] !== true) {
        addError(errors, relativePath, `required native plugin '${plugin}' must remain enabled`);
      }
    }
  } else if (relativePath === ".obsidian/templates.json") {
    if (document.folder !== "Vault/99-plantillas") {
      addError(errors, relativePath, "template folder must remain 'Vault/99-plantillas'");
    }
  } else if (relativePath === ".obsidian/graph.json") {
    if (
      typeof document.search !== "string" ||
      !document.search.includes('path:"Vault"') ||
      !document.search.includes('path:"docs"') ||
      !document.search.includes('path:"ops/dokploy"') ||
      !document.search.includes('-path:"Vault/99-plantillas"')
    ) {
      addError(errors, relativePath, "graph search must focus on Vault and exclude its templates");
    }
    if (document.showTags !== false) {
      addError(errors, relativePath, "graph tags must remain hidden to keep note relationships legible");
    }
  }
}

function validateCanvas(root, vaultRoot, filePath, relativePath, text, errors) {
  const canvas = validateJsonFile(relativePath, text, errors);
  if (!canvas) {
    return;
  }
  if (!Array.isArray(canvas.nodes) || !Array.isArray(canvas.edges)) {
    addError(errors, relativePath, "Canvas must contain 'nodes' and 'edges' arrays");
    return;
  }
  const nodeIds = new Set();
  const nodeTypes = new Set(["text", "file", "link", "group"]);
  for (const node of canvas.nodes) {
    if (!node || typeof node !== "object" || typeof node.id !== "string" || !node.id) {
      addError(errors, relativePath, "every Canvas node must have a non-empty string id");
      continue;
    }
    if (nodeIds.has(node.id)) {
      addError(errors, relativePath, `duplicate Canvas node id '${node.id}'`);
    }
    nodeIds.add(node.id);
    if (typeof node.type !== "string" || !nodeTypes.has(node.type)) {
      addError(errors, relativePath, `node '${node.id}' has an unsupported type`);
    }
    for (const coordinate of ["x", "y", "width", "height"]) {
      if (typeof node[coordinate] !== "number" || !Number.isFinite(node[coordinate])) {
        addError(errors, relativePath, `node '${node.id}' requires a finite numeric ${coordinate}`);
      }
    }
    if (node.type === "text" && typeof node.text !== "string") {
      addError(errors, relativePath, `text node '${node.id}' requires text`);
    }
    if (
      node.type === "link" &&
      (typeof node.url !== "string" || !/^https?:\/\//i.test(node.url))
    ) {
      addError(errors, relativePath, `link node '${node.id}' requires an HTTP(S) URL`);
    }
    if (node.type === "file") {
      if (typeof node.file !== "string" || !node.file) {
        addError(errors, relativePath, `file node '${node.id}' has no file path`);
      } else {
        const candidates = [path.resolve(root, node.file)].filter((candidate) => {
          const relative = path.relative(root, candidate);
          return !relative.startsWith("..") && !path.isAbsolute(relative);
        });
        if (!candidates.some((candidate) => pathExistsWithExactCase(root, candidate))) {
          addError(errors, relativePath, `file node '${node.id}' points to missing '${node.file}'`);
        }
      }
    }
  }
  const edgeIds = new Set();
  for (const edge of canvas.edges) {
    if (!edge || typeof edge !== "object" || typeof edge.id !== "string" || !edge.id) {
      addError(errors, relativePath, "every Canvas edge must have a non-empty string id");
      continue;
    }
    if (edgeIds.has(edge.id)) {
      addError(errors, relativePath, `duplicate Canvas edge id '${edge.id}'`);
    }
    edgeIds.add(edge.id);
    for (const endpoint of ["fromNode", "toNode"]) {
      if (typeof edge[endpoint] !== "string" || !nodeIds.has(edge[endpoint])) {
        addError(errors, relativePath, `edge '${edge.id}' has invalid ${endpoint}`);
      }
    }
  }
}

function validateObsidianBase(relativePath, text, errors) {
  validateYamlSubset(relativePath, text, errors, { requireViews: true });
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const viewsIndex = lines.findIndex((line) => /^views\s*:/.test(line));
  if (viewsIndex < 0) {
    return;
  }
  if (!/^views:\s*$/.test(lines[viewsIndex])) {
    addError(errors, relativePath, "Obsidian Base 'views' must be a YAML sequence");
    return;
  }

  const supportedViewTypes = new Set(["table", "cards", "list", "map"]);
  const views = [];
  let activeView = null;
  for (let index = viewsIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[^\s#][^:]*:/.test(line)) {
      break;
    }
    const typeMatch = /^  - type:\s*([a-z][a-z0-9-]*)\s*$/.exec(line);
    if (typeMatch) {
      activeView = { type: typeMatch[1], name: null };
      views.push(activeView);
      continue;
    }
    const nameMatch = /^    name:\s*(.+?)\s*$/.exec(line);
    if (nameMatch && activeView) {
      activeView.name = nameMatch[1].replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2");
    }
  }

  if (views.length === 0) {
    addError(errors, relativePath, "Obsidian Base 'views' must be a YAML sequence");
    return;
  }
  for (const [index, view] of views.entries()) {
    if (!supportedViewTypes.has(view.type)) {
      addError(errors, relativePath, `Obsidian Base view ${index + 1} has unsupported type '${view.type}'`);
    }
    if (!view.name) {
      addError(errors, relativePath, `Obsidian Base view ${index + 1} requires a name`);
    }
  }
}

function validateYamlSubset(relativePath, text, errors, { requireViews = false } = {}) {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const indentation = [0];
  let blockIndent = null;
  let sawContent = false;
  let sawViews = false;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const lineNumber = index + 1;
    if (!raw.trim() || raw.trimStart().startsWith("#")) {
      continue;
    }
    sawContent = true;
    if (raw.includes("\t")) {
      addError(errors, relativePath, `tabs are not valid YAML indentation (line ${lineNumber})`);
      continue;
    }
    const spaces = raw.length - raw.trimStart().length;
    if (spaces % 2 !== 0) {
      addError(errors, relativePath, `YAML indentation must use multiples of two spaces (line ${lineNumber})`);
    }
    if (blockIndent !== null) {
      if (spaces > blockIndent) {
        continue;
      }
      blockIndent = null;
    }

    while (indentation.at(-1) > spaces) {
      indentation.pop();
    }
    if (spaces > indentation.at(-1)) {
      if (spaces !== indentation.at(-1) + 2) {
        addError(errors, relativePath, `YAML indentation jumps more than one level (line ${lineNumber})`);
      }
      indentation.push(spaces);
    }

    const content = raw.trim();
    if (spaces === 0 && /^views\s*:/.test(content)) {
      sawViews = true;
    }
    const mapping = /^(?:-\s+)?(?:[A-Za-z_][A-Za-z0-9_.-]*|"[^"]+"|'[^']+')\s*:\s*(.*)$/.exec(content);
    const scalarSequence = /^-\s+.+$/.test(content);
    if (!mapping && !scalarSequence) {
      addError(errors, relativePath, `unsupported or malformed YAML (line ${lineNumber})`);
      continue;
    }
    const value = mapping?.[1] ?? content.slice(1).trim();
    if (/^[|>][-+]?\s*$/.test(value)) {
      blockIndent = spaces;
      continue;
    }

    let quote = null;
    const brackets = [];
    for (let cursor = 0; cursor < value.length; cursor += 1) {
      const character = value[cursor];
      if (quote) {
        if (character === quote && value[cursor - 1] !== "\\") {
          quote = null;
        }
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === "[" || character === "{") {
        brackets.push(character);
      } else if (character === "]" || character === "}") {
        const expected = character === "]" ? "[" : "{";
        if (brackets.pop() !== expected) {
          addError(errors, relativePath, `unbalanced YAML flow collection (line ${lineNumber})`);
          break;
        }
      } else if (character === "#" && /\s/.test(value[cursor - 1] ?? "")) {
        break;
      }
    }
    if (quote) {
      addError(errors, relativePath, `unterminated YAML quote (line ${lineNumber})`);
    }
    if (brackets.length > 0) {
      addError(errors, relativePath, `unbalanced YAML flow collection (line ${lineNumber})`);
    }
  }
  if (!sawContent) {
    addError(errors, relativePath, "YAML file is empty");
  }
  if (requireViews && !sawViews) {
    addError(errors, relativePath, "Obsidian Base must define a top-level 'views' key");
  }
}

function hashFile(filePath) {
  const canonicalText = readUtf8(filePath).replaceAll("\r\n", "\n");
  return createHash("sha256").update(canonicalText, "utf8").digest("hex");
}

function gitObjectExists(root, objectName) {
  try {
    execFileSync("git", ["cat-file", "-e", objectName], {
      cwd: root,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function gitRootCommit(root) {
  try {
    const output = execFileSync(
      "git",
      ["rev-list", "--max-parents=0", "HEAD"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return output.trim().split(/\r?\n/).filter(Boolean).sort()[0] ?? null;
  } catch {
    return null;
  }
}

function collectFiles(root, relativeDirectory, predicate = () => true) {
  const directory = path.join(root, relativeDirectory);
  return walkFiles(directory)
    .filter((filePath) => predicate(repositoryPath(root, filePath), filePath))
    .map((filePath) => ({
      path: repositoryPath(root, filePath),
      sha256: hashFile(filePath),
    }));
}

export function buildInventory(root = REPOSITORY_ROOT) {
  const vaultRoot = path.join(root, "Vault");
  const notes = walkFiles(vaultRoot)
    .filter((filePath) => isVaultNote(root, filePath))
    .map((filePath) => {
      const relativePath = repositoryPath(root, filePath);
      const { metadata } = parseFrontmatter(readUtf8(filePath), relativePath);
      return {
        path: relativePath,
        id: metadata.id ?? null,
        title: metadata.title ?? null,
        type: metadata.type ?? null,
        area: metadata.area ?? null,
        status: metadata.status ?? null,
        maturity: metadata.maturity ?? null,
        evidence: metadata.evidence ?? null,
      };
    });

  const openapi = [
    "packages/api-client/openapi/elevant-v1.json",
    "packages/api-client/openapi/source.json",
  ]
    .filter((relativePath) => existsSync(path.join(root, relativePath)))
    .map((relativePath) => {
      const filePath = path.join(root, relativePath);
      let title = null;
      let version = null;
      try {
        const document = JSON.parse(readUtf8(filePath));
        title = document.info?.title ?? null;
        version = document.info?.version ?? null;
      } catch {
        // The validator reports malformed JSON separately when it is in the Vault.
      }
      return { path: relativePath, sha256: hashFile(filePath), title, version };
    });

  const migrationsDirectory = path.join(
    root,
    "database/DevelopmentDB/Elevant.Persistence/Persistence/Migrations",
  );
  const migrations = walkFiles(migrationsDirectory)
    .filter(
      (filePath) =>
        /[\\/]\d{14}_[^\\/]+\.cs$/.test(filePath) &&
        !filePath.endsWith(".Designer.cs"),
    )
    .map((filePath) => {
      const fileName = path.basename(filePath, ".cs");
      const match = /^(\d{14})_(.+)$/.exec(fileName);
      return {
        id: match[1],
        name: match[2],
        path: repositoryPath(root, filePath),
        sha256: hashFile(filePath),
      };
    });

  const manifestContracts = [
    "backend/scripts/deployment/api_release_manifest.py",
    "database/DevelopmentDB/scripts/deployment/database_release_manifest.py",
    "frontend/scripts/deployment/web_release_manifest.py",
    "ops/dokploy/api-cd/manifest-tool.mjs",
    "ops/dokploy/database-cd/manifest-tool.mjs",
    "ops/dokploy/web-cd/manifest-tool.mjs",
  ]
    .filter((relativePath) => existsSync(path.join(root, relativePath)))
    .map((relativePath) => ({
      path: relativePath,
      sha256: hashFile(path.join(root, relativePath)),
    }));

  return {
    schemaVersion: 1,
    repository: {
      rootCommit: gitRootCommit(root),
    },
    vault: {
      notes,
      canvases: collectFiles(root, "Vault", (relativePath) => relativePath.endsWith(".canvas")),
      bases: collectFiles(root, "Vault", (relativePath) => relativePath.endsWith(".base")),
      obsidianConfig: collectFiles(root, ".obsidian", (relativePath) => relativePath.endsWith(".json")),
    },
    contracts: {
      workflows: collectFiles(root, ".github/workflows", (relativePath) => /\.ya?ml$/.test(relativePath)),
      openapi,
      migrations,
      manifestContracts,
    },
  };
}

export function serializeInventory(inventory) {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

export function writeInventory(root = REPOSITORY_ROOT) {
  const destination = path.resolve(root, INVENTORY_RELATIVE_PATH);
  const generatedRoot = path.resolve(root, "Vault/_generated");
  const relative = path.relative(generatedRoot, destination);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("refusing to write outside Vault/_generated");
  }
  mkdirSync(generatedRoot, { recursive: true });
  writeFileSync(destination, serializeInventory(buildInventory(root)), "utf8");
  return destination;
}

export function validateVault(root = REPOSITORY_ROOT, { checkInventory = true } = {}) {
  const errors = [];
  const vaultRoot = path.join(root, "Vault");
  if (!existsSync(vaultRoot) || !statSync(vaultRoot).isDirectory()) {
    throw new VaultValidationError(["Vault: directory does not exist"]);
  }

  const allFiles = walkFiles(vaultRoot);
  for (const filePath of allFiles) {
    const relativePath = repositoryPath(root, filePath);
    if (lstatSync(filePath).isSymbolicLink()) {
      addError(errors, relativePath, "symbolic links are not allowed in the Vault");
      continue;
    }
    try {
      const text = readUtf8(filePath);
      scanSensitiveData(relativePath, text, errors);
      if (filePath.endsWith(".canvas")) {
        validateCanvas(root, vaultRoot, filePath, relativePath, text, errors);
      } else if (filePath.endsWith(".base")) {
        validateObsidianBase(relativePath, text, errors);
      } else if (filePath.endsWith(".md")) {
        validateMermaidBlocks(relativePath, text, errors);
      } else if (/\.ya?ml$/i.test(filePath)) {
        validateYamlSubset(relativePath, text, errors);
      }
    } catch (error) {
      addError(errors, relativePath, error.message);
    }
  }

  const obsidianRoot = path.join(root, ".obsidian");
  for (const requiredConfig of [
    "app.json",
    "appearance.json",
    "core-plugins.json",
    "graph.json",
    "templates.json",
  ]) {
    if (!pathExistsWithExactCase(obsidianRoot, path.join(obsidianRoot, requiredConfig))) {
      addError(errors, `.obsidian/${requiredConfig}`, "required shared Obsidian configuration is missing");
    }
  }
  for (const filePath of walkFiles(obsidianRoot)) {
    const relativePath = repositoryPath(root, filePath);
    if (lstatSync(filePath).isSymbolicLink()) {
      addError(errors, relativePath, "symbolic links are not allowed in shared Obsidian configuration");
      continue;
    }
    try {
      const text = readUtf8(filePath);
      scanSensitiveData(relativePath, text, errors);
      if (!filePath.endsWith(".json")) {
        addError(errors, relativePath, "only JSON files belong in shared Obsidian configuration");
      } else {
        const document = validateJsonFile(relativePath, text, errors);
        validateObsidianConfig(relativePath, document, errors);
      }
    } catch (error) {
      addError(errors, relativePath, error.message);
    }
  }

  const notes = allFiles.filter((filePath) => isVaultNote(root, filePath));
  const noteSet = new Set(notes.map((filePath) => path.normalize(filePath)));
  const ids = new Map();
  const graph = new Map(notes.map((filePath) => [path.normalize(filePath), new Set()]));

  for (const notePath of notes) {
    const relativePath = repositoryPath(root, notePath);
    let parsed;
    try {
      parsed = parseFrontmatter(readUtf8(notePath), relativePath);
    } catch (error) {
      addError(errors, relativePath, error.message.replace(`${relativePath}: `, ""));
      continue;
    }
    validateMetadata(root, notePath, relativePath, parsed.metadata, errors);
    if (typeof parsed.metadata.id === "string" && parsed.metadata.id) {
      const prior = ids.get(parsed.metadata.id);
      if (prior) {
        addError(errors, relativePath, `duplicate id '${parsed.metadata.id}' (already used by ${prior})`);
      } else {
        ids.set(parsed.metadata.id, relativePath);
      }
    }

    for (const rawTarget of extractLinks(parsed.body)) {
      if (isTemplate(relativePath) && /(?:<[^>]+>|\{\{[^}]+\}\})/.test(rawTarget)) {
        continue;
      }
      const link = resolveMarkdownLink(root, vaultRoot, notePath, rawTarget, notes);
      if (!link) {
        continue;
      }
      if (link.malformed) {
        addError(errors, relativePath, `malformed Markdown link '${rawTarget}'`);
      } else if (link.unsupported) {
        addError(errors, relativePath, `unsupported link scheme in '${rawTarget}'`);
      } else if (link.absolute) {
        addError(errors, relativePath, `local link '${rawTarget}' must be relative`);
      } else if (!link.external && !link.resolved) {
        addError(errors, relativePath, `link target '${rawTarget}' does not exist`);
      } else if (link.resolved && noteSet.has(path.normalize(link.resolved))) {
        graph.get(path.normalize(notePath)).add(path.normalize(link.resolved));
      }
    }
  }

  const entrypoint = path.normalize(path.join(vaultRoot, "README.md"));
  if (!noteSet.has(entrypoint)) {
    addError(errors, "Vault/README.md", "required reachability entrypoint does not exist");
  } else {
    const visited = new Set();
    const pending = [entrypoint];
    while (pending.length > 0) {
      const current = pending.pop();
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);
      for (const neighbor of graph.get(current) ?? []) {
        pending.push(neighbor);
      }
    }
    for (const note of noteSet) {
      if (!visited.has(note)) {
        addError(errors, repositoryPath(root, note), "note is not reachable from Vault/README.md");
      }
    }
  }

  if (checkInventory) {
    const inventoryPath = path.join(root, INVENTORY_RELATIVE_PATH);
    if (!existsSync(inventoryPath)) {
      addError(errors, INVENTORY_RELATIVE_PATH, "generated inventory is missing; run npm run vault:generate");
    } else {
      try {
        const actual = readUtf8(inventoryPath);
        const expected = serializeInventory(buildInventory(root));
        if (actual !== expected) {
          addError(errors, INVENTORY_RELATIVE_PATH, "generated inventory has drift; run npm run vault:generate");
        }
      } catch (error) {
        addError(errors, INVENTORY_RELATIVE_PATH, error.message);
      }
    }
  }

  if (errors.length > 0) {
    throw new VaultValidationError([...new Set(errors)].sort());
  }
  return {
    notes: notes.length,
    canvases: allFiles.filter((filePath) => filePath.endsWith(".canvas")).length,
    bases: allFiles.filter((filePath) => filePath.endsWith(".base")).length,
  };
}
