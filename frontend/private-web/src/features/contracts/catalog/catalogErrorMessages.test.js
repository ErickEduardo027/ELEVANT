import { expect, it } from 'vitest';
import { CATALOG_FORBIDDEN_MESSAGE, catalogProblemMessage, serviceProblemMessage } from './catalogErrorMessages';
import { closureProblemMessage, serviceClosureMessages } from './serviceClosureMessages';

const failure = (status, code) => Object.assign(new Error('Service changed; reload and retry.'), { status, code });

it('explains the catalog codes and never the server title', () => {
  expect(catalogProblemMessage(failure(409, 'service_in_active_contract')))
    .toMatch(/^No se puede dar de baja: un contrato vigente o en aprobación incluye este servicio/);
  expect(catalogProblemMessage(failure(400, 'retirement_command_required'))).toMatch(/Use «Dar de baja»/);
  expect(catalogProblemMessage(failure(409, 'closure_requires_reopen'))).toMatch(/Solicitudes de clausura/);
  expect(catalogProblemMessage(failure(409, 'service_retired'))).toBe('El servicio está dado de baja. Reactívelo antes de publicarlo.');
  expect(catalogProblemMessage(failure(400, 'reason_required'))).toMatch(/entre 10 y 1000/);
  expect(catalogProblemMessage(failure(403))).toBe(CATALOG_FORBIDDEN_MESSAGE);
  expect(catalogProblemMessage(failure(409))).toBe('El registro cambió; actualice e intente de nuevo.');
  expect(catalogProblemMessage(failure(401, 'service_retired'))).toBe('La sesión expiró. Vuelva a iniciar sesión.');
  expect(catalogProblemMessage(new Error('Service changed; reload and retry.'))).not.toMatch(/reload/);
});

it('only asks to hide a service a contract keeps while it is public', () => {
  const refused = failure(409, 'service_in_active_contract');
  expect(serviceProblemMessage(refused, { isPublic: true })).toBe(catalogProblemMessage(refused));
  expect(serviceProblemMessage(refused, { isPublic: true })).toMatch(/ocúltelo del catálogo público/);
  expect(serviceProblemMessage(refused, { isPublic: false })).toBe('No se puede dar de baja: un contrato vigente o '
    + 'en aprobación incluye este servicio, como tarifa o dentro de un paquete. Ya está oculto del catálogo público; '
    + 'podrá darlo de baja cuando ningún contrato lo incluya.');
  // Without a service (the form) and for every other answer the catalog messages apply.
  expect(serviceProblemMessage(refused)).toBe(catalogProblemMessage(refused));
  expect(serviceProblemMessage(failure(409, 'version_conflict'), { isPublic: false }))
    .toBe(catalogProblemMessage(failure(409, 'version_conflict')));
  expect(serviceProblemMessage(failure(403), { isPublic: false })).toBe(CATALOG_FORBIDDEN_MESSAGE);
  expect(serviceProblemMessage(failure(401, 'service_in_active_contract'), { isPublic: false }))
    .toBe('La sesión expiró. Vuelva a iniciar sesión.');
});

it('explains the closure codes in the language of the space', () => {
  expect(closureProblemMessage(failure(409, 'service_retired')))
    .toBe('El servicio está dado de baja. Reactívelo en el catálogo antes de republicarlo.');
  expect(closureProblemMessage(failure(409, 'service_retired'), 'en'))
    .toBe('The service is retired. Reactivate it in the catalog before republishing it.');
  expect(closureProblemMessage(failure(409), 'en')).toBe(serviceClosureMessages.en.conflict);
  expect(closureProblemMessage(failure(404), 'en')).toBe(serviceClosureMessages.en.problems.notFound);
  expect(closureProblemMessage(failure(401, 'closure_pending'), 'en')).toBe(serviceClosureMessages.en.problems.session);
  expect(closureProblemMessage(failure(403, 'closure_self_decision'), 'en'))
    .toBe('You cannot decide a closure you reported yourself.');
  expect(closureProblemMessage(new Error('Service changed; reload and retry.'), 'en'))
    .toBe(serviceClosureMessages.en.problems.fallback);
  // Every code has both languages.
  expect(Object.keys(serviceClosureMessages.en.problems.codes).sort())
    .toEqual(Object.keys(serviceClosureMessages.es.problems.codes).sort());
});
