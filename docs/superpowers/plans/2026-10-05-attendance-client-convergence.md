# Captura compartida de asistencia en OCC y Mobile Agent — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que OCC y el agente asignado registren y consulten sus observaciones de asistencia separadas en una misma operación, con convergencia tras reconexión y conflictos visibles.

**Architecture:** Los dos clientes consumen el contrato `attendance-draft` existente mediante `@elevant/api-client`; ninguno interpreta los avisos como datos canónicos. OCC presenta un panel por asignación en la planificación; Mobile Agent añade una tarjeta en la operación asignada y conserva el comando pendiente, asociado a sesión/cuenta/operación/asignación, hasta recibir confirmación. La API sigue siendo la autoridad de roles, estación, asignación e instalación. Este subproyecto no añade validación de G.H. ni firmas; son entregas posteriores de la misma especificación.

**Tech Stack:** React 18/Vite/Vitest, Expo 54/React Native/Jest, TypeScript, `@elevant/api-client`, feed durable `attendance_draft`.

**Spec:** `docs/superpowers/specs/2026-10-04-human-resources-operational-interviews-design.md`, sección «Gestión Humana, gobernanza y turnos».

## Global Constraints

- «Tanto OCC como el agente pueden registrar su aporte a una incidencia; cada aporte conserva autor, origen e instante.»
- «La interfaz muestra en tiempo real el borrador guardado del otro actor, sin convertir un registro manual en fichaje biométrico.»
- «Un conflicto de revisión o de edición del mismo dato se presenta explícitamente y nunca descarta un aporte silenciosamente.»
- «Los borradores offline se conservan, pero se revalidan antes de enviar y nunca sobrescriben una versión ajena.»
- Los formularios envían `observedStartAt`/`observedEndAt` como instantes con offset; identifican explícitamente la zona local del dispositivo al editar y no la atribuyen a la estación.
- No modificar OpenAPI ni EF en este plan: el contrato aditivo ya está versionado. No desplegar Production ni tocar directamente el VPS.

## Review Focus

1. Cambio de vuelo, asignación o sesión durante una lectura: no mostrar la respuesta anterior en el nuevo contexto (Task 2 y Task 4).
2. 409 tras edición concurrente del mismo carril: conservar los campos intentados, mostrar la revisión canónica y exigir decisión explícita antes de guardar otra vez (Task 2 y Task 4).
3. Fallo de red tras un PUT que pudo persistir: reusar exactamente clave y cuerpo pendientes; no generar otra escritura ni anunciar éxito sin confirmación (Task 1 y Task 3).
4. Reconexión o aviso durable: releer GET, incluso cuando el otro carril cambió; no pintar valores directamente desde el aviso (Task 2 y Task 4).
5. Instalación revocada, 401/403 y borrador offline: no reintentar automáticamente bajo otra sesión/cuenta, ni filtrar notas en logs o almacenamiento de una identidad distinta (Task 3 y Task 4).

## Interfaces y archivos

- `frontend/private-web/src/services/attendanceDraftService.js`: lectura y PUT OCC con errores seguros para UI.
- `frontend/private-web/src/features/planning/attendance/useAttendanceDraft.js`: estado, revisión, relectura y comando pendiente del panel activo.
- `frontend/private-web/src/features/planning/components/OccAttendancePanel.jsx`: vista por agente, formulario de carril OCC y carril móvil de solo lectura.
- `frontend/private-web/src/features/planning/components/PlanningDrawer.jsx`: montaje solo cuando existen `flight.operation.id` y `agent.assignmentId`.
- `frontend/mobile-agent/src/storage/attendance-draft.ts`: comando pendiente de la identidad actual, con clave idempotente inmutable.
- `frontend/mobile-agent/src/services/ramp-attendance-draft.ts`: lectura y PUT con instalación activa y comprobación de sesión antes/después.
- `frontend/mobile-agent/src/components/attendance-draft-card.tsx`: campos accesibles, estado de sincronización y lectura del aporte OCC.
- `frontend/mobile-agent/src/app/flight/[id].tsx`: tarjeta dentro de la operación asignada, vinculada al feed en foreground.

### Task 1: Servicio OCC y resultado de escritura inequívoco

**Files:** Create `frontend/private-web/src/services/attendanceDraftService.js`; test `frontend/private-web/src/services/attendanceDraftService.test.js`.

**Interfaces:** `readAttendanceDraft(operationId, assignmentId, {signal})`; `saveOccAttendanceDraft(operationId, assignmentId, request, key, {signal})`. Los errores exponen `status`, `code`, `recoverable`, nunca `detail` interno.

- [ ] **Step 1: RED.** Crear pruebas de GET, PUT con `Idempotency-Key`, 401/403/404/409 y timeout. Fijar la expectativa observable: después de 409, `error.code === 'stale-revision'`; después de timeout, `error.code === 'unknown-outcome'`. Usar una respuesta de red controlada en el límite HTTP, no una respuesta inventada de componente.

```js
await expect(saveOccAttendanceDraft(operationId, assignmentId,
  { expectedRevision: 1, observedStartAt, incidentNote: 'Retraso' }, key))
  .rejects.toMatchObject({ code: 'stale-revision', status: 409 });
```

- [ ] **Step 2: Ejecutar RED.** `npm --prefix frontend/private-web test -- src/services/attendanceDraftService.test.js`; debe fallar porque el servicio aún no existe.
- [ ] **Step 3: GREEN.** Delegar en `createPrivateWebApiClient({ getAccessToken: () => readSession()?.token })`. Normalizar `ElevantApiError` y llamar `handleUnauthorizedResponse({status: 401})` solo en 401. Para error de transporte o 5xx del PUT, emitir `unknown-outcome`, sin afirmar que no se guardó.
- [ ] **Step 4: Ejecutar GREEN y commit.** Repetir prueba focal y `npm --prefix frontend/private-web test`; confirmar ambos verdes. Commit `feat(attendance): add safe OCC draft transport`.

### Task 2: Panel de asistencia OCC y convergencia visible

**Files:** Create `frontend/private-web/src/features/planning/attendance/useAttendanceDraft.js` and `.test.jsx`; create `frontend/private-web/src/features/planning/components/OccAttendancePanel.jsx` and `.test.jsx`; modify `PlanningDrawer.jsx` and its tests.

**Interfaces:** `useAttendanceDraft({operationId, assignmentId, enabled})` returns `{status, snapshot, attempted, conflict, save, reload, retryPending}`. `OccAttendancePanel` receives the IDs and the display name; the hook owns network lifecycle and one pending UUID/body until canonical resolution.

- [ ] **Step 1: RED.** Prueba de pantalla con dos agentes asignados: cada pestaña/carta usa su `assignmentId`, nunca el de otro. Montar panel solo para `flight.operation?.id`; comprobar vacío, carga, 403, error recuperable y observaciones del agente de solo lectura. Simular 409 y comprobar que los campos intentados permanecen visibles junto a la revisión nueva. Simular cambio de vuelo mientras GET tarda y asegurar que no aparece el resultado anterior.

```jsx
expect(screen.getByText('Aporte del agente')).toBeInTheDocument();
expect(screen.getByRole('textbox', { name: 'Nota de OCC' })).toHaveValue('Retraso observado');
expect(screen.getByRole('alert')).toHaveTextContent('cambió');
```

- [ ] **Step 2: Ejecutar RED.** `npm --prefix frontend/private-web test -- src/features/planning/components/OccAttendancePanel.test.jsx` debe fallar por el panel ausente.
- [ ] **Step 3: GREEN.** En el panel, usar controles `datetime-local` y mostrar `Intl.DateTimeFormat().resolvedOptions().timeZone` como zona del dispositivo. Convertir un valor válido con `new Date(value).toISOString()`, rechazar fecha inválida y fin anterior al inicio; mantener `null` para campos sin completar. No usar `authorAccountId` como autorización. El hook relee GET al abrir, en focus/online, cada 25 s visible y al recibir `attendance_draft` desde `createPrivateWebAccountChangeObserver`; cancelar GET obsoleto. Generar `crypto.randomUUID()` una vez por intención y reutilizar exactamente cuerpo/clave tras resultado desconocido. Después de 409, releer sin reemplazar el intento y exigir nueva confirmación con la revisión recibida.
- [ ] **Step 4: Ejecutar GREEN y commit.** Pruebas focales + `npm --prefix frontend/private-web test`; comprobar foco/teclado del `PlanningDrawer`, desuscripción y limpieza de timers. Commit `feat(attendance): show live OCC and agent observations`.

### Task 3: Comando móvil persistente y autorizado

**Files:** Create `frontend/mobile-agent/src/storage/attendance-draft.ts`, `frontend/mobile-agent/src/services/ramp-attendance-draft.ts`; test `frontend/mobile-agent/tests/attendance-draft-storage.test.js` and `attendance-draft-service.test.js`.

**Interfaces:** `readRampAttendanceDraft(operationId, assignmentId, {signal})`; `saveRampAttendanceDraft(operationId, assignmentId, request, {signal})`; `readPendingAttendanceDraft(operationId, assignmentId)` returns `{idempotencyKey, request} | null`; `clearPendingAttendanceDraft(operationId, assignmentId, key)` clears only that same confirmed intention.

- [ ] **Step 1: RED.** Probar que un retry por red conserva `expectedRevision`, cuerpo y UUID; un cambio de sesión/cuenta no reutiliza el borrador de otra identidad; 409 conserva el intento pero obliga a recarga; 401/403 no reenvía. La prueba de almacenamiento fuerza lectura/corrupción y exige error seguro, no reutilización de claves.

```js
expect(secondAttempt).toEqual(firstAttempt);
expect(await readPendingAttendanceDraft(operationId, assignmentId))
  .toEqual({ idempotencyKey: key, request });
```

- [ ] **Step 2: Ejecutar RED.** `npm --prefix frontend/mobile-agent run test:unit -- --testPathPattern=attendance-draft` debe fallar por las funciones ausentes.
- [ ] **Step 3: GREEN.** Guardar comando en `AsyncStorage` con clave derivada de `sessionId`, `accountId`, `operationId`, `assignmentId`; verificar esquema y UUID al leer. Obtener `getMobileSessionRequestContext()`, registrar dispositivo mediante `registerCurrentMobileDevice`, usar `readOrCreateMobileInstallationId`/el ID confirmado y llamar al cliente compartido con `X-Elevant-Installation-Id`. Revalidar la misma sesión antes y después de la solicitud. Nunca limpiar intención hasta confirmar recibo canónico o relectura que pruebe la revisión/payload; no autoenviar después de reconexión sin una decisión visible del usuario.
- [ ] **Step 4: Ejecutar GREEN y commit.** Tests focales, `npm --prefix frontend/mobile-agent run typecheck` y suite `test:unit`. Commit `feat(attendance): persist mobile draft intentions`.

### Task 4: Captura en la tablet y lectura del aporte OCC

**Files:** Create `frontend/mobile-agent/src/components/attendance-draft-card.tsx`; test `frontend/mobile-agent/tests/attendance-draft-card.test.js`; modify `frontend/mobile-agent/src/app/flight/[id].tsx`, `frontend/mobile-agent/package.json` and its lockfile. Declare the already locked `react-test-renderer@19.1.0` directly for component tests; the existing mobile suite has no React Native Testing Library or screen-render harness.

**Interfaces:** Card recibe `operationId`, `assignmentId` y el estado/salvado del servicio; presenta campos propios editables, carril OCC no editable, revisión, último guardado y comando pendiente.

- [ ] **Step 1: RED.** Declarar `react-test-renderer@19.1.0` como dependencia de prueba y ajustar el lockfile con `npm install --package-lock-only --ignore-scripts`. Probar la tarjeta real con una operación asignada y ambos carriles: pulsar «Registrar ahora» en inicio/fin y comprobar que se envía un instante con offset; editar nota, enviar y ver confirmación canónica. Ante red caída, mostrar «Pendiente de confirmar» y reintentar misma intención; ante 409, mostrar conflicto y ambas versiones sin sobrescribir. Un cambio de operación/usuario cancela lectura y oculta el borrador anterior.
- [ ] **Step 2: Ejecutar RED.** `npm --prefix frontend/mobile-agent run test:unit -- --testPathPattern=attendance-draft-card` debe fallar por la tarjeta ausente.
- [ ] **Step 3: GREEN.** Montar la tarjeta solo con `operation.operation.id` y `operation.assignment.id` del snapshot asignado. Mostrar explícitamente que se trata de observación manual, no fichaje biométrico. Suscribir `subscribeMobileChanges` en foreground y releer GET cuando incluya `attendance_draft`; también releer al enfocar, al volver de background y con refresh manual. No derivar datos de los hints ni permitir edición del carril OCC. El formulario mantiene controles táctiles ≥44 px y estados accesibles de carga, vacío, error, conflicto y pendiente.
- [ ] **Step 4: Ejecutar GREEN y commit.** Tests focales, suite móvil, typecheck y lint; probar navegación de regreso y cancelación. Commit `feat(attendance): capture agent observations on tablet`.

### Task 5: Documentación, aceptación y revisión

**Files:** Modify `frontend/private-web/README.md`, `frontend/mobile-agent/README.md`, `Vault/05-aplicaciones/asistencia-compartida-occ-agente.md`; regenerate `Vault/_generated` only with the repo command if inventory changes.

- [ ] **Step 1: Documentar estado exacto.** Explicar UI OCC/móvil, autoridad API, relectura por cursor, límites del modo offline y que validación G.H., horas extra y firmas siguen pendientes. Verificar cada fuente del frontmatter antes de avanzar `last_verified`/`verified_commit`.
- [ ] **Step 2: Verificación completa.** `npm --prefix packages/api-client run check`; `npm --prefix frontend/private-web test`; `npm --prefix frontend/private-web run build` con configuración Development local no secreta; `npm --prefix frontend/mobile-agent run typecheck`; `npm --prefix frontend/mobile-agent run test:unit`; `npm --prefix frontend/mobile-agent run lint`; `npm run vault:generate`; `npm run vault:check`; `npm run check`; `git diff --check`.
- [ ] **Step 3: Aceptación de dos sesiones.** Con API y base Development ya promocionadas, recorrer OCC en web y agente en emulador: guardar ambos carriles, observar la relectura del otro en ≤25 s o inmediatamente al volver a foreground, desconectar/reconectar, provocar 409 en el mismo carril y revocar una instalación. Registrar evidencia sin secretos ni PII; si no hay conexión al VPS, etiquetar la prueba como local y no afirmar aceptación remota.
- [ ] **Step 4: Revisión final.** Solicitar una revisión independiente de seguridad, concurrencia y UX; corregir defectos Critical/Important con RED→GREEN, repetir validación y entregar sin afirmar que la especificación completa de G.H. ya está terminada.

## Subproyectos posteriores de la especificación original

Este plan es una unidad desplegable, no el cierre del plan original. Restan una proyección/validación de asistencia por G.H. con evidencia de horas extra; reportes y exportaciones reales; reporte/orden de servicio por vuelo con dos firmas dibujadas versionadas; checklist de puente según terminal/equipo; y aceptación integral de todas las sesiones en Development. Cada uno requiere su propio plan, PR y checkpoint de promoción, sin mezclar código no certificado con el actual.
