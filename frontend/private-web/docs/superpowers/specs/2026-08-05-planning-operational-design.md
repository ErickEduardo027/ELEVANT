# Planificación Operativa (Fase 1) — Diseño

Fecha: 2026-08-05
Autor: sesión de brainstorming con Laisha (frontend/web)

## Contexto y propósito

ELEVANT es la plataforma de gestión de operaciones de ground handling usada por
AVIAM Ltd. en PUJ. "Planificación Operativa" es el segundo módulo del rol
Administrador/OCC (el primero fue el Dashboard, ver
`docs/superpowers/specs/2026-08-01-admin-occ-dashboard-design.md`): la pantalla
desde la que el OCC consulta la operación completa del día, filtra y busca
vuelos, detecta conflictos operacionales, y consulta/asigna posiciones,
agentes y equipos — sin salir de la pantalla principal.

Este módulo ya tiene una entrada reservada en el shell: `MODULE_IDS.PLANNING`
existe en `src/features/shell/modules.js` y hoy renderiza un
`ModulePlaceholder`. Esta tarea lo reemplaza por la pantalla real.

`frontend/web` sigue sin framework definitivo elegido (ver README.md raíz).
Este módulo sigue exactamente el mismo patrón que el Dashboard: página
standalone bajo `src/features/planning/`, compuesta de componentes de
presentación pequeños, alimentada por un hook de feature
(`usePlanningData.js`) sobre un adaptador de servicio
(`src/services/planningService.js`) que devuelve datos mock con la forma que
tendrá la API real.

## Decisión de alcance: Fase 1 vs. Fase 2

Este spec cubre **Fase 1**: la pantalla completa (header, filtros, KPIs,
Timeline de vuelos, selector de vistas, Drawer de solo lectura, los 5 estados
de UI). El Drawer se abre y muestra todo su contenido, pero sus botones de
acción (Editar planificación, Asignar recursos, Crear Work Order) están
presentes y estilizados pero **deshabilitados**, con tooltip "Próximamente".

**Fase 2** (spec y plan independientes, a futuro) hace esos botones
funcionales: cada uno abre un formulario ligero dentro del Drawer y, al
enviarlo, actualiza el estado mock local de forma optimista (sin backend, sin
persistencia más allá de la sesión).

Motivo de la división: el brief completo (pantalla + asignación funcional +
Work Orders) es sustancialmente más grande que el Dashboard (que ya tomó ~16
commits incrementales); dividirlo permite revisar y aprobar la pantalla base
antes de construir la lógica de asignación sobre ella.

## Integración con el shell existente

- Nuevo: `src/features/planning/PlanningPage.jsx`.
- Modificado: `src/features/shell/AppShell.jsx` — se agrega un hook
  `usePlanningData` junto al ya existente `useDashboardData`, y se renderiza
  `<PlanningPage />` cuando `activeModule.id === MODULE_IDS.PLANNING`, en el
  mismo `if/else` donde hoy vive `DashboardPage` vs. `ModulePlaceholder`.
- No se toca `Sidebar.jsx`, `Topbar.jsx` (el de `dashboard/components/`, ya
  reutilizado por el shell), ni `DashboardPage.jsx`.
- No hay router: el cambio de módulo sigue siendo el `activeModuleId` de
  estado que ya administra `AppShell`.

## Arquitectura de componentes

```
src/features/planning/
  PlanningPage.jsx            — composición de la vista
  usePlanningData.js          — hook sobre el adaptador de servicio
  usePlanningFilters.js       — estado de filtros/búsqueda + lista derivada
  planningMappers.js          — flight -> view-model de FlightCard,
                                 agrupación por hora, cálculo de KPIs
  components/
    PlanningHeader.jsx
    PlanningFilters.jsx
    PlanningKPIs.jsx           — reutiliza KpiCard existente del Dashboard
    ViewSwitcher.jsx
    FlightTimeline.jsx
    FlightCard.jsx
    ConflictIndicator.jsx
    AssignmentSummary.jsx      — resumen compacto de posición/agentes/equipos
                                 (usado en FlightCard y en el Drawer)
    PlanningDrawer.jsx
    EmptyPlanningState.jsx
    PlanningSkeleton.jsx
src/services/
  planningService.js           — getPlanningSnapshot(stationCode, dateISO):
                                  mock hoy, misma forma que tendrá la API real
```

No se crea un componente `FlightStatusBadge` nuevo: se reutiliza el
`StatusBadge` existente (`src/features/dashboard/components/StatusBadge.jsx`,
`domain="flight"`), extendiendo la tabla de estados (ver abajo) para que siga
existiendo una sola fuente de verdad de color/etiqueta de estado de vuelo en
toda la app.

`KpiCard`, `StatusBadge`, `getStatusMeta`/`STATUS_COLORS` e íconos existentes
de `src/features/dashboard/` se importan y reutilizan directamente — no se
duplican.

## Estados de vuelo (extensión de `statusMeta.js`)

Se agregan las claves que necesita Planificación a `FLIGHT_STATUS_META`,
conservando las que ya usa el donut del Dashboard:

```js
export const FLIGHT_STATUS_META = {
  scheduled: { label: 'Programado', color: 'info' },       // existente
  boarding: { label: 'Abordando', color: 'active' },        // nuevo
  taxiing: { label: 'Rodaje', color: 'active' },             // nuevo
  enRoute: { label: 'En ruta', color: 'active' },            // existente
  landed: { label: 'Aterrizado', color: 'success' },         // existente
  arrived: { label: 'En posición', color: 'success' },       // nuevo
  delayed: { label: 'Retrasado', color: 'warning' },         // existente
  diverted: { label: 'Desviado', color: 'danger' },          // existente
  cancelled: { label: 'Cancelado', color: 'danger' },        // existente
};
```

`StatusBadge` y `STATUS_COLORS` no cambian de forma; el donut del Dashboard
sigue funcionando igual porque su mock solo usa las 6 claves originales.

## Forma del dato mock (contrato esperado de la API real)

```js
// getPlanningSnapshot(stationCode = 'PUJ', dateISO) resuelve:
{
  station: { code: 'PUJ', localAbbr: 'AST' },
  date: '2026-08-05',
  flights: [
    {
      id: 'flt-1',
      flightNumber: 'DM161',
      airlineIata: 'DM',
      airlineName: 'ARAJET',
      status: 'scheduled',
      scheduledTime: '2026-08-05T08:05:00-04:00',
      estimatedTime: '2026-08-05T08:05:00-04:00',
      origin: 'PUJ',
      destination: 'JFK',
      aircraftType: 'A320',
      position: 'A5',
      supervisor: 'J. Ramírez',
      agents: ['M. Castillo', 'R. Peña'],
      teams: ['Rampa 2'],
      services: ['Combustible', 'Catering'],
      conflict: null,
      observations: '',
      history: [
        { at: '2026-08-05T07:00:00-04:00', note: 'Planificación creada' }
      ]
    },
    {
      id: 'flt-2',
      flightNumber: 'AA904',
      airlineIata: 'AA',
      airlineName: 'AMERICAN',
      status: 'delayed',
      scheduledTime: '2026-08-05T08:20:00-04:00',
      estimatedTime: '2026-08-05T08:50:00-04:00',
      origin: 'MIA',
      destination: 'PUJ',
      aircraftType: 'B737-800',
      position: 'B21',
      supervisor: 'K. Objío',
      agents: [],
      teams: [],
      services: [],
      conflict: { reason: 'Posición B21 con doble asignación (ver DL2210)' },
      observations: 'Pendiente de asignación de agentes.',
      history: []
    }
    // ... ~28 vuelos en total, cubriendo el día operativo completo
  ]
}
```

Los conflictos (`conflict`) son **datos mock pre-armados**, igual que los
`alerts` del Dashboard — no se calcula solapamiento de posiciones/agentes en
cliente en esta fase. `ConflictIndicator` simplemente renderiza `conflict`
cuando no es `null`.

Callsigns/aerolíneas/aeronaves/posiciones de ejemplo (del brief): DM161
(ARAJET), AA123/AA904 (AMERICAN), B6289 (JETBLUE), DL2210 (DELTA); A320,
A321neo, B737-800, B737 MAX, A330, B787; posiciones A1, A5, B21, B32, BN8.

## KPIs

`PlanningKPIs` — 4 `KpiCard` calculados sobre el dataset **completo del día**
(no filtrado, para que el operador siempre vea los totales reales):

- Vuelos del día: `flights.length`
- Pendientes de asignación: vuelos sin `position` o con `agents.length === 0`
- Posiciones ocupadas: cantidad de posiciones distintas con `position !== null`
- Conflictos detectados: vuelos con `conflict !== null`

## Filtros

`usePlanningFilters` mantiene el estado de filtros y deriva la lista visible
por filtrado **en cliente**, sobre el arreglo `flights` ya cargado (no
placeholder — es un requisito funcional explícito del brief):

- Selects: fecha, aeropuerto (mock: solo PUJ por ahora), aerolínea, estado de
  vuelo, tipo de aeronave, posición, supervisor, agente.
- Búsqueda global: texto libre contra número de vuelo, aerolínea, ruta.
- Filtros rápidos (chips): Hoy, Mañana, Retrasados, Sin asignación,
  Pendientes — atajos que fijan combinaciones del mismo estado de filtro.

Los filtros afectan únicamente al Timeline; los KPIs siempre muestran el
total del día (ver arriba).

## Layout

**Header** (`PlanningHeader`): breadcrumb "Dashboard / Planificación
Operativa", título, descripción corta, 4 acciones rápidas. Solo
**Actualizar** es funcional (reintenta `usePlanningData`, mismo patrón de
`retryToken` que ya usa `AppShell` con el Dashboard). "Nuevo vuelo",
"Importar vuelos", "Exportar" son botones deshabilitados con tooltip
"Próximamente" — el propio brief ya marca "Nuevo vuelo" como placeholder.

**Panel de filtros** (`PlanningFilters`): debajo del header, encima de KPIs.

**KPIs** (`PlanningKPIs`): fila de 4 tarjetas, mismo estilo del Dashboard.

**Área principal**: `ViewSwitcher` (Timeline / Tabla / Calendario) encima de
`FlightTimeline`. Timeline es la vista por defecto y la única funcional en
esta fase; Tabla y Calendario reutilizan el patrón visual de
`ModulePlaceholder.jsx` (ícono + etiqueta + descripción "próximamente"),
mostrados debajo del `ViewSwitcher` mientras filtros/KPIs permanecen visibles
arriba.

**Timeline** (`FlightTimeline` + `FlightCard`): lista vertical con scroll,
ordenada por `scheduledTime`, con separadores de hora entre grupos. Cada
`FlightCard` es una tarjeta horizontal de dos líneas:

- Línea principal: punto/borde de color de estado, `StatusBadge`, hora,
  número de vuelo + aerolínea (mono), ruta, tipo de aeronave, posición,
  tiempo restante (countdown respecto a `scheduledTime`/`estimatedTime`),
  acciones rápidas (Editar, Asignar, Ver detalle, Crear Work Order — abren el
  Drawer; en Fase 1 dentro del Drawer los botones de edición están
  deshabilitados).
- Línea secundaria: supervisor, agentes asignados, equipos asignados,
  `ConflictIndicator` si aplica. Se oculta en tablet (queda accesible vía
  Drawer).

**Drawer** (`PlanningDrawer`): panel lateral derecho, no navega a otra
página. Secciones: información general, datos de aeronave, tripulación,
posición asignada, agentes, equipos, servicios, observaciones, historial.
Botones "Editar planificación", "Asignar recursos", "Crear Work Order"
presentes pero deshabilitados en Fase 1 (tooltip "Próximamente").

## Estados de UI

- **Loading/Skeleton**: `PlanningSkeleton` — filas de shimmer, mismo lenguaje
  visual que el skeleton de `KpiCard` del Dashboard.
- **Sin vuelos** (día sin operación) y **Sin resultados** (filtros sin
  coincidencias): un solo componente `EmptyPlanningState` con prop `reason`
  que cambia el mensaje; ícono de línea fino, sin emojis.
- **Error de carga**: panel inline igual al de `DashboardPage.jsx` (mensaje,
  detalle, botón "Reintentar").
- **Conflicto detectado / retrasado / cancelado**: no son pantallas
  separadas, son variantes visuales de `FlightCard`/`ConflictIndicator`
  (borde de color de estado + ícono de conflicto).

**Panel de preview dev-only**: se extiende el `DevPreviewPanel` ya existente
con estados forzados propios de Planificación (skeleton, sin resultados, sin
vuelos, error), mismo patrón `forceState` que ya usa el Dashboard — no se
crea un segundo panel.

## Microinteracciones

- Hover sutil (elevación + brillo de borde) en `FlightCard`, igual que
  `KpiCard`/`FlightStripCard` del Dashboard.
- Transición de apertura/cierre del Drawer: 200ms, deslizamiento desde la
  derecha + fondo con blur, mismo patrón que el overlay de `Sidebar.jsx` en
  breakpoints no-desktop.
- Chips de filtro rápido: transición de color 200ms al activarse/desactivarse.
- Sin nuevos colores, sin nueva tipografía: se reutilizan exactamente los
  tokens de `tailwind.config.js` y las fuentes Inter/IBM Plex Mono ya
  instaladas.

## Fuera de alcance (Fase 1)

- Botones de acción funcionales dentro del Drawer (asignar, editar,
  reprogramar, crear Work Order) — Fase 2.
- Vistas Tabla y Calendario funcionales — solo placeholders visuales.
- Integración real con API (`packages/api-client`) — mock con contrato
  alineado.
- Router / navegación funcional entre módulos.
- Cálculo de solapamiento de posiciones/agentes en cliente (conflictos son
  datos mock pre-armados).
- Vista mobile prioritaria (debe degradar limpiamente, no es objetivo de
  diseño).
