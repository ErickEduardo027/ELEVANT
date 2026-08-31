# Dashboard Administrador/OCC — Diseño

Fecha: 2026-08-01
Autor: sesión de brainstorming con Laisha (frontend/web)

## Contexto y propósito

ELEVANT es la plataforma de gestión de operaciones de ground handling usada por
AVIAM Ltd. en PUJ. El Dashboard es la pantalla de aterrizaje del rol
Administrador/OCC tras iniciar sesión: da una vista panorámica y en tiempo real
de vuelos, servicios, agentes y aprobaciones pendientes del día.

Este directorio (`frontend/web`) todavía no tiene framework definitivo elegido
(ver README.md: Next.js/Astro se decidirá en una PR aparte). El Vite+React
actual es un "preview local", ya usado para construir `LoginPage.jsx`. Este
Dashboard sigue el mismo patrón: página standalone renderizada por `main.jsx`,
sin router todavía.

Decisiones de alcance acordadas con el usuario:

- **Tailwind se instala en este mismo preview Vite**, siguiendo el patrón de
  página standalone de `LoginPage.jsx` (no se espera a la decisión de
  framework definitivo).
- **Tipografía:** Inter para UI/cuerpo/números; IBM Plex Mono como fuente
  utilitaria para códigos técnicos (vuelos, timestamps, posiciones). Difiere
  de la fuente "Geist" usada en `LoginPage.jsx` — el Dashboard es una sección
  con identidad propia (Admin/OCC), no se busca unificar con Login en esta
  tarea.
- **Gráficos:** SVG propio hecho a mano, sin librería de charts.
- **Datos:** capa de adaptador (`src/services/dashboardService.js`) + hook de
  feature (`src/features/dashboard/useDashboardData.js`), según el patrón
  descrito en el README raíz de `frontend/web` (mock reemplazable por API real
  sin que los componentes de presentación lo sepan).
- **Alcance de layout:** solo el contenido del Dashboard (topbar + contenido).
  Se incluye un placeholder visual simple de sidebar (sin rutas reales); la
  navegación funcional queda fuera de esta tarea.
- **Verificación de los 5 estados de entrega:** panel de control flotante
  dev-only (esquina inferior derecha) para alternar tema, skeleton, FlyAware
  caído y aprobaciones vacías sin tocar código. Se marca explícitamente como
  herramienta de desarrollo, no se incluye en ningún flujo de producción.

## Dirección visual

**Sujeto y firma:** el Dashboard es un centro de control de operaciones de
rampa (OCC), no un SaaS genérico. El elemento de firma es la **flight strip
card**: una tarjeta horizontal angosta con un borde de color de estado a la
izquierda, código de vuelo en monoespaciado, y campos tabulares alineados —
el formato real que usan los centros de control aéreo/rampa para representar
un vuelo. Se reutiliza en "Aprobaciones pendientes" y en el feed de alertas.
Es el único elemento de riesgo visual deliberado; el resto del dashboard es
sobrio y contenido.

**Tipografía:**
- Inter (400/500/600/700) — UI, títulos, cuerpo. Números de KPI con
  `font-variant-numeric: tabular-nums` para que los contadores no salten al
  animar.
- IBM Plex Mono — exclusivamente para códigos técnicos: número de vuelo
  (ej. DM161), aerolínea IATA, posición/gate, timestamps AST/UTC.

**Paleta (tokens Tailwind, fijada por el brief, sin margen de interpretación):**
- `ink-900` #0B1F3F — azul marino primario
- `accent-600` #145DC4 — azul medio de acento
- `signal-500` #F2661E — naranja (CTAs, alertas críticas, estados de atención)
- Modo claro: fondo `#F7F9FB`, tarjetas `#FFFFFF` (glass sutil), texto
  primario `#0B1F3F`, texto secundario `#6B7684`
- Modo oscuro: fondo base `#0A1220`, tarjetas glass
  `rgba(11,31,63,0.55)` + blur, texto primario `#F4F6F9`, texto secundario
  `#94A3B8`
- Estados: info/programado `#145DC4`, activo/en curso `#F2661E`,
  aprobado/completado `#1E9E6B`, retrasado/atención `#D9A441`,
  cancelado/error `#C4453C`

**Glassmorphism:** blur 16-20px, bordes translúcidos, sombra difusa suave;
aplicado solo a tarjetas/paneles flotantes, nunca decorativo en exceso.

**Layout desktop (1440px+):**
```
Topbar: selector estación [PUJ] · reloj dual AST/UTC · notificaciones ·
        toggle tema · avatar
KPI row: 4 columnas (glass cards)
FlyAware status strip: ancho completo, delgada
Grid 2 columnas:
  Izquierda: distribución de vuelos por estado (donut + leyenda mono),
             acceso rápido a mapa de posiciones (mini-preview)
  Derecha:   aprobaciones pendientes (flight-strip cards ×5, botón "Ver
             todas"), feed de alertas (flight-strip cards ×5-6, scroll)
```
Tablet (1024px): KPIs en 2×2; resto apilado en una columna, mismo orden.
Mobile: degrada limpiamente a una columna (no prioritario).

**Iconografía:** exclusivamente SVG de línea fina (stroke ~1.6-1.8px),
geométrica, hecha a mano en el mismo estilo que los íconos de
`LoginPage.jsx`. Cero emojis, cero iconografía decorativa tipo consumer app.

## Arquitectura de componentes

```
src/features/dashboard/
  DashboardPage.jsx          — composición de la vista
  DashboardPage.css          — capas Tailwind custom (glass, shimmer, tokens)
  useDashboardData.js        — hook que consume el adaptador de servicio
  usePreviewControls.js      — panel flotante dev-only (tema, skeleton,
                                FlyAware caído, vacío)
  components/
    Topbar.jsx
    KpiCard.jsx
    ProgressRing.jsx          — anillo servicios pendientes/ejecutados
    FlyAwareStatusPanel.jsx
    FlightStatusChart.jsx     — donut + leyenda mono
    FlightStripCard.jsx       — tarjeta firma, parametrizable
                                (aprobación | alerta)
    ApprovalPreviewList.jsx
    AlertsFeed.jsx
    PositionsMapPreview.jsx
    StatusBadge.jsx
    icons/                    — Bell, Sun, Moon, ChevronDown, Plane,
                                ShieldCheck, MapPin, AlertTriangle, RefreshCw
src/services/
  dashboardService.js         — getDashboardSnapshot(stationCode): mock hoy,
                                 misma forma que tendrá la API real
```

`StatusBadge` centraliza el mapeo estado → color (los 5 colores de estado),
tanto para vuelos como para servicios, evitando repetir lógica de color en
cada componente.

## Forma del dato mock (contrato esperado de la API real)

```js
{
  station: {
    code: 'PUJ',
    localAbbr: 'AST',
    localTime: '2026-08-01T14:32:00-04:00',
    utcTime: '2026-08-01T18:32:00Z'
  },
  kpis: {
    flightsToday: 42,
    servicesPending: 18,
    servicesExecuted: 96,
    agentsActive: 27,
    approvalsPending: 4
  },
  flyAware: { status: 'online' | 'degraded' | 'error', lastSyncMinutesAgo: 2 },
  flightStatusDistribution: [
    { status: 'scheduled', count: 14 },
    { status: 'enRoute', count: 9 },
    { status: 'landed', count: 11 },
    { status: 'delayed', count: 5 },
    { status: 'diverted', count: 1 },
    { status: 'cancelled', count: 2 }
  ],
  pendingApprovals: [
    {
      id: 'appr-1',
      flightNumber: 'DM161',
      airlineIata: 'DM',
      station: 'PUJ',
      agent: 'J. Ramírez',
      requestedAt: '2026-08-01T13:50:00-04:00',
      status: 'pendingReview'
    }
  ],
  alerts: [
    {
      id: 'alert-1',
      severity: 'warning' | 'critical' | 'info',
      message: 'Vuelo DM161 no llegó a la posición asignada según hora estimada',
      occurredAt: '2026-08-01T14:20:00-04:00'
    }
  ],
  positionsPreviewUrl: '/positions-map-preview.png'
}
```

## Estados a soportar

- Estados de vuelo: Scheduled, Taxiing/Left Gate, En Route (On Time/Delayed),
  Landed/Taxiing, Arrived/Gate Arrival, Cancelled, Diverted, Result Unknown
  (mapeados a los 6 buckets de `flightStatusDistribution` + `StatusBadge`
  para vistas de detalle).
- Estados de servicio en rampa: Pendiente, Asignado, En ejecución, Pendiente
  de revisión.
- Vacío elegante para "cero aprobaciones pendientes": ícono de línea fino,
  mensaje breve, sin emojis.

## Entregables (verificables vía panel de preview dev-only)

1. Vista completa en modo claro
2. Vista completa en modo oscuro
3. Estado de carga (skeleton con shimmer)
4. Estado con alerta de FlyAware desconectado
5. Estado vacío (sin aprobaciones pendientes)

## Microinteracciones

- KPI cards: conteo ascendente al cargar (`useCountUp`, respeta
  `prefers-reduced-motion`).
- Hover sutil (elevación + brillo de borde) en elementos interactivos.
- Toggle claro/oscuro: transición de color 250-300ms.
- Skeleton: shimmer sutil vía gradiente animado, sin dependencia externa.

## Fuera de alcance

- Router / navegación funcional entre módulos.
- Integración real con API (`packages/api-client`) — se usa el mock con
  forma de contrato ya alineada.
- Sidebar de navegación funcional (solo placeholder visual).
- Vista mobile prioritaria (debe degradar limpiamente, no es objetivo de
  diseño de esta tarea).
