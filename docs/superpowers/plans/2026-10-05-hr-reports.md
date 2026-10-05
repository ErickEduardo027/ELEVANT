# Reportes verificables de Gestión Humana — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sustituir la muestra parcial de G.H. por cuatro reportes autorizados de API y exportaciones completas PDF/XLSX en Development.

**Architecture:** Un store de lectura EF aplica rol y estación antes de consultar, crea filas tipadas y usa orden estable. Un servicio toma hasta 5 001 filas bajo snapshot, cierra la transacción y renderiza archivos privados. AVIAM Web usa el cliente OpenAPI generado, sin sumar muestras como totales.

**Tech Stack:** .NET 10, EF Core/SQL Server, PDFsharp existente, OpenXML, OpenAPI, `@elevant/api-client`, React/Vitest.

**Spec:** `docs/superpowers/specs/2026-10-05-human-resources-reports-design.md`.

## Global Constraints

- Solo `GESTION_HUMANA` de BackOffice con membresía interna AVIAM y concesión vigente de estación consulta o exporta.
- Una estación fuera de alcance devuelve 404, la pérdida de rol 403; ninguna respuesta reutiliza datos de una sesión anterior.
- Fechas locales ISO y máximo 30 fechas inclusivas; página 1–100; exportación máxima 5 000 filas, 5 001 devuelve 422 sin archivo.
- Un snapshot por exportación; `asOf`, filtros efectivos, estación y número de filas van en el documento.
- No inventar movimientos de cuenta sin auditoría tipada y vínculo de estación; no interpretar horas programadas como horas trabajadas.
- API y clientes usan el contrato generado. DB → API → AVIAM Web para promoción, con operador en cada checkpoint.

## Review Focus

1. Un rol o grant revocado entre vista y exportación debe bloquear la exportación y retirar la vista anterior (Tasks 1, 3, 4).
2. Un filtro con 5 001 filas debe dar 422 y cero bytes de documento, aunque la página 1 sea válida (Tasks 1, 2, 3).
3. La paginación sobre vencimientos iguales debe ser estable por ID y no duplicar ni saltar filas (Task 1).
4. Un texto de usuario que comienza `=`, `+`, `-` o `@` debe quedar como texto inerte en XLSX (Task 2).
5. Dos cambios concurrentes entre vista y exportación pueden cambiar el contenido; cada exportación debe mantener sus filas y metadatos en el mismo snapshot (Tasks 1, 2).

## Mapa de interfaces

- `backend/Elevant.Application/Abstractions/Identity/IHumanResourcesReportStore.cs`: `List*Async(actorId, stationId, filters, page, limit, ct)` y `Snapshot*Async(..., maxRowsPlusOne, ct)`; `null` indica rol inválido, un resultado `ForbiddenStation` indica estación sin concesión. Las filas son registros tipados en el mismo archivo o en `backend/Elevant.Application/Identity/HumanResourcesReportModels.cs`.
- `database/DevelopmentDB/Elevant.Persistence/Identity/EfHumanResourcesReportStore.cs`: política de alcance y consultas EF; divide consultas por clase si el archivo excede una responsabilidad.
- `backend/Elevant.Contracts/Identity/HumanResourcesReportContracts.cs`: página tipada de cada informe, filtros y metadatos `AsOf`.
- `backend/Elevant.Api/Controllers/HumanResourcesReportsController.cs`: cuatro rutas GET concretas y exportación por `kind`, mapeo de 400/401/403/404/422.
- `backend/Elevant.Infrastructure/Identity/HumanResourcesReportPdfRenderer.cs` y `HumanResourcesReportXlsxRenderer.cs`: bytes desde snapshot materializado; font resolver PDF compartido con el renderizador financiero.
- `frontend/private-web/src/services/humanResourcesReportsService.js` y `features/human-resources/reports/CurrentReportsPage.jsx`: transporte y vista autenticada.

### Task 1: Lecturas autorizadas y snapshot

**Files:** crear store/modelos/contratos indicados, registrar store en `database/DevelopmentDB/Elevant.Persistence/DependencyInjection.cs`; probar en `backend/tests/Elevant.IntegrationTests/Persistence/HumanResourcesReportStoreTests.cs`.

**Interfaces:** `ReportQuery(Guid StationId, DateOnly From, DateOnly To, string? KindFilter, string? StatusFilter)`; `ReportPage<T>(int Page, int Limit, bool HasMore, DateTimeOffset AsOf, IReadOnlyList<T> Rows)`; `ReportSnapshot<T>(DateTimeOffset AsOf, IReadOnlyList<T> Rows, ReportQuery Filters)`. Los cuatro tipos de fila tienen UUID estable y campos propios; el store devuelve `ReportReadResult<T>` con `ForbiddenRole`, `ForbiddenStation` o `Success`.

- [ ] **Step 1: RED.** Agregar pruebas SQL con dos estaciones, dos cuentas G.H. y una sin rol. Crear más de 100 ciclos con igual vencimiento y comprobar que las páginas 1 y 2 cubren IDs distintos en orden determinista. Probar movimientos solo de acciones tipadas con `AuditEntry.StationId` verificable, turnos y denominador de cobertura; 30 fechas aceptadas, 31 rechazadas.

```csharp
Assert.Equal(100, first.Rows.Count);
Assert.DoesNotContain(first.Rows.Select(row => row.Id), second.Rows.Select(row => row.Id));
Assert.Equal(ReportReadFailure.ForbiddenStation, crossStation.Failure);
```

- [ ] **Step 2: Ejecutar RED.** `dotnet test backend/tests/Elevant.IntegrationTests/Elevant.IntegrationTests.csproj --filter FullyQualifiedName~HumanResourcesReportStoreTests`; se espera fallo por tipos/store ausentes.
- [ ] **Step 3: GREEN.** Reutilizar `EfActorContextResolver` y revalidar `StationScopes`. Construir consultas `AsNoTracking` filtradas en SQL y ordenar por fecha, código e ID interno. Ejecutar `Take(limit+1)` para página. Para exportar, usar aislamiento snapshot de SQL Server y `Take(5001)` dentro de la transacción de lectura; materializar metadatos y filas antes de cerrarla. No usar la página de UI como fuente. Añadir auditoría tipada de estación a futuros cambios de cuenta que hoy carecen de vínculo, sin atribuir retroactivamente eventos históricos ambiguos.
- [ ] **Step 4: Ejecutar GREEN.** Repetir pruebas del store y `dotnet build backend/Elevant.sln --no-restore`; ambos deben pasar. Commit `feat(hr): query scoped report snapshots`.

### Task 2: Renderizadores completos

**Files:** crear dos renderizadores en `backend/Elevant.Infrastructure/Identity`, extraer font resolver compartido desde `Finance/FinancialDocumentPdfRenderer.cs`; fijar dependencia OpenXML compatible en `Directory.Packages.props`, `backend/Elevant.Infrastructure/Elevant.Infrastructure.csproj` y locks .NET; probar en `backend/tests/Elevant.UnitTests/Application/HumanResourcesReportRendererTests.cs`.

**Interfaces:** `byte[] RenderPdf(HumanResourcesReportDocument document)` y `byte[] RenderXlsx(HumanResourcesReportDocument document)` reciben filas ya autorizadas, nunca EF ni HTTP. `HumanResourcesReportDocument` incluye título, estación, filtros normalizados, `AsOf`, cabeceras tipadas y hasta 5 000 filas.

- [ ] **Step 1: RED.** Probar 0 y 101 filas, paginación PDF, archivo XLSX abierto con un lector OpenXML independiente, valores Unicode, y celdas iniciadas por `=`, `+`, `-`, `@` como cadenas literales sin fórmulas. Renderizar PDF financiero y de G.H. en el mismo proceso para descubrir conflictos del resolver de fuentes.

```csharp
Assert.Equal(101, ReadSpreadsheetRows(renderer.RenderXlsx(document)).Count);
Assert.Empty(ReadSpreadsheetFormulas(renderer.RenderXlsx(formulaLikeDocument)));
```

- [ ] **Step 2: Ejecutar RED.** `dotnet test backend/tests/Elevant.UnitTests/Elevant.UnitTests.csproj --filter FullyQualifiedName~HumanResourcesReportRendererTests`; se espera fallo por renderizadores ausentes.
- [ ] **Step 3: GREEN.** PDFsharp dibuja cabeceras y filas con saltos de página y fuente empaquetada compartida. OpenXML produce libro auténtico con estilos mínimos, tipos explícitos de celda string/fecha/número y sin fórmulas ni enlaces externos. Limitar contenido visible y nombre de hoja. No crear archivos temporales permanentes.
- [ ] **Step 4: Ejecutar GREEN.** Repetir pruebas y restore con locks actualizados (`dotnet restore backend/Elevant.sln --locked-mode`); deben pasar. Commit `feat(hr): render complete private report exports`.

### Task 3: API, auditoría y cliente compilado

**Files:** crear controlador indicado, servicio de exportación en `backend/Elevant.Application/Identity`, registrar DI; pruebas `backend/tests/Elevant.IntegrationTests/Api/HumanResourcesReportEndpointsTests.cs`; regenerar `packages/api-client/openapi/elevant-v1.json` y cliente con comandos del package.

**Interfaces:** `GET /api/v1/human-resources/reports/{kind}?stationId=...&from=...&to=...&page=1&limit=50`; `GET .../{kind}/export?format=pdf|xlsx` acepta los mismos filtros, sin página. `kind` solo admite `expirations`, `account-movements`, `staff-distribution`, `qualification-coverage`.

- [ ] **Step 1: RED.** Probar 200 tipado, 400 por fechas/tipo/filtro inválido, 401 sin sesión, 403 sin rol, 404 por estación ajena y 422 para 5 001 filas. Verificar `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, tipo MIME, `Content-Disposition` acotado y auditoría de exportación sin contenido privado. Revocar rol entre GET y export y comprobar bloqueo.

```csharp
Assert.Equal(HttpStatusCode.UnprocessableEntity, tooLarge.StatusCode);
Assert.False(tooLarge.Content.Headers.ContentType?.MediaType == "application/pdf");
```

- [ ] **Step 2: Ejecutar RED.** `dotnet test backend/tests/Elevant.IntegrationTests/Elevant.IntegrationTests.csproj --filter FullyQualifiedName~HumanResourcesReportEndpointsTests`; se espera 404 de rutas ausentes.
- [ ] **Step 3: GREEN.** Controlador delgado con `[PrivateResponse]`, validación de parámetros, autorización de cada petición, mapeo de fallos sin PII y archivos en memoria. Auditar tipo/filtros normalizados/conteo después de snapshot. Regenerar OpenAPI y cliente con los scripts de `packages/api-client`; no editar artefactos a mano.
- [ ] **Step 4: Ejecutar GREEN.** Repetir pruebas API, `npm --prefix packages/api-client run check` y `dotnet build backend/Elevant.sln --no-restore`; deben pasar. Commit `feat(hr): expose scoped report pages and exports`.

### Task 4: Vista de G.H. y entrega

**Files:** crear `frontend/private-web/src/services/humanResourcesReportsService.js`, sustituir `frontend/private-web/src/features/human-resources/reports/CurrentReportsPage.jsx`, actualizar sus pruebas; actualizar `frontend/private-web/README.md`, `backend/README.md`, `docs/api/openapi-contract.md`, `Vault/05-aplicaciones/private-web-aviam.md` y nota de G.H. existente.

**Interfaces:** el servicio conserva sesión al iniciar cada solicitud; la vista selecciona clase, estación autorizada, filtros y página. Exportar invoca el endpoint con filtros actuales y comprueba MIME antes de descargar; nunca exporta las filas visibles como si fueran el conjunto total.

- [ ] **Step 1: RED.** En Vitest, navegar cuatro clases; probar 101 filas entre páginas, estado vacío, 422 con instrucción de acotar filtros, 403 que retira datos previos, descarga PDF/XLSX desde respuesta autenticada, foco/reconexión y un cambio mientras GET está en vuelo que no restaura información revocada.

```jsx
expect(screen.queryByText('Agente de estación anterior')).not.toBeInTheDocument();
expect(screen.getByRole('alert')).toHaveTextContent('No tienes acceso');
```

- [ ] **Step 2: Ejecutar RED.** `npm --prefix frontend/private-web test -- CurrentReportsPage.test.jsx`; se espera fallo por controles y servicio inexistentes.
- [ ] **Step 3: GREEN.** Consumir solo el cliente OpenAPI; cancelar y versionar solicitudes, limpiar al cambiar sesión/estación, reconsultar al foco/online/pista autorizada y mostrar `asOf` y conteo de página. Descargar Blob con nombre y tipo validados; revocar URL temporal al terminar. Eliminar la ruta activa a agregados heredados, sin borrar otros prototipos no relacionados.
- [ ] **Step 4: Ejecutar GREEN.** Pruebas enfocadas, `npm --prefix frontend/private-web run build`, suite .NET afectada, `npm run vault:generate`, `npm run vault:check`, `npm run check` y `git diff --check`; deben pasar. Commit `feat(hr): use verified reports and complete exports`.
- [ ] **Step 5: Entrega.** Revisar diff completo y secretos, abrir PR contra Development, esperar CI verde; fusionar bajo autorización ya dada, observar entrega Development y pedir al operador el estado DB/API/AVIAM Web. Un recorrido Playwright local y remoto con cuenta G.H. compara vista y exportaciones para datos sintéticos multipágina. El worktree se retira tras integrar el código original.
