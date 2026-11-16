# Validación de asistencia por Gestión Humana — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que G.H. revise los aportes manuales de OCC y del agente, seleccione los hitos aceptados con justificación y conserve una decisión auditable que se invalida cuando cambia cualquiera de los aportes.

**Architecture:** Una proyección paginada por estación y fecha local de operación muestra asignaciones y últimas revisiones de ambos carriles. Un comando idempotente y transaccional guarda una decisión inmutable que referencia esas revisiones, sin modificar los aportes. La interfaz de G.H. consume solo OpenAPI, revalida tras `attendance_draft`, foco y reconexión, y nunca trata un aviso como el estado canónico.

**Tech Stack:** .NET 10, EF Core/SQL Server, OpenAPI y `@elevant/api-client`, React 18/Vitest.

**Spec:** `docs/superpowers/specs/2026-10-04-human-resources-operational-interviews-design.md`, sección «Gestión Humana, gobernanza y turnos», incluida la decisión del 5 de octubre sobre elegir y justificar hitos discrepantes.

## Global Constraints

- Solo una cuenta activa de G.H. con membresía interna y alcance vigente de la estación puede consultar o validar; una cuenta OCC o de agente no recibe el buzón de G.H.
- Los aportes OCC y agente son revisiones inmutables. La validación referencia las dos revisiones actuales, registra autor e instante y no reescribe horas históricas.
- Cada hito validado se elige de un valor no nulo de uno de los dos carriles. Si difieren, la justificación es obligatoria. Una revisión posterior devuelve el estado visible a «requiere revalidación» y mantiene el historial.
- Un comando móvil o de G.H. no se convierte en fichaje biométrico; las horas extra requieren evidencia y una entrega separada, no una inferencia legal automática.
- No incorporar notificaciones de clausura de servicios OCC, chat departamental, Production ni mutaciones directas del VPS.
- Cambios de esquema y contrato son aditivos; promoción DB → API → cliente con checkpoints del operador.

## Review Focus

1. Dos validadores compiten por la misma asignación: solo una decisión basada en las revisiones esperadas prevalece; la otra recibe 409 (Task 2).
2. Un aporte cambia entre GET y PUT: 409, sin decisión obsoleta ni borrado del intento local (Tasks 2 y 4).
3. Falta un carril o falta el hito elegido: mostrar «pendiente de aporte» y rechazar la validación; nunca inventar una hora (Tasks 1 y 4).
4. Una cuenta pierde estación o rol durante una sesión: el servidor deniega y la interfaz retira el snapshot anterior (Tasks 2–4).
5. Reintento ambiguo de PUT: mismo UUID y cuerpo devuelve el resultado previo; mismo UUID con otro cuerpo devuelve 409 (Task 2).

## Interfaces y archivos

- `backend/Elevant.Application/Operations/AttendanceValidationModels.cs` y `AttendanceValidationPolicy.cs`: comando, resultado y reglas puras de selección de hitos.
- `backend/Elevant.Application/Abstractions/Operations/IAttendanceValidationStore.cs`: `Task<HumanResourcesAttendancePage?> ListAsync(Guid actorId, Guid stationId, DateOnly from, DateOnly to, int page, int limit, CancellationToken ct)` y `Task<AttendanceValidationResult> ValidateAsync(AttendanceValidationCommand command, CancellationToken ct)`. Página `null` significa falta de rol/membresía; estación fuera de alcance devuelve página vacía para no revelar asignaciones.
- `backend/Elevant.Contracts/Operations/AttendanceValidationContracts.cs`: página, fila, decisión y solicitud con `expectedOccRevision`, `expectedRampAgentRevision`, `startSource`, `endSource`, `reason`. Los números esperados deben ser positivos y los nombres de fuente solo `Occ` o `RampAgent`.
- `backend/Elevant.Domain/Entities/Operations/OperationAttendanceValidation.cs`: fila inmutable con referencias a revisiones, horas elegidas, autor, motivo, UUID idempotente y hash de petición.
- `database/DevelopmentDB/Elevant.Persistence/Operations/EfAttendanceValidationStore.cs`, configuración EF, `ElevantDbContext`, DI y migración generada: lectura con alcance y escritura serializable.
- `backend/Elevant.Api/Controllers/HumanResourcesAttendanceController.cs`: GET paginado y PUT por asignación, con cuerpo pequeño, códigos 400/401/403/404/409 y `Idempotency-Key`.
- `packages/api-client/openapi/elevant-v1.json` y cliente generado: contrato compilado, nunca forma mock.
- `frontend/private-web/src/services/humanResourcesAttendanceService.js`: transporte que captura sesión por petición.
- `frontend/private-web/src/features/human-resources/attendance/AttendanceReviewPage.jsx`: buzón, comparación, elección y confirmación.
- `frontend/private-web/src/features/human-resources/navigation.js`, `HumanResourcesLayout.jsx`, `frontend/private-web/src/app/router.jsx`: nueva ruta real de G.H.

### Task 1: Política y contrato de selección

**Files:** Create `backend/Elevant.Application/Operations/AttendanceValidationModels.cs`, `AttendanceValidationPolicy.cs`, `backend/Elevant.Contracts/Operations/AttendanceValidationContracts.cs`; test `backend/tests/Elevant.UnitTests/Application/AttendanceValidationPolicyTests.cs`.

**Interfaces:** `AttendanceValidationPolicy.Resolve(occ, rampAgent, startSource, endSource, reason)` returns selected `DateTimeOffset` start/end or `Invalid`; sources are `Occ`/`RampAgent`. The command carries both expected revision numbers and a stable UUID.

- [ ] **Step 1: RED.** Probar que inicio OCC y fin agente se seleccionan exactamente de las dos revisiones recibidas; un valor nulo, fin anterior a inicio, carril ausente, fuente desconocida o diferencia sin motivo devuelve `Invalid`. También probar misma hora en ambos carriles sin motivo y motivo máximo de 1000 caracteres.

```csharp
Assert.Equal(AttendanceValidationFailure.Invalid,
    AttendanceValidationPolicy.Resolve(occ, ramp, "Occ", "RampAgent", " ").Failure);
```

- [ ] **Step 2: Ejecutar RED.** `dotnet test backend/tests/Elevant.UnitTests/Elevant.UnitTests.csproj --configuration Release --filter FullyQualifiedName~AttendanceValidationPolicyTests` debe fallar porque no existe la política.
- [ ] **Step 3: GREEN.** Normalizar a UTC con precisión de milisegundos; comparar instantes, no cadenas/horas locales. No aceptar horas arbitrarias en el comando: solo nombres de carril. Limitar nota/motivo antes de persistir.
- [ ] **Step 4: Ejecutar GREEN y commit.** Repetir filtro y suite unitaria; commit `feat(hr): define attendance validation decision`.

### Task 2: Decisión persistente con alcance y concurrencia

**Files:** Create entity/store/interface above; modify `database/DevelopmentDB/Elevant.Persistence/Persistence/Configurations/OperationsConfiguration.cs`, `ElevantDbContext.cs`, `DependencyInjection.cs`; generate migration with `database/DevelopmentDB/scripts/add-migration.ps1`; test `backend/tests/Elevant.IntegrationTests/Persistence/SqlServerMigrationTests.cs`.

**Interfaces:** `ListAsync` returns a `HumanResourcesAttendancePage` ordered by `Turnaround.OperationDate`, operation code and assignment ID, filtered by station and a ≤30-day inclusive local-date interval. `ValidateAsync` returns `Success`, `Replayed`, `Invalid`, `Forbidden`, `NotFound` or `Conflict`.

- [ ] **Step 1: RED.** En SQL Server de prueba, sembrar dos estaciones y cuentas GH/OCC/agente. Exigir que la página de GH muestre solo asignaciones de su estación y las revisiones más recientes; una cuenta sin grant no ve filas. Probar PUT con ambos carriles, dos solicitudes concurrentes, cambio de revisión, repetición idéntica y clave idempotente reutilizada con otro cuerpo.

```csharp
Assert.Equal(AttendanceValidationFailure.Conflict,
    (await store.ValidateAsync(staleCommand, cancellationToken)).Failure);
Assert.Equal(1, await db.OperationAttendanceValidations.CountAsync(cancellationToken));
```

- [ ] **Step 2: Ejecutar RED.** `dotnet test backend/tests/Elevant.IntegrationTests/Elevant.IntegrationTests.csproj --configuration Release --filter FullyQualifiedName~AttendanceValidation`; debe fallar por store/esquema ausente.
- [ ] **Step 3: GREEN.** Crear tabla `ops.operation_attendance_validations` con FK `NO ACTION` a asignación, revisiones OCC/agente y cuenta validadora; índices únicos para identidad externa, asignación+par de revisiones y cuenta+UUID idempotente. Dentro de `ExecutionStrategy.ExecuteInTransactionAsync` serializable, bloquear la asignación, revalidar actor/estación, comprobar las dos revisiones actuales y guardar decisión, auditoría e invalidación `attendance_validation`. La lectura marca una decisión como vigente solo si sus IDs de revisión aún son los últimos.
- [ ] **Step 4: Migración y pruebas.** Generar la migración únicamente con el script revisado, inspeccionar que no incluya datos de negocio ni cascade delete, probar base limpia y actualización. Repetir integración y `dotnet ef migrations has-pending-model-changes`; commit `feat(hr): persist scoped attendance validations`.

### Task 3: API y cliente generado

**Files:** Create controller above; test `backend/tests/Elevant.IntegrationTests/Api/HumanResourcesAttendanceEndpointsTests.cs`; update compiled OpenAPI and generated API client with repository tooling.

**Interfaces:** `GET /api/v1/human-resources/attendance?stationId=...&from=...&to=...&page=1&limit=20`; `PUT /api/v1/human-resources/attendance/{assignmentId}/validation`, `Idempotency-Key: <UUID>`. The PUT response returns the immutable decision ID, selected instants and `replayed`.

- [ ] **Step 1: RED.** Probar 200 paginado, 400 para rango >30 días, 401 sin JWT, 403 para rol incorrecto, 404 para asignación fuera de estación, 409 por revisiones vencidas, 200 con `replayed=true` para reintento exacto. GET nunca expone notas de una estación ajena.
- [ ] **Step 2: Ejecutar RED.** `dotnet test backend/tests/Elevant.IntegrationTests/Elevant.IntegrationTests.csproj --configuration Release --filter FullyQualifiedName~HumanResourcesAttendanceEndpointsTests` debe fallar por rutas ausentes.
- [ ] **Step 3: GREEN.** Controlador delgado sobre el store, problem details sin notas privadas y `PrivateResponse`; exigir encabezado UUID. Compilar OpenAPI desde API, regenerar cliente y verificar fingerprint con scripts del repositorio; no editar el JSON generado manualmente.
- [ ] **Step 4: Ejecutar GREEN y commit.** API tests, `npm --prefix packages/api-client run check`, `dotnet build backend/Elevant.sln --configuration Release`; commit `feat(hr): expose attendance validation contract`.

### Task 4: Revisión visible y revalidación en G.H.

**Files:** Create service/page above with `.test.js`/`.test.jsx`; modify navigation/layout/router and their tests.

**Interfaces:** `getHumanResourcesAttendance(query, {signal})`; `validateHumanResourcesAttendance(assignmentId, request, key, {signal})`. The page owns page/filter state, selected revisions, attempted choice and one pending key/body until canonical confirmation.

- [ ] **Step 1: RED.** Renderizar con dos asignaciones y estaciones: cambiar filtro cancela lectura vieja; ambos carriles se muestran con autor e instante. Elegir inicio OCC/fin agente con discrepancia exige motivo; una elección inválida nunca envía PUT. Tras 409 se conservan elección/motivo, se relee GET y se exige reconfirmación; ante 401/403 se retiran datos previos.

```jsx
expect(screen.getByRole('alert')).toHaveTextContent('cambió');
expect(screen.getByRole('textbox', { name: /justificación/i })).toHaveValue('Incidencia revisada');
```

- [ ] **Step 2: Ejecutar RED.** `npm --prefix frontend/private-web test -- src/features/human-resources/attendance/AttendanceReviewPage.test.jsx` debe fallar por página ausente.
- [ ] **Step 3: GREEN.** Usar la API tipada, mostrar estado pendiente/vigente/revalidación, paginar, y releer el estado canónico tras `attendance_draft`/`attendance_validation`, foco, online y polling visible. Mantener contribuciones legibles pero no editables; no usar badges mock. El resultado desconocido conserva UUID/cuerpo para un retry explícito.
- [ ] **Step 4: Ejecutar GREEN y commit.** Pruebas de componente/servicio y suite web; commit `feat(hr): review attendance evidence in real time`.

### Task 5: Documentación y aceptación del tramo

**Files:** Modify `frontend/private-web/README.md`, `backend/README.md`, `docs/architecture/database-v1.md`, `Vault/05-aplicaciones/private-web-aviam.md`, `Vault/05-aplicaciones/asistencia-compartida-occ-agente.md`; generated Vault inventory only if the command changes it.

- [ ] **Step 1: Evidencia documental.** Documentar estados, alcance y comandos, y declarar que aún faltan cálculo/evidencia de horas extra, exportaciones, firmas y checklist; no presentar código local como promoción. Verificar cada fuente del frontmatter antes de actualizar `last_verified` o `verified_commit`.
- [ ] **Step 2: Validación completa.** `dotnet tool restore`; `dotnet restore backend/Elevant.sln --locked-mode`; `dotnet build backend/Elevant.sln --configuration Release --no-restore`; `dotnet test backend/Elevant.sln --configuration Release --no-build`; comprobación de migración pendiente; `npm --prefix packages/api-client run check`; `npm --prefix frontend/private-web test`; build web con origen local no secreto; `npm run vault:generate`; `npm run vault:check`; `npm run check`; `git diff --check`.
- [ ] **Step 3: Entrega Development.** PR y CI verdes, merge autorizado, comprobar manifest DB → API → AVIAM Web por commit y salud en cada etapa mediante comandos de solo lectura ejecutados por el operador. En navegador, dos sesiones OCC/agente guardan observaciones, G.H. valida, otro aporte provoca revalidación; comprobar 401/403/409 y reconexión. Si la API certificada no se publica, no forzar la promoción web ni afirmar aceptación remota.
- [ ] **Step 4: Limpieza.** Retirar el worktree Git y su directorio físico solo después de verificar merge y ausencia de trabajo propio sin integrar; no tocar worktrees de otras tareas.

## Resto del plan original

Este tramo no cierra por sí solo la especificación: quedan alertas de descanso/horas, reportes y exportaciones reales de G.H., reporte y orden por vuelo con dos firmas dibujadas versionadas, checklist de puente y aceptación integral local/remota. Cada subsistema tendrá un plan independiente. Las notificaciones de clausura de servicios OCC quedan fuera por decisión del usuario.
