/**
 * N17: the password policy of the API, so the screen lists the requirements before the airline types and never sends
 * a password the server would refuse. Activation, recovery and the change of a temporary password all go through
 * ASP.NET Core Identity's PasswordValidator with the options of
 * database/DevelopmentDB/Elevant.Persistence/DependencyInjection.cs, and each rule is checked here as Identity checks it:
 * - the length counts UTF-16 code units, like String.Length (an emoji counts two), and a password of only white space
 *   is too short whatever its length;
 * - only A-Z and a-z count as upper and lower case, and only 0-9 as digits;
 * - any other character is a symbol: «É», «ñ», a space or an emoji.
 * RequiredUniqueChars keeps Identity's default of 1, which any password of the required length meets.
 */

/** The Password options the API gives Identity; tests/unit/password-policy.test.ts compares them with the API's. */
export const IDENTITY_PASSWORD_OPTIONS = Object.freeze({
  requiredLength: 14,
  requireDigit: true,
  requireLowercase: true,
  requireUppercase: true,
  requireNonAlphanumeric: true,
});

export type PasswordRequirementId = "length" | "uppercase" | "lowercase" | "digit" | "symbol" | "different";

export type PasswordRequirement = { readonly id: PasswordRequirementId; readonly label: string; readonly met: boolean };

/** Under the list: Identity reads «ñ» and accented letters as symbols, never as upper or lower case. */
export const PASSWORD_REQUIREMENTS_NOTE =
  "La ñ y las letras con tilde, como la É, cuentan como símbolo, no como mayúscula ni minúscula.";

/** Why a password is not sent, under its field (D-N19: the airline is treated as usted). */
export const PASSWORD_ERRORS = Object.freeze({
  requirements: "La contraseña aún no cumple todos los requisitos.",
  confirmation: "La confirmación no coincide con la contraseña.",
});

const isDigit = (unit: number) => unit >= 0x30 && unit <= 0x39;
const isLower = (unit: number) => unit >= 0x61 && unit <= 0x7a;
const isUpper = (unit: number) => unit >= 0x41 && unit <= 0x5a;

/**
 * .NET's char.IsWhiteSpace, which String.IsNullOrWhiteSpace uses: U+0009 to U+000D, U+0085, the Unicode space
 * separators and the line and paragraph separators. Not the same set as JavaScript's \s, which takes U+FEFF and
 * leaves U+0085 out.
 */
const isWhiteSpace = (unit: number) =>
  (unit >= 0x09 && unit <= 0x0d) || unit === 0x20 || unit === 0x85 || unit === 0xa0 || unit === 0x1680 ||
  (unit >= 0x2000 && unit <= 0x200a) || unit === 0x2028 || unit === 0x2029 || unit === 0x202f || unit === 0x205f ||
  unit === 0x3000;

/**
 * Every requirement for `password`, in the order the screen lists them. With the `temporaryPassword` it replaces, the
 * new one must also differ from it: the API refuses a change to the same password (ChangePasswordHandler compares
 * them ordinally), and an empty field does not count as different yet.
 */
export function passwordRequirements(password: string, temporaryPassword?: string): PasswordRequirement[] {
  const units = Array.from({ length: password.length }, (_, index) => password.charCodeAt(index));
  const options = IDENTITY_PASSWORD_OPTIONS;
  const requirements: Array<PasswordRequirement & { readonly enforced: boolean }> = [
    { id: "length", label: `Al menos ${options.requiredLength} caracteres`, enforced: true,
      met: password.length >= options.requiredLength && !units.every(isWhiteSpace) },
    { id: "uppercase", label: "Una letra mayúscula (A–Z)", enforced: options.requireUppercase, met: units.some(isUpper) },
    { id: "lowercase", label: "Una letra minúscula (a–z)", enforced: options.requireLowercase, met: units.some(isLower) },
    { id: "digit", label: "Un número (0–9)", enforced: options.requireDigit, met: units.some(isDigit) },
    { id: "symbol", label: "Un símbolo, como !, # o -", enforced: options.requireNonAlphanumeric,
      met: units.some(unit => !isUpper(unit) && !isLower(unit) && !isDigit(unit)) },
    { id: "different", label: "Distinta de la contraseña temporal", enforced: temporaryPassword !== undefined,
      met: password.length > 0 && password !== temporaryPassword },
  ];
  return requirements.filter(requirement => requirement.enforced)
    .map(({ id, label, met }) => ({ id, label, met }));
}

/** Whether the API would accept `password`: every requirement of passwordRequirements is met. */
export function meetsPasswordPolicy(password: string, temporaryPassword?: string): boolean {
  return passwordRequirements(password, temporaryPassword).every(requirement => requirement.met);
}
