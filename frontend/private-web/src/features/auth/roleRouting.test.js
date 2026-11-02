import { describe, expect, it } from 'vitest';
import { getRoleFromPath, getRoleHomePath, resolveRoute } from './roleRouting';

describe('role destinations and authorization prefixes', () => {
  it('lands OCC on Dashboard while preserving every OCC deep-link namespace', () => {
    expect(getRoleHomePath('ADMIN_OCC')).toBe('/admin-occ/dashboard');
    for (const path of ['/admin-occ', '/admin-occ/planning', '/admin-occ/expenses', '/admin-occ/positions-map']) {
      expect(getRoleFromPath(path)).toBe('ADMIN_OCC');
      expect(resolveRoute(path, { role: 'ADMIN_OCC' })).toEqual({ kind: 'private', pathname: path, role: 'ADMIN_OCC' });
    }
    expect(resolveRoute('/login', { role: 'ADMIN_OCC' })).toMatchObject({ kind: 'redirect', pathname: '/admin-occ/dashboard' });
  });
  it('preserves other role homes and rejects another role namespace', () => {
    expect(getRoleHomePath('FINANZAS')).toBe('/finanzas');
    expect(getRoleHomePath('CUSTOM_LEGACY')).toBe('/contratos');
    expect(resolveRoute('/finanzas', { role: 'ADMIN_OCC' })).toMatchObject({ kind: 'redirect', pathname: '/admin-occ/dashboard' });
    expect(resolveRoute('/admin-occ/planning', null)).toMatchObject({ kind: 'public', pathname: '/login' });
  });
});
