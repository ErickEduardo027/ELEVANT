import { describe, expect, it } from 'vitest';
import { checkIdentityDocument, normalizePhone } from '@elevant/api-client';
import { compactCedula, formatCedula, formatPhone } from './inputMasks';

describe('formatCedula', () => {
  it('writes ###-#######-# while typing and keeps only 11 digits', () => {
    expect(formatCedula('001')).toBe('001');
    expect(formatCedula('0010')).toBe('001-0');
    expect(formatCedula('0010000001')).toBe('001-0000001');
    expect(formatCedula('00100000017')).toBe('001-0000001-7');
    expect(formatCedula('001-0000001-79999')).toBe('001-0000001-7');
    expect(formatCedula('a0b0c1')).toBe('001');
    expect(formatCedula('')).toBe('');
  });

  it('erases through a dash instead of getting stuck on it', () => {
    expect(formatCedula('001-')).toBe('001');
  });

  it('gives a value the server rule accepts, dashed or compacted', () => {
    expect(checkIdentityDocument('Cedula', formatCedula('00100000017')).problem).toBeNull();
    expect(checkIdentityDocument('Cedula', formatCedula('00100000017')).number).toBe('00100000017');
    expect(compactCedula('001-0000001-7')).toBe('00100000017');
  });
});

describe('formatPhone', () => {
  it('groups a Dominican number as 809-555-0100', () => {
    expect(formatPhone('809')).toBe('809');
    expect(formatPhone('8095')).toBe('809-5');
    expect(formatPhone('8095550100')).toBe('809-555-0100');
    expect(formatPhone('(809) 555.0100')).toBe('809-555-0100');
    expect(formatPhone('80955501009')).toBe('809-555-0100');
    expect(formatPhone('18095550100')).toBe('1-809-555-0100');
  });

  it('keeps an international prefix with its digits and spaces', () => {
    expect(formatPhone('+')).toBe('+');
    expect(formatPhone('+34 600-123-456')).toBe('+34 600-123-456');
    expect(formatPhone('+1 (305) 555')).toBe('+1 305 555');
    expect(formatPhone('0034 600 123 456')).toBe('0034 600 123 456');
    expect(formatPhone('+18095550100')).toBe('+18095550100');
  });

  it('never decides validity: normalizePhone stays the rule', () => {
    expect(normalizePhone(formatPhone('8095550100'))).toBe('+18095550100');
    expect(normalizePhone(formatPhone('18495550100'))).toBe('+18495550100');
    expect(normalizePhone(formatPhone('+34 600 123 456'))).toBe('+34600123456');
    expect(normalizePhone(formatPhone('5550100'))).toBeNull();
  });
});
