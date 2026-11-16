import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Configuration of the full-cycle E2E (ADR-0037). Credentials come from the stack's .env file
 * (E2E_CYCLE_ENV_FILE) and are never printed. Run state (the run's airline, contract, flight and
 * the passwords the run sets) lives outside the repository, in E2E_CYCLE_STATE_DIR.
 */
export const API = (process.env.E2E_CYCLE_API ?? "http://127.0.0.1:8080").replace(/\/$/, "");
export const MAILPIT = (process.env.E2E_CYCLE_MAILPIT ?? "http://127.0.0.1:8025").replace(/\/$/, "");
/** The browser talks to this HTTPS name (both apps' CSP require it); the specs forward it to API. */
export const PUBLIC_API = "https://api.stack.elevant.test";
export const PUBLIC_WEB = `http://localhost:${process.env.E2E_CYCLE_PUBLIC_PORT ?? 4174}`;
export const PRIVATE_WEB = `http://localhost:${process.env.E2E_CYCLE_PRIVATE_PORT ?? 4175}`;
export const STATE_DIR = process.env.E2E_CYCLE_STATE_DIR ?? path.join(os.tmpdir(), "elevant-e2e-cycle");
export const SHOTS_DIR = process.env.E2E_CYCLE_SHOTS_DIR ?? path.join(STATE_DIR, "shots");

export type Role = "occ" | "ramp" | "contracts" | "finance" | "hr" | "superadmin";

const SEEDED: Record<Role, { email: string; key: string }> = {
  occ: { email: "admin.occ@dev.elevant.test", key: "ELEVANT_DEV_ADMIN_ACCOUNT_PASSWORD" },
  ramp: { email: "ramp.agent@dev.elevant.test", key: "ELEVANT_DEV_RAMP_ACCOUNT_PASSWORD" },
  contracts: { email: "contratos@dev.elevant.test", key: "ELEVANT_DEV_CONTRACTS_ACCOUNT_PASSWORD" },
  finance: { email: "finanzas@dev.elevant.test", key: "ELEVANT_DEV_FINANCE_ACCOUNT_PASSWORD" },
  hr: { email: "gestion.humana@dev.elevant.test", key: "ELEVANT_DEV_HUMAN_RESOURCES_ACCOUNT_PASSWORD" },
  superadmin: { email: "super.admin@dev.elevant.test", key: "ELEVANT_DEV_SUPERADMIN_ACCOUNT_PASSWORD" },
};

let envCache: Record<string, string> | null = null;

function stackEnv(): Record<string, string> {
  if (envCache) return envCache;
  const file = process.env.E2E_CYCLE_ENV_FILE;
  if (!file || !fs.existsSync(file)) throw new Error("Set E2E_CYCLE_ENV_FILE to the stack .env file.");
  envCache = Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/)
    .filter(line => line && !line.startsWith("#") && line.includes("="))
    .map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
  return envCache;
}

function readJson<T>(name: string, fallback: T): T {
  const file = path.join(STATE_DIR, name);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) as T : fallback;
}

function writeJson(name: string, value: unknown) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(path.join(STATE_DIR, name), JSON.stringify(value, null, 2), { mode: 0o600 });
}

export function emailOf(role: Role) {
  return SEEDED[role].email;
}

/** The seeded password, or the one this harness set when the account had to change it. */
export function passwordOf(email: string): string {
  const saved = readJson<Record<string, string>>("passwords.json", {})[email];
  if (saved) return saved;
  const seeded = Object.values(SEEDED).find(item => item.email === email);
  const value = seeded ? stackEnv()[seeded.key] : undefined;
  if (!value) throw new Error(`No password is known for ${email}.`);
  return value;
}

export function savePassword(email: string, value: string) {
  writeJson("passwords.json", { ...readJson<Record<string, string>>("passwords.json", {}), [email]: value });
}

/** A strong password derived from the seeded one, so reruns stay deterministic per stack. */
export function nextPassword(current: string) {
  return `${current.slice(0, 40)}-E2e7`;
}

/** Facts one phase leaves for the next (the run's airline, contract, flight, invoice…). */
export type RunState = Record<string, unknown> & { runId: string; startedAt: string };

export function loadRun(): RunState {
  const run = readJson<RunState | null>("run.json", null);
  if (!run) throw new Error("No E2E run in progress: run the cycle from fase 1.");
  return run;
}

export function startRun(): RunState {
  fs.rmSync(SHOTS_DIR, { recursive: true, force: true }); // each run keeps only its own walkthrough
  const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
  const run: RunState = { runId, startedAt: new Date().toISOString() };
  writeJson("run.json", run);
  return run;
}

export function saveRun(changes: Record<string, unknown>): RunState {
  const run = { ...loadRun(), ...changes };
  writeJson("run.json", run);
  return run;
}
