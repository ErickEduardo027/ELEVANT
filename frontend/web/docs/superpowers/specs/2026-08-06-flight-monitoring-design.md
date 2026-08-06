# Monitoreo de Vuelos — Diseño

Fecha: 2026-08-06
Autor: sesión de brainstorming con Laisha (frontend/web)

## Contexto y propósito

ELEVANT es la plataforma de gestión de operaciones de ground handling usada por
AVIAM Ltd. en PUJ. "Monitoreo de Vuelos" es el tercer módulo del rol
Administrador/OCC (después de Dashboard —
`docs/superpowers/specs/2026-08-01-admin-occ-dashboard-design.md` — y
Planificación Operativa —
`docs/superpowers/specs/2026-08-05-planning-operational-design.md`): un centro
de monitoreo operacional en tiempo real desde el que el operador OCC supervisa
todos los vuelos relacionados con la estación (programados, aproximándose, en
ruta, aterrizados, saliendo, retrasados, desviados, cancelados) sobre un mapa
en vivo, sin salir de la pantalla principal.

No es un dashboard, no es un CRUD, no es un mapa embebido de un proveedor
externo. El mapa (MapLibre GL JS) es el elemento protagonista; la lista de
vuelos, el panel de detalle y las alertas son los instrumentos que apoyan la
supervisión.

Este módulo ya tiene una entrada reservada en el shell:
`MODULE_IDS.FLIGHT_MONITORING` existe en `src/features/shell/modules.js` y hoy
renderiza un `ModulePlaceholder`. Esta tarea lo reemplaza por la pantalla real.

`frontend/web` sigue sin framework definitivo elegido (ver README.md raíz).
Este módulo sigue exactamente el mismo patrón que Dashboard y Planificación:
página standalone bajo `src/features/flight-monitoring/`, compuesta de
componentes de presentación pequeños, alimentada por hooks de feature sobre un
adaptador de servicio (`src/services/flightMonitoringService.js`) que hoy
devuelve datos mock con la forma que tendrá la futura integración con AeroAPI
(FlightAware) vía la API propia de ELEVANT — nunca se llama a FlightAware
directamente desde el navegador.

## Integración con el shell existente

- Nuevo: `src/features/flight-monitoring/FlightMonitoringPage.jsx`.
- Modificado: `src/features/shell/AppShell.jsx` — se agrega un hook
  `useFlightMonitoringData` junto a `useDashboardData` y `usePlanningData`, y
  se renderiza `<FlightMonitoringPage />` cuando
  `activeModule.id === MODULE_IDS.FLIGHT_MONITORING`, en el mismo `if/else`
  donde hoy viven `DashboardPage`/`PlanningPage`/`ModulePlaceholder`.
- No se toca `Sidebar.jsx`, `Topbar.jsx`, `DashboardPage.jsx` ni
  `PlanningPage.jsx`.
- No hay router: el cambio de módulo sigue siendo el `activeModuleId` de
  estado que ya administra `AppShell`.
- Los botones "Ver planificación" y "Ver mapa de posiciones" del
  `FlightDetailPopover` quedan **deshabilitados** con tooltip "Próximamente"
  (mismo patrón que usó Planificación Fase 1 para sus propios botones no
  funcionales). No se levanta el cambio de módulo activo hasta un nivel que
  permita navegación con contexto entre módulos — queda fuera de alcance.

## Nueva dependencia: MapLibre GL JS

El proyecto no tiene hoy ninguna librería de mapas. Se agrega `maplibre-gl`
como única dependencia nueva (no se agrega `react-map-gl` ni ningún wrapper de
React: el mapa se integra de forma imperativa, ver más abajo). No se usa
Google Maps, no se usa iframe, no se embebe la página pública de FlightAware.

**Basemap**: el style URL es configurable vía variables de entorno públicas
(`PUBLIC_FLIGHT_MAP_STYLE_LIGHT` / `PUBLIC_FLIGHT_MAP_STYLE_DARK`), que hoy
apuntan al style demo gratuito de MapLibre (`demotiles.maplibre.org`) — válido
solo para desarrollo/preview. Antes de producción se reemplazan por un
proveedor con licencia (MapTiler, Stadia, style propio) sin tocar el código
del mapa, solo la variable de entorno.

## Arquitectura de datos en tiempo real

`src/services/flightMonitoringService.js` expone la forma que tendrá el
cliente REST/WebSocket real:

```js
getFlightMonitoringSnapshot(stationCode = 'PUJ')  // → Promise<{ station, flights }>
subscribeToFlightUpdates(onUpdate)                 // → función unsubscribe
```

`subscribeToFlightUpdates` es el mock del futuro WebSocket/SignalR: un
`setInterval` (~4s) que elige 1-3 vuelos activos (no `cancelled`/`arrived`) y
les emite un update parcial (`{ id, latitude, longitude, heading, speed,
altitude }`, y ocasionalmente `status`/`eta`/`stand`). El consumidor no sabe si
el update vino de un socket real o del mock — la migración futura reemplaza
únicamente el cuerpo de `subscribeToFlightUpdates` por un cliente SignalR/REST
polling, sin tocar hooks ni componentes.

**`useFlightMonitoringData(stationCode, refreshToken)`**:
- Carga inicial vía `getFlightMonitoringSnapshot` → `status: 'loading' |
  'success' | 'error'`.
- Se suscribe a `subscribeToFlightUpdates`; cada update hace merge por `id` en
  el arreglo de vuelos (`setState` funcional, solo reemplaza el vuelo
  afectado).
- Expone `connection: 'connected' | 'syncing' | 'disconnected'` y
  `lastUpdatedAt`. `disconnected` se fuerza vía `forceState` (dev preview),
  igual que `flyAwareError` en el Dashboard; al forzarlo se detiene la
  suscripción (no se generan más updates) pero los datos ya cargados
  permanecen visibles.

**`useFlightAlerts(flights)`**: hook separado que observa los updates
entrantes (diff de `status`/`eta`/`stand` contra el valor anterior) y arma la
cola de toasts. Se separa de `useFlightMonitoringData` para no mezclar
"estado de la operación" con "eventos efímeros de UI".

**Mapa**: `FlightMap` monta MapLibre GL imperativamente (`useRef` + un solo
`useEffect` de montaje), sin librería wrapper. Los marcadores se sincronizan
con la prop `flights` vía un efecto de diffing (crear/actualizar/eliminar
marcador por `id`); mover un avión es `marker.setLngLat(...)` con transición
CSS en el elemento del marcador (`transition: transform 3.8s linear`) — nunca
se destruye/recrea el mapa ni el marcador completo por un update de posición.
El cambio de tema (claro/oscuro) hace `map.setStyle(...)` sobre la misma
instancia, sin recrearla.

## Arquitectura de componentes

```
src/features/flight-monitoring/
  FlightMonitoringPage.jsx        — composición de la vista
  useFlightMonitoringData.js      — snapshot inicial + updates simulados
  useFlightMonitoringFilters.js   — búsqueda + chips + filtros de toolbar
  useFlightAlerts.js              — cola de toasts a partir de los updates
  flightMonitoringMappers.js      — view-models, filtros, coordenadas de PUJ
  components/
    FlightToolbar.jsx             — barra superior del módulo
    FlightConnectionStatus.jsx    — estado FlyAware + hora + botón actualizar
    FlightSearch.jsx              — número, aerolínea, matrícula, supervisor
    FlightFilterChips.jsx         — Todos/Programados/En ruta/Retrasados/
                                     Aterrizados/Cancelados/Desviados
    FlightListPanel.jsx           — panel izquierdo, scroll independiente
    FlightListItem.jsx            — tarjeta compacta de vuelo
    FlightMap.jsx                 — contenedor MapLibre
    AircraftMarker.jsx            — construye el elemento DOM del marcador
    AirportMarker.jsx             — marcador fijo de PUJ
    FlightDetailPopover.jsx       — glass card flotante sobre el mapa
    FlightLegend.jsx              — leyenda colapsable
    FlightToast.jsx               — toast individual + contenedor
    FlightMonitoringSkeleton.jsx  — carga
    EmptyFlightState.jsx          — sin vuelos
src/services/
  flightMonitoringService.js
```

Reutilizado sin duplicar: `StatusBadge` (`domain="flight"`),
`STATUS_COLORS`/`getStatusMeta` (`src/features/dashboard/statusMeta.js`),
`PlaneIcon` existente como base del `AircraftMarker` (rotado por `heading` vía
`transform: rotate(...)`), `MapPinIcon` para `AirportMarker`,
`ModulePlaceholder`, e íconos ya existentes de `dashboard/components/icons` y
`planning/components/icons` donde el brief los necesite (buscar, refrescar,
cerrar, chevrons, etc.) — no se crea un ícono nuevo si ya existe uno
equivalente.

### Mapa — detalle

- `FlightMap` recibe `flights`, `selectedFlightId`, `onSelectFlight`, `theme`.
- `AircraftMarker`: `maplibregl.Marker` con elemento HTML custom (SVG del
  `PlaneIcon`, color según `getStatusMeta('flight', status)`, rotado por
  `heading`), hover = `scale(1.15)` vía CSS, sin saltos bruscos de posición
  (transición CSS, ver arriba).
- Click en marcador → `onSelectFlight(id)`; el mapa hace `flyTo` suave al
  vuelo seleccionado (mismo comportamiento al seleccionar desde la lista).
- `FlightDetailPopover` no es el popup nativo de MapLibre (limitado en
  estilos): es un componente React posicionado con `map.project(lngLat)`
  sobre un overlay absoluto, recalculado en los eventos `move`/`zoom` del
  mapa. Así conserva el glassmorphism exacto del design system. Contenido:
  número, aerolínea, origen, destino, tipo de aeronave, matrícula, ETA, ETD,
  hora real, estado (`StatusBadge`), altitud, velocidad, heading, stand,
  supervisor, agentes asignados, servicios asignados, tiempo restante, y los
  dos botones deshabilitados ("Ver planificación", "Ver mapa de posiciones").
- Controles de zoom/pan son el `NavigationControl` nativo de MapLibre. "Reset
  view" hace `flyTo` al `bounds` calculado a partir de todos los vuelos
  visibles + PUJ (la vista inicial con la que carga el mapa); "Centrar PUJ" es
  un botón distinto que siempre hace `flyTo` a las coordenadas fijas de la
  estación a un zoom fijo, independientemente de qué vuelos estén visibles.
- `FlightLegend`: panel colapsable, esquina inferior izquierda, lista los
  colores de `STATUS_COLORS` con su etiqueta (`FLIGHT_STATUS_META`).
- `AirportMarker`: marcador fijo no seleccionable en las coordenadas de PUJ
  (18.5674, -68.3634, definidas en `flightMonitoringMappers.js`).

## Estados de vuelo (extensión de `statusMeta.js`)

Se agregan las claves nuevas que pide el brief, conservando intactas las que
ya usan Dashboard y Planificación:

```js
export const FLIGHT_STATUS_META = {
  scheduled: { label: 'Programado', color: 'info' },         // existente
  boarding: { label: 'Abordando', color: 'active' },          // existente
  taxiing: { label: 'Rodaje', color: 'active' },              // existente
  leftGate: { label: 'Salió de puerta', color: 'active' },    // nuevo
  enRoute: { label: 'En ruta', color: 'active' },             // existente
  approaching: { label: 'Aproximando', color: 'active' },     // nuevo
  landed: { label: 'Aterrizado', color: 'success' },          // existente
  taxiingToGate: { label: 'Rodaje a puerta', color: 'active' },// nuevo
  arrived: { label: 'En posición', color: 'success' },        // existente
  delayed: { label: 'Retrasado', color: 'warning' },          // existente
  diverted: { label: 'Desviado', color: 'danger' },           // existente
  cancelled: { label: 'Cancelado', color: 'danger' },         // existente
  unknown: { label: 'Desconocido', color: 'info' },           // nuevo
};
```

`unknown` reutiliza el bucket `info` (azul), el más neutro de los cinco
colores existentes — no se agrega un color nuevo (gris), cumpliendo la
restricción de paleta del brief. `StatusBadge` no cambia de forma; los
mocks del Dashboard y de Planificación siguen funcionando igual porque solo
usan las claves que ya existían.

## Forma del dato mock (contrato esperado de AeroAPI/futura API)

A diferencia de `planningService.js` (contrato interno de operaciones),
`flightMonitoringService.js` modela el contrato tal como lo expondrá la
integración con AeroAPI/FlightAware, según el ejemplo del brief:

```js
// getFlightMonitoringSnapshot(stationCode = 'PUJ') resuelve:
{
  station: { code: 'PUJ', localAbbr: 'AST' },
  flights: [
    {
      id: 15,
      flightNumber: 'DM161',
      airline: 'Arajet',
      origin: 'MIA',
      destination: 'PUJ',
      registration: 'HI1024',
      aircraft: 'B737 MAX 8',
      status: 'approaching',
      eta: '2026-08-06T14:20:00-04:00',
      etd: '2026-08-06T15:05:00-04:00',
      actualArrival: null,
      actualDeparture: null,
      stand: 'A5',
      supervisor: 'Juan Pérez',
      agents: 5,
      heading: 127,
      speed: 455,
      altitude: 36000,
      latitude: 18.78,
      longitude: -68.12,
      services: ['GPU', 'Baggage', 'Cleaning'],
    },
    // ... ~18-20 vuelos, cubriendo todos los estados soportados
  ],
}
```

Todos los timestamps se generan con offset `-04:00` (hora de Punta Cana),
igual que el resto de los mocks del proyecto. `agents` es un conteo (no una
lista de nombres) tal como lo especifica el brief — el popover muestra
"Agentes asignados: {n}".

## Toolbar, filtros y lista

**`FlightToolbar`**: `FlightConnectionStatus` (conectado/desconectado/
sincronizando, hora de última actualización, botón "Actualizar" que dispara
`refreshToken`, mismo patrón que Dashboard/Planning) + filtros (fecha —
compara contra la porción de fecha de `eta`/`etd`, ya que el mock no tiene un
campo de fecha separado —, aerolínea, estado, origen, destino), `FlightSearch`,
switch "Solo vuelos relacionados con PUJ" (filtra
`origin === 'PUJ' || destination === 'PUJ'`).

**`useFlightMonitoringFilters`**: mismo patrón que `usePlanningFilters`,
deriva `filteredFlights` en cliente. Los chips de `FlightFilterChips` agrupan
estados: "En ruta" incluye `enRoute/approaching/taxiing/leftGate/
taxiingToGate`; el resto son 1:1 con una clave de `FLIGHT_STATUS_META`.

**`FlightListPanel`**: glass panel con `overflow-y-auto` propio (independiente
del mapa). Contiene `FlightSearch` + `FlightFilterChips` + lista de
`FlightListItem`.

**`FlightListItem`**: misma estructura visual que `FlightCard` de
Planificación (borde izquierdo de color por estado, `StatusBadge`, mono para
número/hora), con las columnas del brief: número + aerolínea (el mock no
expone un código IATA separado — el campo `airline` es el nombre completo,
p.ej. "Arajet" — se muestra tal cual), origen→destino, ETA, hora real, stand,
supervisor. Seleccionado = anillo
naranja (`signal-500`) + barra lateral + fondo glass, superpuesto al borde de
color de estado (no lo reemplaza). Click → `onSelectFlight(id)`: centra mapa,
resalta en lista, abre `FlightDetailPopover`.

## Alertas

`useFlightAlerts` encola un toast (`{ id, kind, message, flightNumber }`,
auto-dismiss ~6s, máximo 3 visibles apilados) cuando un update entrante:
cambia `status` a `delayed`/`cancelled`/`diverted`, cambia `eta`, o llega con
`stand: null` habiendo tenido stand antes. Forzar `disconnected` (dev preview)
encola un toast de error una única vez. `FlightToast` usa el mismo lenguaje
glass del resto (`bg-white/95 dark:bg-surface-dark-card`), color por `kind`
tomado de `STATUS_COLORS` — sin colores nuevos.

## Estados de pantalla

- **Carga**: `FlightMonitoringSkeleton` — shimmer en toolbar, lista y bloque
  de mapa, mismo lenguaje que `PlanningSkeleton`.
- **Sin vuelos**: `EmptyFlightState` (ícono de línea fino, sin emojis) cuando
  el snapshot inicial viene vacío; el mapa permanece visible centrado en PUJ.
- **FlyAware desconectado**: `FlightConnectionStatus` muestra "Desconectado" +
  última sincronización; lista y mapa conservan los últimos datos, se detiene
  la simulación de updates hasta reconectar.
- **Vuelo seleccionado**: estado único `selectedFlightId` en
  `FlightMonitoringPage` — controla resaltado de lista, centrado de mapa y
  apertura del popover, sin duplicar el estado entre componentes.
- **Error de carga inicial**: panel inline igual al de `DashboardPage`/
  `PlanningPage` (mensaje + botón "Reintentar").
- **Dev preview**: se extiende `DevPreviewPanel` con estados propios
  (`monitoringEmpty`, `monitoringError`, `flyAwareDisconnected`), mismo patrón
  `forceState` ya usado por Dashboard y Planning — no se crea un panel nuevo.

## Responsive

- **Desktop**: split fijo 30/70 (lista/mapa).
- **Tablet**: `FlightListPanel` pasa a un Drawer lateral (mismo patrón de
  overlay que `PlanningDrawer`/`Sidebar` en breakpoints no-desktop), el mapa
  ocupa el 100% del ancho.
- **Mobile**: no es objetivo de diseño; debe degradar limpiamente (mapa a
  pantalla completa, lista accesible por botón), sin optimización adicional.

## Microinteracciones

- Hover en `FlightListItem`: elevación ligera + glass, igual que `FlightCard`.
- Hover en marcador de avión: `scale(1.15)`, transición 150ms.
- Cambio de filtro/chip: fade 200ms, mismo patrón que Planning.
- Cambio de selección (lista ↔ mapa): `flyTo` suave, apertura de popover con
  fade + slight scale-in.
- Movimiento de aviones: interpolación CSS (`transition: transform 3.8s
  linear` por marcador), nunca saltos bruscos.

## Fuera de alcance

- Integración real con AeroAPI/FlightAware — mock con contrato alineado.
- WebSocket real (SignalR) — el mock deja el seam (`subscribeToFlightUpdates`)
  listo para swap.
- Botones "Ver planificación"/"Ver mapa de posiciones" funcionales
  (deshabilitados, "Próximamente").
- Vista mobile prioritaria.
- Cálculo real de heading/velocidad/trayectoria desde física de vuelo — son
  campos mock perturbados de forma simple por la simulación, sin motor de
  trayectoria.
- Router / navegación funcional entre módulos.
