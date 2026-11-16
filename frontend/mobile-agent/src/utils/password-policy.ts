/**
 * The API's password policy (ASP.NET Identity: 14+ characters with an uppercase letter, a lowercase letter, a digit
 * and a character that is neither a letter nor a digit), shown as a live checklist. ELEVANT stays the authority: a
 * password that passes here can still be refused with 400, which the screen explains.
 */
export const PASSWORD_MIN_LENGTH = 14;
export const PASSWORD_MAX_LENGTH = 256;

export type PasswordRuleId = 'length' | 'upper' | 'lower' | 'digit' | 'symbol' | 'different';

export type PasswordRule = Readonly<{ id: PasswordRuleId; label: string; met: boolean }>;

const isDigit = (character: string) => character >= '0' && character <= '9';
const isLetter = (character: string) => character.toLowerCase() !== character.toUpperCase();

export function passwordRules(newPassword: string, currentPassword: string): readonly PasswordRule[] {
  const characters = Array.from(newPassword);
  return [
    {
      id: 'length',
      label: `Al menos ${PASSWORD_MIN_LENGTH} caracteres`,
      met: characters.length >= PASSWORD_MIN_LENGTH && newPassword.length <= PASSWORD_MAX_LENGTH,
    },
    {
      id: 'upper',
      label: 'Una letra mayúscula',
      met: characters.some(character => isLetter(character) && character === character.toUpperCase()),
    },
    {
      id: 'lower',
      label: 'Una letra minúscula',
      met: characters.some(character => isLetter(character) && character === character.toLowerCase()),
    },
    { id: 'digit', label: 'Un número', met: characters.some(isDigit) },
    {
      id: 'symbol',
      label: 'Un símbolo (por ejemplo ! # $ . -)',
      met: characters.some(character => !isLetter(character) && !isDigit(character)),
    },
    // The API refuses reusing the temporary password as if it were invalid (401); the tablet says so before sending.
    {
      id: 'different',
      label: 'Distinta de la contraseña temporal',
      met: newPassword.length > 0 && newPassword !== currentPassword,
    },
  ];
}

export function meetsPasswordPolicy(newPassword: string, currentPassword: string) {
  return passwordRules(newPassword, currentPassword).every(rule => rule.met);
}
