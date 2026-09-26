---
id: aplicaciones-private-web-aviam
title: "Private Web / AVIAM"
type: architecture
area: private-web
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-25"
verified_commit: "c37a6028cdd5f4e269358cf0e97c5190ef89d5d5"
sources:
  - frontend/AGENTS.md
  - frontend/private-web/README.md
  - frontend/private-web/package.json
  - frontend/private-web/src/app/router.jsx
  - frontend/private-web/src/features/auth/authService.js
  - frontend/private-web/src/features/admin-occ/navigation.js
  - frontend/private-web/src/features/human-resources/navigation.js
  - frontend/private-web/src/config/elevantApiClient.js
  - frontend/private-web/src/features/contracts/shell/ContractsShell.jsx
  - frontend/private-web/src/features/finance/shell/FinanceShell.jsx
  - frontend/private-web/src/services/financeHomeService.js
  - frontend/private-web/src/features/flight-monitoring/components/FlightMap.jsx
  - frontend/private-web/src/features/positions-map/components/PositionMap.jsx
  - frontend/private-web/nginx/security-headers.conf
tags:
  - aplicaciones
  - private-web
  - aviam
  - react
  - prototipo
---

# Private Web / AVIAM

Private Web es la aplicación interna de AVIAM para OCC, administración y departamentos operativos. Su acceso usa la sesión real de la API de Development y algunas rutas OCC consumen contratos canónicos. Las pantallas prototípicas, objetos locales y rutas heredadas restantes no son autoridad de permisos, persistencia ni contrato HTTP.

## Ficha de frontera

| Dimensión | Estado verificado |
| --- | --- |
| Audiencias | OCC/administración, Gestión Humana, Contratos, Finanzas y otros departamentos internos representados por esos módulos. |
| Responsabilidad UI | Presentar vistas internas, capturar intenciones y manejar estados de interacción. |
| Autoridad real | Debe residir en la API para identidad, roles, station scope, reglas y datos. |
| Persistencia del cliente | La sesión del prototipo usa almacenamiento del navegador; no es una frontera de autorización. |
| Integración externa | El navegador no conecta directamente a SQL Server, FlightAware ni proveedores de datos aeronáuticos. Como excepción visual verificable, los mapas cargan estilos y teselas cartográficas públicas de MapLibre/OpenFreeMap permitidas explícitamente por CSP. |
| Madurez | Preview técnico ejecutable con cobertura de UI amplia e integración de negocio incompleta. |

## Stack actual

- Vite 6 y JavaScript/JSX como aplicación SPA.
- React 18 y React DOM 18.
- React Router 6 para rutas principales seleccionadas por el rol de la sesión; la API impone la autorización real.
- Tailwind CSS 3 y tokens CSS para presentación.
- MapLibre GL para vistas cartográficas.
- `@elevant/api-client` como dependencia local del monorepo.
- Vitest, Testing Library y jsdom para pruebas; Node test runner para la certificación local de entrega.

Las versiones efectivas se fijan en [`package.json`](../../frontend/private-web/package.json) y `package-lock.json`; esta nota no sustituye esos manifests.

## Estructura útil para desarrollar

| Ruta | Responsabilidad observada |
| --- | --- |
| `src/app/router.jsx` | Router principal, redirects, guards de navegación y composición por rol. |
| `src/features/` | Interfaces y comportamiento por área: auth, OCC, planificación, monitoreo, posiciones, revisión, reportes, notificaciones, chat, contratos, finanzas y Gestión Humana. |
| `src/services/` | Adaptadores de datos heredados y snapshots de prueba; no deben dictar el contrato futuro. |
| `src/config/elevantApiClient.js` | Fábrica aislada para el cliente OpenAPI compartido. |
| `src/components/`, `src/hooks/`, `src/lib/`, `src/styles/` | UI reutilizable, comportamiento transversal, utilidades y tokens. |
| `tests/` y pruebas junto a features | Configuración transversal, smoke del cliente compartido y pruebas unitarias/de componentes. |
| `dashboard.html`, `contracts.html`, `finance.html` | Entradas históricas redirigidas a las rutas actuales. |

## Rutas y recorridos observados

### Entrada y selección de área

- `/login` autentica contra la API de Development; las credenciales mock solo existen en pruebas automatizadas.
- El rol de la sesión redirige a `/admin-occ`, `/gestion-humana`, `/contratos` o `/finanzas`.
- Los guards del router organizan la navegación, pero no sustituyen la autorización del servidor.

### OCC / Administración

Bajo `/admin-occ` existen rutas para dashboard, planificación, monitoreo de vuelos, mapa de posiciones, revisión, reportes, notificaciones y chat. Las interfaces representan planificación y asignaciones, seguimiento de vuelos/turnarounds, contraste de ejecución, aprobación o devolución, cierre/reportes y coordinación interna.

En la rama de integración de Development, planificación incorpora el alta manual de una escala OCC. La pantalla obtiene de la API las aerolíneas con contrato vigente, aeropuertos y posiciones activas para una estación autorizada; envía llegada, salida, fecha, posición y un UUID de intención estable para un reintento ambiguo. La API vuelve a comprobar alcance, contrato, ruta y disponibilidad de posición. Crear una escala deja su operación planificada, pero no programa un turno, no la despacha ni la factura. Este cambio de rama no demuestra aún promoción ni prueba de navegador contra el VPS.

### Gestión Humana

Bajo `/gestion-humana` existen dashboard, usuarios/cuentas, habilitaciones, permisos aeroportuarios, horarios/disponibilidad, reportes, auditoría y notificaciones. El código navega y prueba estas vistas, pero sus datos prototípicos no demuestran que la API ya gestione cuentas o permisos.

### Contratos y Finanzas

`/contratos` y `/finanzas` son shells protegidos que cambian módulos mediante estado interno, no rutas independientes para cada pestaña. Contratos presenta inicio, contratos, solicitudes, servicios pactados, reportes y comunicaciones. Finanzas presenta inicio, servicios aprobados, prefacturación, conciliación, tarifas, reportes y comunicaciones. Sus dos resúmenes iniciales están etiquetados como datos sintéticos: Finanzas usa un snapshot local en vez del endpoint heredado inexistente `/api/finance/summary`. El buzón de notificaciones heredado está oculto para ambos roles, evitando solicitudes a `/api/notifications`. Esto no certifica los módulos profundos, que todavía conservan adaptadores de prototipo.

## Estado de integración

| Capa | Actual | Límite |
| --- | --- | --- |
| UI | Las rutas, componentes, filtros, formularios y estados son ejecutables. | Ejecutable no equivale a flujo de negocio integrado. |
| Autenticación | `authService.js` usa el cliente OpenAPI para crear y revalidar la sesión de Development; tests usan identidades sintéticas. | La sesión en el navegador no sustituye el enforcement del backend por rol y estación. |
| Datos de negocio | Planificación, revisión, chat y notificaciones operativas OCC usan contratos canónicos. Otros servicios combinan snapshots/fixtures y rutas heredadas. | Las formas mock no son OpenAPI vigente. |
| Cliente compartido | Existe una fábrica validada para `@elevant/api-client`. | Contratos y Finanzas todavía no migraron sus módulos profundos de forma general. |
| API real | El build de Development alinea ambas URLs públicas hacia el mismo origen de API. | Los resúmenes sintéticos no prueban endpoints financieros o contractuales; los módulos heredados pueden seguir fallando hasta su migración. |

## Desarrollo local

Desde `frontend/private-web`:

```powershell
npm ci
npm test
npm run test:delivery
$env:VITE_ELEVANT_API_URL = "https://api.elevant.test"
$env:VITE_PROTOTYPE_API_URL = $env:VITE_ELEVANT_API_URL
npm run dev
npm run build
```

`npm run preview` permite revisar el build local. Vite usa el puerto local documentado por el README del cliente; verifica allí cualquier cambio vigente en vez de copiar comandos antiguos del monorepo.

## Pruebas que posee

- pruebas Vitest de páginas, componentes, hooks, mappers y servicios;
- pruebas del router, autenticación y manejo de sesión expirada;
- smoke de creación del cliente OpenAPI compartido;
- prueba de entrega para validación de entorno, modelo Compose e invariantes de imagen/configuración.

La amplitud de pruebas de UI no prueba la existencia de endpoints .NET de negocio. Para un cambio que cruza HTTP también deben cambiar OpenAPI, el cliente generado y las pruebas de integración del backend.

## Configuración segura

- `VITE_ELEVANT_API_URL` configura el cliente OpenAPI compartido.
- `VITE_PROTOTYPE_API_URL` conserva temporalmente adaptadores heredados.
- Todo `VITE_*` es público y queda en el bundle: nunca contiene token, contraseña, connection string ni secreto de proveedor.
- La configuración certificada exige orígenes HTTPS válidos y que ambas variables representen el mismo origen.
- Un filtro, rol en memoria, ruta protegida o menú oculto nunca reemplaza la autorización de la API.

Usa [`.env.example`](../../frontend/private-web/.env.example) como forma, no como archivo para credenciales reales.

## Objetivo de integración

Cada feature debe consumir un endpoint versionado a través de un adaptador remoto separado de los componentes, representar carga/éxito/vacío/error/no autorizado y dejar que la API derive identidad y scopes. Los cambios incompatibles requieren una secuencia coordinada API-first; la web no debe inferir DTOs a partir de un fixture.

## Brechas y desconocidos

- **Brecha actual:** autenticación y autorización reales no existen en la API compartida.
- **Brecha actual:** las rutas de negocio usadas por servicios heredados no están en el OpenAPI vigente.
- **Brecha actual:** SignalR y el proveedor de vuelos están reservados, no entregan datos reales a estas vistas.
- **Brecha actual:** carga de evidencias requiere una capacidad de object storage todavía no diseñada.
- **Desconocido:** orden aprobado para migrar cada módulo desde el prototipo.
- **Desconocido:** roles, permisos y criterios finales de aceptación de cada recorrido; deben acordarse antes de convertirlos en contratos.

## Fuentes y relaciones

- [README del cliente](../../frontend/private-web/README.md)
- [Router actual](../../frontend/private-web/src/app/router.jsx)
- [Fronteras de clientes](../02-producto/fronteras-de-clientes.md)
- [API compartida](api-compartida.md)
- [Mapa de aplicaciones](README.md)
