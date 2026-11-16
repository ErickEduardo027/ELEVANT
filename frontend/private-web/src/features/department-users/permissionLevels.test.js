import { describe, expect, it } from 'vitest';
import { accessLevel, actionLevel, levelCodes, moduleLevels, setAccessLevel, VERB_LEVELS } from './permissionLevels';

const read = (module, label = 'Ver') => ({ code: `x.${module}.read`, action: 'read', label, kind: 'read' });
const act = (module, name, kind = 'other') => ({ code: `x.${module}.${name}`, action: name, label: name, kind });
const mod = (key, ...actions) => ({ key, label: key, parent: null, actions: [read(key), ...actions] });

// Every workflow verb of DepartmentPermissionCatalog.cs, so a new verb is classified on purpose.
const CATALOG_VERBS = ['activate', 'apply', 'approve', 'assign', 'attend', 'cancel', 'confirm', 'decide', 'export', 'issue',
  'lifecycle', 'pay', 'publish', 'refund', 'reject', 'reopen', 'retire', 'reverse', 'revoke', 'sign', 'unbind', 'validate',
  'validity', 'verify', 'write'];

describe('permission levels', () => {
  it('classifies every workflow verb of the catalog', () => {
    expect(CATALOG_VERBS.filter(verb => !VERB_LEVELS[verb])).toEqual([]);
    expect(actionLevel(act('m', 'export'))).toBe('read');
    for (const verb of ['assign', 'write', 'validate', 'decide', 'sign', 'approve', 'publish', 'issue', 'pay', 'attend'])
      expect(actionLevel(act('m', verb))).toBe('edit');
    for (const verb of ['revoke', 'reverse', 'unbind', 'reopen', 'retire', 'cancel', 'lifecycle'])
      expect(actionLevel(act('m', verb))).toBe('full');
    expect(actionLevel(act('m', 'delete', 'delete'))).toBe('full');
    // An unknown verb is never granted below «Completo».
    expect(actionLevel(act('m', 'teleport'))).toBe('full');
  });

  it('builds cumulative levels that always include «Ver»', () => {
    const tariffs = mod('tariffs', act('tariffs', 'create', 'create'), act('tariffs', 'update', 'update'),
      act('tariffs', 'delete', 'delete'), act('tariffs', 'publish'));
    expect(moduleLevels(tariffs)).toEqual(['none', 'read', 'create', 'edit', 'full']);
    expect(levelCodes(tariffs, 'read')).toEqual(['x.tariffs.read']);
    expect(levelCodes(tariffs, 'create')).toEqual(['x.tariffs.create', 'x.tariffs.read']);
    expect(levelCodes(tariffs, 'edit')).toEqual(['x.tariffs.create', 'x.tariffs.publish', 'x.tariffs.read', 'x.tariffs.update']);
    expect(levelCodes(tariffs, 'full')).toEqual(['x.tariffs.create', 'x.tariffs.delete', 'x.tariffs.publish', 'x.tariffs.read', 'x.tariffs.update']);
  });

  it('offers only the levels that grant something new', () => {
    expect(moduleLevels(mod('home'))).toEqual(['none', 'read']);
    expect(moduleLevels(mod('reports', act('reports', 'export')))).toEqual(['none', 'read']);
    expect(moduleLevels(mod('review', act('review', 'decide'), act('review', 'reopen')))).toEqual(['none', 'read', 'edit', 'full']);
    expect(moduleLevels(mod('devices', act('devices', 'unbind'), act('devices', 'revoke')))).toEqual(['none', 'read', 'full']);
    expect(moduleLevels(mod('positions', act('positions', 'create', 'create'), act('positions', 'update', 'update'))))
      .toEqual(['none', 'read', 'create', 'edit']);
  });

  it('reads stored grants as a level or as custom', () => {
    const review = mod('review', act('review', 'decide'), act('review', 'reopen'));
    expect(accessLevel([], review)).toBe('none');
    expect(accessLevel(['x.review.read'], review)).toBe('read');
    expect(accessLevel(['x.review.decide', 'x.review.read'], review)).toBe('edit');
    expect(accessLevel(['x.review.decide', 'x.review.read', 'x.review.reopen'], review)).toBe('full');
    expect(accessLevel(['x.review.read', 'x.review.reopen'], review)).toBe('custom');
  });

  it('replaces the grants of the option with the level and keeps the other options', () => {
    const review = mod('review', act('review', 'decide'), act('review', 'reopen'));
    expect(setAccessLevel(['x.other.read', 'x.review.read', 'x.review.reopen'], review, 'edit'))
      .toEqual(['x.other.read', 'x.review.decide', 'x.review.read']);
    expect(setAccessLevel(['x.review.read'], review, 'none')).toEqual([]);
  });
});
