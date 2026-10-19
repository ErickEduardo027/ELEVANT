import { beforeEach, describe, expect, it, vi } from 'vitest';
import { commercialApi } from './commercialGovernanceApi';
import { fiscalXmlError, validateFiscalXml } from './financeFiscalXmlValidationService';

vi.mock('./commercialGovernanceApi', () => ({ commercialApi: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

describe('offline fiscal XML API contract', () => {
  it('posts exact UTF-8 or base64 DTO only on the separate validation route', async () => {
    commercialApi.mockResolvedValue({ schemaValidation: 'Failed' });
    const xmlUtf8 = ' <ECF>á</ECF>\r\n';
    await validateFiscalXml({ documentType: 'E31', xmlUtf8 });
    const xmlBase64 = btoa('<ECF/>');
    await validateFiscalXml({ documentType: 'E34', xmlBase64 });
    expect(commercialApi.mock.calls).toEqual([
      ['/finance/fiscal-xml/validate', { method: 'POST', body: JSON.stringify({ documentType: 'E31', xmlUtf8 }), cache: 'no-store' }],
      ['/finance/fiscal-xml/validate', { method: 'POST', body: JSON.stringify({ documentType: 'E34', xmlBase64 }), cache: 'no-store' }],
    ]);
  });

  it.each([
    { documentType: 'E41', xmlUtf8: '<ECF/>' },
    { documentType: '31', xmlUtf8: '<ECF/>' },
    { documentType: 'E31' },
    { documentType: 'E31', xmlUtf8: '' },
    { documentType: 'E31', xmlUtf8: '<ECF/>', xmlBase64: btoa('<ECF/>') },
    { documentType: 'E31', xmlBase64: '!!!' },
    { documentType: 'E31', xmlBase64: '/w==' },
  ])('rejects invalid transport input without sending: %j', async input => {
    await expect(validateFiscalXml(input)).rejects.toMatchObject({ status: 400 });
    expect(commercialApi).not.toHaveBeenCalled();
  });

  it('bounds UTF-8 bytes and decoded base64 rather than characters alone', async () => {
    await expect(validateFiscalXml({ documentType: 'E31', xmlUtf8: 'é'.repeat(1024 * 1024 + 1) }))
      .rejects.toMatchObject({ status: 413 });
    await expect(validateFiscalXml({ documentType: 'E31', xmlBase64: btoa('x'.repeat(2 * 1024 * 1024 + 1)) }))
      .rejects.toMatchObject({ status: 413 });
    expect(commercialApi).not.toHaveBeenCalled();
  });

  it('preserves structured results and never changes NotPerformed into acceptance', async () => {
    const result = { schemaValidation: 'Passed', isStructurallyValid: false, signatureElementPresent: false,
      structuralErrors: [{ code: 'SignatureMissing' }], cryptographicValidation: 'NotPerformed', fiscalAcceptance: 'NotPerformed' };
    commercialApi.mockResolvedValue(result);
    await expect(validateFiscalXml({ documentType: 'E32', xmlUtf8: '<ECF/>' })).resolves.toEqual(result);
  });

  it('reports safe permission, size, availability and connection errors without private details', () => {
    expect(fiscalXmlError({ status: 401 })).toContain('sesión');
    expect(fiscalXmlError({ status: 403 })).toContain('permiso');
    expect(fiscalXmlError({ status: 413 })).toContain('2 MiB');
    expect(fiscalXmlError({ status: 503 })).toContain('disponible');
    expect(fiscalXmlError(new Error('PRIVATE XML VALUE'))).not.toContain('PRIVATE XML VALUE');
  });
});
