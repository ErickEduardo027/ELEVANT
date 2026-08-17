import { afterEach, describe, expect, it } from 'vitest';
import { clearSession, getMockUsers, mockLogin, readSession } from './authService';

afterEach(() => {
  clearSession();
});

describe('authService', () => {
  it('exposes the four mock back-office users', () => {
    expect(getMockUsers().map(user => user.email)).toEqual([
      'admin@elevant.test',
      'gestionhumana@elevant.test',
      'contratos@elevant.test',
      'finanzas@elevant.test',
    ]);
  });

  it('persists a session for a valid login and resolves the role home path', async () => {
    const session = await mockLogin({ email: 'gestionhumana@elevant.test', password: 'Elevant2026!', remember: true });
    expect(session).toMatchObject({
      email: 'gestionhumana@elevant.test',
      role: 'GESTION_HUMANA',
      homePath: '/gestion-humana',
    });
    expect(readSession()).toMatchObject({ email: 'gestionhumana@elevant.test' });
  });

  it('rejects invalid credentials', async () => {
    await expect(mockLogin({ email: 'admin@elevant.test', password: 'bad-password' })).rejects.toThrow(
      /credenciales inválidas/i
    );
  });
});
