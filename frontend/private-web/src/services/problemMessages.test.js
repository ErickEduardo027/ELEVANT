import { describe, expect, it } from 'vitest';
import { problemMessage, isConflict, isForbidden } from './problemMessages';
import { commercialGovernanceMessage, commercialRequestMessage, provisioningMessage } from './commercialProblems';
import { createCommandKeyHolder } from './commandKeys';
import { representativeDomainCheck } from '../features/contracts/requests/representativeDomain';
import { countryName, documentLabel, requestStatusLabel } from '../features/contracts/requests/requestLabels';

const failure = (status, code, title = 'Commercial record changed or conflicts with another airline.') =>
  Object.assign(new Error(title), { status, code, title });

describe('problemMessage', () => {
  it('resolves session, area code, shared code, status and fallback in that order', () => {
    expect(problemMessage(failure(401, 'version_conflict'))).toBe('La sesión expiró. Vuelva a iniciar sesión.');
    expect(problemMessage(failure(409, 'custom'), { custom: 'Mensaje del área.' })).toBe('Mensaje del área.');
    expect(problemMessage(failure(409, 'version_conflict'))).toMatch(/^El registro cambió/);
    expect(problemMessage(failure(403))).toBe('No tiene permiso para esta acción.');
    expect(problemMessage(failure(403), {}, { forbidden: 'Sin acceso a solicitudes.' })).toBe('Sin acceso a solicitudes.');
    expect(problemMessage(failure(404))).toBe('El registro ya no existe.');
    expect(problemMessage(failure(409))).toBe('El registro cambió; actualice e intente de nuevo.');
    expect(problemMessage(failure(400))).toBe('Revise los datos e intente de nuevo.');
    expect(problemMessage(new TypeError('Failed to fetch'), {}, { fallback: 'Sin conexión.' })).toBe('Sin conexión.');
    expect(problemMessage(failure(500))).toMatch(/^No se pudo completar la acción/);
  });

  it('never returns the server title or the exception text', () => {
    for (const error of [failure(409), failure(400, 'unknown_code'), failure(502), { message: 'Raw exception' }])
      expect(problemMessage(error)).not.toMatch(/Commercial record|Raw exception/);
    expect(problemMessage(failure(409, 'toString'))).toBe('El registro cambió; actualice e intente de nuevo.');
  });

  it('classifies unauthorized and conflicting answers', () => {
    expect(isForbidden({ status: 403 })).toBe(true);
    expect(isForbidden({ status: 401 })).toBe(false);
    expect(isConflict({ status: 409 })).toBe(true);
  });
});

describe('commercial messages', () => {
  it('explain the review and governance codes in Spanish', () => {
    expect(commercialRequestMessage(failure(409, 'airline_already_contracted'))).toMatch(/enmienda o una renovación/);
    expect(commercialRequestMessage(failure(409, 'airline_has_portal_account'))).toMatch(/cuentas activas en el portal/);
    expect(commercialRequestMessage(failure(409, 'airline_code_in_use'))).toMatch(/IATA o ICAO/);
    expect(commercialRequestMessage(failure(409, 'representative_unconfirmed'))).toMatch(/confirmación del representante/);
    expect(commercialRequestMessage(failure(400, 'invalid_airline'))).toMatch(/ICAO obligatorio/);
    // Clientes answers email_in_use for any registered email, a portal account included; only provisioning knows
    // that the email is not a portal account.
    expect(commercialGovernanceMessage(failure(409, 'email_in_use')))
      .toBe('Ese correo ya está registrado en ELEVANT. Use otro correo o revise los usuarios existentes.');
    expect(provisioningMessage(failure(409, 'email_in_use'))).toMatch(/no es una cuenta del portal/);
    expect(provisioningMessage(failure(409, 'email_has_account'))).toMatch(/Puede vincularla/);
    expect(provisioningMessage(failure(409, 'version_conflict'))).toMatch(/cambió mientras lo editaba/);
    // 1-N13: whether the existing account can be linked and, if not, why.
    expect(commercialGovernanceMessage(failure(409, 'email_has_account'))).toMatch(/Puede vincularla/);
    expect(commercialGovernanceMessage(failure(409, 'email_in_use_other_airline'))).toMatch(/otra aerolínea/);
    expect(commercialGovernanceMessage(failure(409, 'account_disabled'))).toMatch(/Reactívela desde Clientes/);
    expect(commercialGovernanceMessage(failure(409, 'airline_identity_locked'))).toMatch(/ya opera con AVIAM/);
    expect(commercialGovernanceMessage(failure(400, 'registry_check_required'))).toMatch(/registro público/);
  });
});

describe('createCommandKeyHolder', () => {
  it('keeps the key while an uncertain result is retried and renews it after an answer', async () => {
    let next = 0;
    const holder = createCommandKeyHolder(() => `key-${++next}`);
    const keys = [];
    const send = outcome => key => { keys.push(key); if (outcome) return Promise.reject(outcome); return Promise.resolve('ok'); };
    await expect(holder.run('cancel', { id: 1 }, send(new TypeError('offline')))).rejects.toThrow('offline');
    await expect(holder.run('cancel', { id: 1 }, send(Object.assign(new Error(), { status: 503 })))).rejects.toBeDefined();
    await expect(holder.run('cancel', { id: 1 }, send(null))).resolves.toBe('ok');
    await expect(holder.run('cancel', { id: 1 }, send(Object.assign(new Error(), { status: 409 })))).rejects.toBeDefined();
    await holder.run('cancel', { id: 1 }, send(null));
    expect(keys).toEqual(['key-1', 'key-1', 'key-1', 'key-2', 'key-3']);
    // Another body is another intent.
    expect(holder.keyFor('cancel', { id: 1 })).not.toBe(holder.keyFor('cancel', { id: 2 }));
    holder.reset();
  });

  it('resends the command of the first attempt on every retry of the same intent', async () => {
    let next = 0;
    const holder = createCommandKeyHolder(() => `key-${++next}`);
    const sent = [];
    let version = 'v1';
    const send = outcome => (key, command) => {
      sent.push([key, command]);
      return outcome ? Promise.reject(outcome) : Promise.resolve('ok');
    };
    const build = () => ({ expectedVersion: version, body: 'Hola' });
    await expect(holder.run('reply', { id: 1, body: 'Hola' }, send(new TypeError('offline')), build)).rejects.toThrow('offline');
    // The record moved on while the result was uncertain: the retry is still the first command, with its key.
    version = 'v2';
    await expect(holder.run('reply', { id: 1, body: 'Hola' }, send(null), build)).resolves.toBe('ok');
    // A settled intent builds the next command with the version on screen.
    await holder.run('reply', { id: 1, body: 'Hola' }, send(null), build);
    expect(sent).toEqual([
      ['key-1', { expectedVersion: 'v1', body: 'Hola' }],
      ['key-1', { expectedVersion: 'v1', body: 'Hola' }],
      ['key-2', { expectedVersion: 'v2', body: 'Hola' }],
    ]);
  });

  it('uses random UUIDs by default', () => {
    expect(createCommandKeyHolder().keyFor('decide', {})).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe('representative domain check', () => {
  it('compares the email domain with the official site, ignoring AVIAM, Wikipedia and Wikidata', () => {
    expect(representativeDomainCheck('ana@copaair.com', ['https://www.copaair.com/'])).toMatchObject({ kind: 'match' });
    expect(representativeDomainCheck('ana@cm.copaair.com', ['https://www.copaair.com/'])).toMatchObject({ kind: 'match' });
    expect(representativeDomainCheck('x@tuifly.com', ['https://en.tuifly.com/'])).toMatchObject({ kind: 'match' });
    expect(representativeDomainCheck('ana@gmail.com', ['https://www.copaair.com/']))
      .toEqual({ kind: 'mismatch', emailDomain: 'gmail.com', site: 'copaair.com' });
    expect(representativeDomainCheck('x@caa.com', ['https://aa.com'])).toMatchObject({ kind: 'mismatch' });
    expect(representativeDomainCheck('ana@copaair.com', ['https://www.aviamltd.com/nosotros/',
      'https://es.wikipedia.org/wiki/Copa', 'https://www.wikidata.org/wiki/Q1'])).toMatchObject({ kind: 'unknown' });
    expect(representativeDomainCheck('ana@copaair.com', ['https://www.aviamltd.com/', 'https://www.copaair.com']))
      .toMatchObject({ kind: 'match', site: 'copaair.com' });
    expect(representativeDomainCheck('ana@copaair.com', [null, 'not a url'])).toMatchObject({ kind: 'unknown' });
  });
});

describe('request labels', () => {
  it('names countries, documents and statuses in Spanish', () => {
    expect(countryName('DO')).toBe('República Dominicana');
    expect(countryName(null)).toBeNull();
    expect(documentLabel('NationalId')).toBe('Cédula');
    expect(documentLabel('Passport')).toBe('Pasaporte');
    expect(documentLabel('Other')).toBe('Otro documento');
    expect(requestStatusLabel('InReview')).toBe('En revisión');
    expect(requestStatusLabel('Cancelled')).toBe('Cancelada');
  });
});
