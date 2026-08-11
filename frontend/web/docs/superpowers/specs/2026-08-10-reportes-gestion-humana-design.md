# Reportes de Gestión Humana — Diseño

Fecha: 2026-08-10
Autor: sesión de brainstorming con Laisha (frontend/web)
Brief: `ClaudeSkillsGH/plan-reportGH/skill.md`

## Contexto y propósito

Gestión Humana ya tiene Dashboard, Gestión de usuarios, Habilitaciones,
Carnets y Horarios. `navigation.js` ya reserva una entrada "Reportes" en
`/human-resources/reports` (con la descripción de los 4 reportes), pero hoy
esa ruta cae en `ModulePlaceholder` — este módulo la reemplaza por la pantalla
real.

Admin/OCC ya tiene un módulo de Reportes funcional
(`src/features/reports/`, `src/services/reportsService.js`) con exactamente el
mismo tipo de necesidades (tabs, rango de fechas, filtros, tabla con
paginación/búsqueda, exportación, KPIs, gráficos). El mandato explícito del
brief es reutilizar esa arquitectura y no construir un segundo sistema de
reportes en paralelo.

Inspección del código existente confirma dos cosas:

1. Gran parte de `src/features/reports/components/` es ya 100% genérica (no
   depende del dominio de vuelos): `DateRangePicker`, `ReportTable` +
   `ExpandableReportRow`, `ReportSkeleton`, `ReportEmptyState`, `BarChart`.
   Solo `ReportTabs` y `ExportButton` tienen un acoplamiento leve (importan su
   config/servicio por defecto en vez de recibirlo por prop).
2. `src/components/` (compartido) ya tiene versiones aún más genéricas de
   varias piezas (`KpiCard`, `EmptyState`, `Badge`, `ProgressRing`,
   `CategoryDonutChart`, `HorizontalBarList`, `Tabs`, `DataTable`) que
   Gestión Humana ya usa hoy en Dashboard/Habilitaciones/Permisos — varias de
   ellas fueron generalizadas explícitamente a partir del propio módulo de
   Reportes de Admin/OCC (ver comentarios en `KpiCard.jsx`, `ProgressRing.jsx`,
   `CategoryDonutChart.jsx`).

El patrón establecido en el proyecto para la capa de dominio (no la capa de
presentación) es la copia local por feature: `certifications/statusMeta.js` y
`permits/statusMeta.js` son deliberadamente independientes ("no un import
cruzado entre features") aunque tengan la misma forma. Este diseño sigue esa
misma convención: los componentes de presentación de Reportes se importan
cruzados (como ya hace el propio Admin/OCC con iconos de otros módulos), pero
los mappers/servicios de datos de GH son una copia local adaptada al
dominio de Gestión Humana.

## Qué se reutiliza tal cual (sin tocar Admin/OCC)

- `src/features/reports/components/DateRangePicker.jsx`
- `src/features/reports/components/ReportTable.jsx` +
  `ExpandableReportRow.jsx`
- `src/features/reports/components/ReportSkeleton.jsx`
- `src/features/reports/components/ReportEmptyState.jsx`
- `src/features/reports/components/BarChart.jsx`
- `src/components/KpiCard.jsx`, `EmptyState.jsx`, `Badge.jsx`,
  `ProgressRing.jsx`, `CategoryDonutChart.jsx`, `HorizontalBarList.jsx`
- `src/features/human-resources/certifications/components/EquipmentCoverageView.jsx`
  para el Reporte 4 (ya renderiza tarjetas de cobertura con `ProgressRing` +
  `%` + badge "cobertura limitada" — es exactamente lo que pide el reporte).

## Qué se generaliza (prop opcional, 100% retrocompatible)

- **`ReportTabs.jsx`**: agrega `tabs` (default = `REPORT_TABS` actual, el
  import existente no se toca). Sin test que romper (no existe
  `ReportTabs.test.jsx` hoy).
- **`ExportButton.jsx`**: agrega `exportFn` (default = el `exportReport`
  importado hoy de `reportsService`, mismo binding que ya intercepta
  `vi.spyOn(reportsService, 'exportReport')` en `ExportButton.test.jsx`). GH le
  pasa su propio `exportReport` de habilitaciones.

Estos son los únicos dos cambios en `src/features/reports/` — permitidos por
la regla del brief ("no modificar Admin/OCC salvo que sea estrictamente
necesario para generalizar un componente"). Ningún otro archivo de Admin/OCC
se toca.

## Qué es nuevo

```
src/features/human-resources/reports/
  ReportsPage.jsx            — composición de la vista (patrón ReportsPage de Admin/OCC)
  ReportsRoute.jsx            — wrapper para el router (sin forceState de preview: GH no tiene ese context hoy)
  useReportFilters.js         — tabs + rango de fechas + facets propios de GH
  useReportsData.js           — status/data/error por reporte activo, mismo patrón que useReportsData de Admin/OCC
  reportsMappers.js           — tabs, presets, formatters, clasificación (reutiliza getQualificationStatusKey/getPermitStatusKey)
  components/
    ReportsHeader.jsx         — breadcrumb + título + ExportButton (exportFn propio)
    ReportFilterBar.jsx       — DateRangePicker + selects propios (tipo/severidad/terminal/equipo) + chips
    ExpirationReportTable.jsx     — Reporte 1: columnas sobre ReportTable
    AccountMovementsReport.jsx    — Reporte 2: tabla + 2×BarChart (altas/bajas por período)
    StaffDistributionReport.jsx   — Reporte 3: reusa patrón de StaffDistributionChart + tabla de detalle
    QualificationCoverageReport.jsx — Reporte 4: EquipmentCoverageView + filtro terminal/fecha de corte
src/services/
  humanResourcesReportsService.js — las 4 funciones + exportReport
```

`ReportsPage.jsx` sigue el mismo esqueleto que
`src/features/reports/ReportsPage.jsx`: header con `ExportButton`, `ReportTabs`
(4 pestañas), `ReportFilterBar` contextual al tab activo, y el cuerpo del
reporte activo con loading/error/empty ya resueltos por los componentes
reutilizados.

## Ruteo

`navigation.js` no cambia (la entrada "Reportes" ya existe). En
`router.jsx`, el branch ternario de `humanResourcesChildren` agrega un caso
más:

```js
: item.id === HUMAN_RESOURCES_MODULE_IDS.REPORTS ? (
  <HumanResourcesReportsRoute />
) : ...
```

## Capa de datos — las 4 funciones

`src/services/humanResourcesReportsService.js` no inventa datos nuevos: cada
función combina los stores/servicios de dominio que ya existen, igual que
`reportsService.js` de Admin/OCC combina su propio set de "registros
operativos" en varias vistas.

```js
// 1. Vencimientos — combina Habilitaciones + Carnets/Licencias
async function getExpirationReport(filters) {
  const [qualifications, permits] = await Promise.all([getQualifications(), getPermits()]);
  // normaliza ambos a filas { agentName, documentLabel, kind, terminal, dueDate, daysRemaining, status, modulePath }
  // usa getQualificationStatusKey / getPermitStatusKey (mismos umbrales que sus módulos, sin duplicar la regla)
}

// 2. Altas y bajas — combina usuarios + su historial de cuenta
async function getAccountMovementsReport(filters) {
  const users = await getUsers();
  const histories = await Promise.all(users.map(u => getUserHistory(u.identity.id)));
  // filtra eventos account_activated/account_reactivated/account_disabled dentro del rango de fechas
  // filas: { userName, movement, occurredAt, roleName, performedBy }
  // trend: agrupado por fecha → { altasByPeriod, bajasByPeriod } para los 2 BarChart
}

// 3. Personal por terminal y turno — combina turnos asignados + catálogo de agentes
async function getStaffDistributionReport(filters) {
  const [shifts, agents] = await Promise.all([getShifts(), getAgents()]);
  // cuenta por terminal (A/B/FBO/sin asignar) y por bloque de turno (mañana/tarde/madrugada)
  // + tabla de detalle por agente (nombre, terminal, turno)
}

// 4. Cobertura de habilitaciones — reusa el cálculo ya existente de Habilitaciones
async function getQualificationCoverageReport(filters) {
  // delega en getEquipmentCoverage() de humanResourcesQualificationsService,
  // filtra por terminal y recalcula contra la fecha de corte (filters.cutoffDate)
  // en vez de "hoy" cuando el usuario la cambia
}

async function exportReport({ reportId, format }) { /* mismo mock de latencia que Admin/OCC */ }
```

El bloque de comentario del archivo documenta los endpoints conceptuales del
brief (`getExpirationReport`, etc.) como PROVISIONAL, igual que el resto de
servicios de GH.

## Filtros por reporte

`useReportFilters` mantiene: `activeReport` (una de las 4 tabs), rango de
fechas (`DateRangePicker`, aplica a Altas/bajas; los demás reportes no lo
necesitan y `ReportFilterBar` lo oculta condicionalmente, mismo patrón que
`showPosition` en el `ReportFilterBar` de Admin/OCC), y facets específicos por
tab:

- Vencimientos: tipo de documento (carnet/licencia/habilitación), severidad
  (vigente/próxima a vencer/vencida), terminal.
- Altas/bajas: solo rango de fechas.
- Personal por terminal/turno: terminal, turno.
- Cobertura: terminal, fecha de corte (date input, default hoy).

Cada facet es un `<select>` con el mismo look del `FilterSelect` inline de
`ReportFilterBar` de Admin/OCC — se replica el patrón (no se importa el
componente privado) siguiendo la convención de "copia local adaptada al
dominio" ya usada en `certifications/statusMeta.js` vs `permits/statusMeta.js`.

## Vencimientos — detalle

Tabla sobre `ReportTable`: agente, documento/habilitación, terminal,
vencimiento, días restantes, estado (`Badge` con tono success/warning/danger,
mismos umbrales que Habilitaciones/Carnets). Orden inicial por urgencia
(vencidos primero, luego próximos a vencer, igual criterio que
`sortAgentSummariesByDefault`). Fila vencida con highlight sutil vía la prop
`isCriticalRow` que `ReportTable` ya soporta (mismo mecanismo que usa Admin/OCC
para incidencias). Click en fila navega (no abre panel inline) al módulo
correspondiente — mismo patrón que `ExpirationList` del Dashboard de GH
(`modulePath` por `kind`).

## Altas y bajas — detalle

Tabla (`ReportTable`): usuario, movimiento (alta/activación ·
baja/desactivación), fecha, rol, realizado por. Encima, dos `BarChart`
lado a lado ("Altas por período" / "Bajas por período"), respetando
`DateRangePicker`. Decisión explícita: no se crea un tipo de gráfico nuevo de
dos series — se reutiliza `BarChart` dos veces.

## Personal por terminal y turno — detalle

Reutiliza el patrón visual de `StaffDistributionChart` (dona `CategoryDonutChart`
por terminal + `HorizontalBarList` por turno) alimentado por
`getStaffDistributionReport`, más una tabla de detalle por agente
(`ReportTable`: agente, terminal, turno).

## Cobertura de habilitaciones — detalle

`EquipmentCoverageView` tal cual, alimentado por
`getQualificationCoverageReport(filters)` — filtro de terminal (reduce el
array antes de pasarlo) y fecha de corte (recalcula `coveragePercent` contra
esa fecha en vez de "hoy"). Los indicadores verde/ámbar/rojo ya existen en el
componente (tono de `Badge`/`ProgressRing`); no se agrega ningún color nuevo.

## Estados comunes

Loading → `ReportSkeleton` (o el skeleton propio de `EquipmentCoverageView`
para el tab 4, que ya lo tiene). Error+retry → mismo panel inline que
`ReportsPage`/`DashboardPage` de GH. Empty → `ReportEmptyState`. Exportación →
`ExportButton` con `exportFn` propio, mismos 4 estados (idle/generating/
completed/error) que ya existen.

## Testing

Corrección tras inspeccionar el repo: la convención de "cada mapper/hook/
servicio tiene su `.test.js`" es de Admin/OCC — Gestión Humana no tiene hoy
ningún archivo `.test.*` en `src/features/human-resources/` (Dashboard,
Usuarios, Habilitaciones, Carnets, Horarios se entregaron sin tests
automatizados). Este módulo sigue la convención real de Gestión Humana: sin
`.test.js` nuevos en `src/features/human-resources/reports/` ni en
`humanResourcesReportsService.js` — se verifica con lint/typecheck/build y
prueba manual en el navegador, tal como pide `skill.md` ("Ejecuta lint/
typecheck/build disponibles... verifica que las rutas... sigan
funcionando").

La única excepción es `src/features/reports/` (Admin/OCC), que sí tiene
cobertura de test exhaustiva hoy: los dos cambios retrocompatibles
(`ReportTabs.tabs`, `ExportButton.exportFn`) sí llevan un caso de test nuevo
cada uno, siguiendo el patrón ya establecido en `ExportButton.test.jsx` — sin
tocar los tests existentes.

## Fuera de alcance

- Conexión a un backend REST real — mocks realistas con la forma que tendrá
  la futura API, mismo criterio que el resto de servicios de GH.
- Modificar Admin/OCC más allá de los dos props opcionales retrocompatibles
  (`ReportTabs.tabs`, `ExportButton.exportFn`).
- Vista mobile prioritaria (desktop prioritario, tablet con gráficos apilados
  y tablas con scroll, según el brief).
- Un componente de gráfico de dos series/línea de tiempo — se resuelve con dos
  `BarChart`.
- Tocar `Sidebar`/`HumanResourcesLayout`/`navigation.js` (la entrada de
  Reportes ya existe).
