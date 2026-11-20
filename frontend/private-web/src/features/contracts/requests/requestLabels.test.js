import { describe, expect, it } from 'vitest';
import { contractCodeLabel, requestReferenceLabel } from './requestLabels';

// A public request's reference is its id as 32 hex digits; its draft contract is «DRAFT-» and the same digits.
const GUID = '1cc18541e2a94f3b8c7d6e5f4a3b2c1d';

describe('requestReferenceLabel (N35)', () => {
  it('shows the reference as it is outside lists, a GUID included', () => {
    expect(requestReferenceLabel(GUID)).toEqual({ text: GUID, title: undefined });
    expect(requestReferenceLabel('REQ-2026-000001')).toEqual({ text: 'REQ-2026-000001', title: undefined });
  });

  it('shortens a GUID to its first 8 characters in lists and keeps it whole in the title', () => {
    expect(requestReferenceLabel(GUID, { list: true })).toEqual({ text: '1cc18541…', title: GUID });
    const dashed = '1cc18541-e2a9-4f3b-8c7d-6e5f4a3b2c1d';
    expect(requestReferenceLabel(dashed, { list: true })).toEqual({ text: '1cc18541…', title: dashed });
    // Never rewritten: the case it has is the case it shows.
    expect(requestReferenceLabel(GUID.toUpperCase(), { list: true })).toEqual({ text: '1CC18541…', title: GUID.toUpperCase() });
  });

  it('never cuts a reference that is not a GUID', () => {
    for (const reference of ['REQ-2026-000001', 'DEV-REQ-0001', 'g'.repeat(32), `${GUID}0`])
      expect(requestReferenceLabel(reference, { list: true })).toEqual({ text: reference, title: undefined });
  });

  it('trims the reference and shows a dash without one', () => {
    expect(requestReferenceLabel(`  ${GUID} `, { list: true })).toEqual({ text: '1cc18541…', title: GUID });
    for (const missing of [null, undefined, '', '   ', 42])
      expect(requestReferenceLabel(missing, { list: true })).toEqual({ text: '—', title: undefined });
  });
});

describe('contractCodeLabel (N35)', () => {
  it('names a new contract «Borrador» and the first 8 characters of its id, the whole code in the title', () => {
    expect(contractCodeLabel(`DRAFT-${GUID}`))
      .toEqual({ text: 'Borrador 1cc18541…', title: `DRAFT-${GUID}`, draftId: '1cc18541…' });
    expect(contractCodeLabel('DRAFT-2')).toEqual({ text: 'Borrador 2', title: 'DRAFT-2', draftId: '2' });
  });

  it('keeps a final code as it is', () => {
    for (const code of ['CTR-2026-0007', 'DEV-CONTRACT-0001', 'QA-1', 'draft-2', 'DRAFT-'])
      expect(contractCodeLabel(code)).toEqual({ text: code, title: undefined, draftId: null });
  });

  it('trims the code and shows a dash without one', () => {
    expect(contractCodeLabel(` DRAFT-${GUID} `)).toEqual({ text: 'Borrador 1cc18541…', title: `DRAFT-${GUID}`,
      draftId: '1cc18541…' });
    for (const missing of [null, undefined, '', 7])
      expect(contractCodeLabel(missing)).toEqual({ text: '—', title: undefined, draftId: null });
  });
});
