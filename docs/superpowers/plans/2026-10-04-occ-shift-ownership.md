# OCC Shift Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gestión Humana conserva la lectura de turnos y ausencias, pero solo OCC puede registrar turnos mediante la ruta heredada durante la transición al calendario OCC.

**Architecture:** Mantener el contrato HTTP existente para compatibilidad API-first. Cambiar la autorización en persistencia a ADMIN_OCC y retirar la acción de escritura de la vista GH. El plan posterior incorporará patrones/calendario y retirará la ruta heredada cuando los consumidores hayan migrado.

**Tech Stack:** .NET 10, EF Core, SQL Server, React 18, Vite/Vitest.

**Spec:** `docs/superpowers/specs/2026-10-04-human-resources-operational-interviews-design.md`

## Global Constraints

- Una API y una base lógica compartidas por los tres clientes; ninguna autorización depende de la UI.
- OCC es el único propietario de patrones y programación de turnos; GH conserva lectura y gestión de ausencias.
- Conservar la ruta PUT temporalmente para despliegue API-first; marcarla obsoleta y eliminarla solo tras migrar consumidores.
- Preservar cambios ajenos y no desplegar ni fusionar automáticamente.

## Review Focus

- Un token GH antiguo que llama directamente al PUT debe recibir 403 sin crear turno.
- Una sesión OCC válida conserva la semántica idempotente del PUT durante la transición.
- La UI GH no debe ofrecer el formulario aunque llegue una respuesta de lectura satisfactoria.
- La gestión de ausencias de GH debe seguir disponible al retirar «Nuevo turno».
- Un turno anterior debe seguir visible y el error de revalidación no debe dejar datos privados antiguos.

---

### Task 1: Autoridad de escritura en OCC

**Files:**
- Create: `backend/Elevant.Application/Identity/HumanResourcesShiftWritePolicy.cs`
- Create: `backend/tests/Elevant.UnitTests/Application/HumanResourcesShiftWritePolicyTests.cs`
- Modify: `database/DevelopmentDB/Elevant.Persistence/Identity/EfHumanResourcesShiftWriteStore.cs`
- Modify: `backend/tests/Elevant.IntegrationTests/Persistence/SqlServerMigrationTests.cs`
- Test: `backend/tests/Elevant.UnitTests/Application/HumanResourcesShiftWritePolicyTests.cs`

**Interfaces:**
- Consumes: `IHumanResourcesShiftWriteStore.RecordAsync(Guid actorId, Guid shiftId, RecordHumanResourcesShiftInput input, CancellationToken)`.
- Produces: `HumanResourcesShiftWritePolicy.CanRecord(ActorContext? actor)` y la misma firma del store; `GESTION_HUMANA` y `SUPERADMIN` reciben `Forbidden`, `ADMIN_OCC` puede escribir si cumple alcances y validación existentes.

- [ ] **Step 1: Escribir el test fallido.** Crear `HumanResourcesShiftWritePolicyTests` con tres casos: contexto OCC con membresía interna devuelve `true`, contexto GH con la misma membresía devuelve `false`, y OCC sin membresía interna devuelve `false`. En `HumanResourcesShiftRecordingRespectsScopesReplaysAndEmitsOneChange`, afirmar `Forbidden` para `hrId` y usar `occId` para registro, repetición, colisión y concurrencia. Mantener las afirmaciones de alcance, auditoría y outbox.
- [ ] **Step 2: Ejecutar el unit test y confirmar RED.** Run: `dotnet test backend/tests/Elevant.UnitTests/Elevant.UnitTests.csproj --configuration Release --filter FullyQualifiedName~HumanResourcesShiftWritePolicyTests`. Expected: FAIL por la ausencia de `HumanResourcesShiftWritePolicy`.
- [ ] **Step 3: Implementar política mínima.** Crear `CanRecord(ActorContext? actor)` que exige `ADMIN_OCC` con `PortalKind.BackOffice` y una membresía `AviamOperator/InternalStaff`. En el store, sustituir la condición de autorización por `HumanResourcesShiftWritePolicy.CanRecord(actor)`; conservar las demás invariantes.
- [ ] **Step 4: Verificar GREEN.** Run: `dotnet test backend/Elevant.sln --configuration Release`; Expected: 0 fallos. La prueba SQL será autoridad en CI cuando esté configurado `ELEVANT_TEST_SQLSERVER_MASTER`.
- [ ] **Step 5: Commit.** Añadir solo los cinco archivos de este task y `git commit -m "fix(hr): restrict legacy shift recording to OCC"`.

### Task 2: Gestión Humana solo lee turnos

**Files:**
- Modify: `frontend/private-web/src/features/human-resources/schedules/CurrentShiftsPage.jsx`
- Modify: `frontend/private-web/src/features/human-resources/schedules/CurrentShiftsPage.test.jsx`
- Modify: `frontend/private-web/README.md`
- Test: `frontend/private-web/src/features/human-resources/schedules/CurrentShiftsPage.test.jsx`

**Interfaces:**
- Consumes: `getHumanResourcesShifts` y `AvailabilityRequestsPanel` existentes.
- Produces: `CurrentShiftsPage` de solo lectura de turnos, con gestión de ausencias intacta; no invoca `recordHumanResourcesShift`.

- [ ] **Step 1: Escribir test fallido.** Sustituir la prueba que pulsa «Nuevo turno» por una que carga un turno, afirma que no existe ese botón y que `recordHumanResourcesShift` no se llama, mientras el panel de ausencias permanece visible.
- [ ] **Step 2: Ejecutar y confirmar RED.** Run: `npm test -- src/features/human-resources/schedules/CurrentShiftsPage.test.jsx` desde `frontend/private-web`. Expected: falla porque el botón «Nuevo turno» aún existe.
- [ ] **Step 3: Implementar cambio mínimo.** Retirar `ShiftRecordForm`, `formOpen`, aviso de alta y botón «Nuevo turno» de `CurrentShiftsPage`; mantener navegación semanal, refresco y `AvailabilityRequestsPanel`. Cambiar la descripción a «Programación definida por OCC; Gestión Humana consulta turnos y resuelve disponibilidad» y documentar responsabilidad en README.
- [ ] **Step 4: Verificar GREEN.** Run: `npm test -- src/features/human-resources/schedules/CurrentShiftsPage.test.jsx`; Expected: 0 fallos. Run: `npm test`; Expected: 0 fallos.
- [ ] **Step 5: Commit.** Añadir solo los archivos de este task y `git commit -m "feat(hr): show OCC-owned shifts read-only"`.

### Task 3: Evidencia y handoff

**Files:**
- Modify: `Vault/05-aplicaciones/README.md` o la nota GH enlazada desde su mapa, si allí se afirma que GH programa turnos.
- Modify: `docs/superpowers/specs/2026-10-04-human-resources-operational-interviews-design.md` (ampliación de campos de perfil ya revisada).

**Interfaces:**
- Consumes: hechos verificados en Task 1 y Task 2.
- Produces: documentación de estado actual que distingue el primer hito implementado del resto del diseño.

- [ ] **Step 1: Leer el mapa y la nota afectada, contrastar cada fuente de frontmatter.** No marcar como implementados calendario de 15 días, asistencia, documentos o firma.
- [ ] **Step 2: Actualizar solo afirmaciones de propiedad de turnos; no cambiar `last_verified` ni `verified_commit` sin comprobar todas sus fuentes.**
- [ ] **Step 3: Regenerar y verificar.** Run: `npm run vault:generate`; Expected: termina sin error. Run: `npm run vault:check`; Expected: 0 errores. Run: `git diff --check`; Expected: sin whitespace inválido.
- [ ] **Step 4: Commit.** Añadir únicamente documentación modificada y `git commit -m "docs: clarify OCC shift ownership"`.
