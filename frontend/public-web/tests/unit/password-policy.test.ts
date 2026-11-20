import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  IDENTITY_PASSWORD_OPTIONS,
  PASSWORD_REQUIREMENTS_NOTE,
  meetsPasswordPolicy,
  passwordRequirements,
} from "@/lib/password-policy";

/** Whether each requirement is met, by its id. */
const states = (password: string, temporaryPassword?: string) => Object.fromEntries(
  passwordRequirements(password, temporaryPassword).map(requirement => [requirement.id, requirement.met]));

/** One UTF-16 code unit, so the invisible and look-alike characters below stay readable. */
const char = (code: number) => String.fromCharCode(code);

describe("passwordRequirements (N17)", () => {
  it("lists the rules of the API, all pending before anything is typed", () => {
    expect(passwordRequirements("").map(({ id, label, met }) => [id, label, met])).toEqual([
      ["length", "Al menos 14 caracteres", false],
      ["uppercase", "Una letra mayúscula (A–Z)", false],
      ["lowercase", "Una letra minúscula (a–z)", false],
      ["digit", "Un número (0–9)", false],
      ["symbol", "Un símbolo, como !, # o -", false],
    ]);
    expect(PASSWORD_REQUIREMENTS_NOTE)
      .toBe("La ñ y las letras con tilde, como la É, cuentan como símbolo, no como mayúscula ni minúscula.");
  });

  it("adds «Distinta de la contraseña temporal» when the password replaces a temporary one", () => {
    expect(passwordRequirements("", "Synthetic-Temporary!2026").at(-1))
      .toEqual({ id: "different", label: "Distinta de la contraseña temporal", met: false });
    expect(states("Synthetic-Temporary!2026", "Synthetic-Temporary!2026")).toEqual(
      { length: true, uppercase: true, lowercase: true, digit: true, symbol: true, different: false });
    // The API compares both ordinally: another case is another password.
    expect(states("synthetic-temporarY!2026", "Synthetic-Temporary!2026").different).toBe(true);
    expect(meetsPasswordPolicy("Synthetic-Temporary!2026", "Synthetic-Temporary!2026")).toBe(false);
    expect(meetsPasswordPolicy("Synthetic-New-Password!2026", "Synthetic-Temporary!2026")).toBe(true);
  });

  it("counts the length in UTF-16 code units, as String.Length does", () => {
    expect(states("Aa1-567890123").length).toBe(false);
    expect(states("Aa1-5678901234").length).toBe(true);
    // Each emoji is two code units: twelve characters on screen are fourteen for the API.
    expect([..."Aa1-567890😀😀"]).toHaveLength(12);
    expect(states("Aa1-567890😀😀").length).toBe(true);
  });

  it("treats a password of only white space as too short, by .NET's white space", () => {
    expect(states(" ".repeat(20)).length).toBe(false);
    // IDEOGRAPHIC SPACE.
    expect(states(char(0x3000).repeat(14)).length).toBe(false);
    // NEXT LINE is white space for .NET and not for JavaScript's \s; the BOM (U+FEFF) is the other way round.
    expect(states(char(0x85).repeat(14)).length).toBe(false);
    expect(states(char(0xfeff).repeat(14)).length).toBe(true);
    // Among other characters, a space counts, and as a symbol.
    expect(states("Abc def 123456")).toEqual({ length: true, uppercase: true, lowercase: true, digit: true, symbol: true });
  });

  it("counts only A–Z and a–z as upper and lower case: «É» and «ñ» are symbols", () => {
    expect(states("ÉÑÜ")).toMatchObject({ uppercase: false, lowercase: false, symbol: true });
    expect(states("éñü")).toMatchObject({ uppercase: false, lowercase: false, symbol: true });
    expect(states("Abcdefghijkl12")).toMatchObject({ symbol: false });
    expect(states("Abcdefghijkl1É")).toMatchObject({ symbol: true });
    expect(meetsPasswordPolicy("Contraseñaaaa1")).toBe(true);
    expect(meetsPasswordPolicy("contraseñaaaa1")).toBe(false);
    expect(meetsPasswordPolicy("ÉSTAESMICLAVE1É")).toBe(false);
  });

  it("counts only 0–9 as digits", () => {
    // ARABIC-INDIC DIGIT THREE and FULLWIDTH DIGIT THREE are symbols for Identity.
    expect(states(`Abcdefghijkl-${char(0x663)}`)).toMatchObject({ digit: false, symbol: true });
    expect(states(`Abcdefghijkl-${char(0xff13)}`)).toMatchObject({ digit: false, symbol: true });
  });

  it("needs every rule at once", () => {
    expect(meetsPasswordPolicy("Synthetic-New-Password!2026")).toBe(true);
    expect(meetsPasswordPolicy("synthetic-new-password!2026")).toBe(false);
    expect(meetsPasswordPolicy("SYNTHETIC-NEW-PASSWORD!2026")).toBe(false);
    expect(meetsPasswordPolicy("Synthetic-New-Password!")).toBe(false);
    expect(meetsPasswordPolicy("SyntheticNewPassword2026")).toBe(false);
    expect(meetsPasswordPolicy("Synth-Pass!26")).toBe(false);
  });
});

describe("the password options of the API", () => {
  it("are the ones the screen checks, rule by rule", () => {
    const source = readFileSync(
      resolve(__dirname, "../../../../database/DevelopmentDB/Elevant.Persistence/DependencyInjection.cs"), "utf8");
    const options = Object.fromEntries([...source.matchAll(/options\.Password\.(\w+)\s*=\s*([^;]+);/g)]
      .map(([, name, value]) => [name[0].toLowerCase() + name.slice(1), value.trim()]));
    expect(options).toEqual(Object.fromEntries(
      Object.entries(IDENTITY_PASSWORD_OPTIONS).map(([name, value]) => [name, String(value)])));
    // Identity's own validator only: no other rule the list could not show.
    expect(source).not.toMatch(/PasswordValidator/);
  });
});
