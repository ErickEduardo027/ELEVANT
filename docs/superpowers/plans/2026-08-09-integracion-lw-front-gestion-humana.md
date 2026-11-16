# Integración de Lw-front (Admin/OCC) en feat/gestion-humana — Plan de implementación

> **Para agentes/ejecutores:** SUB-SKILL REQUERIDA: usa `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para ejecutar este plan tarea por tarea. Los pasos usan checkbox (`- [ ]`) para seguimiento.
>
> **Nota sobre el tipo de plan:** esto NO es desarrollo de feature nueva con TDD clásico (red→green). Es un plan de **integración/port**: casi todo el código de Admin/OCC ya existe, ya está probado y ya funciona en la rama `Lw-front`. El trabajo es (a) fusionar el historial de git, (b) resolver los archivos "compartidos" que ambas ramas construyeron por separado (AppShell, Sidebar, Topbar, icons, tokens, tailwind), y (c) adaptar cada módulo de Admin/OCC para que se monte por ruta (react-router) en vez de por su propio HTML/estado interno. Cada tarea de módulo termina corriendo la suite de tests que YA EXISTE para ese módulo (`vitest`), en vez de escribir tests nuevos — esa suite es la red de seguridad del refactor.

**Objetivo:** Convertir `feat/gestion-humana` en la rama integrada del frontend: contiene el trabajo de Gestión Humana intacto, incorpora todo el trabajo funcional de Admin/OCC (Dashboard, Planificación, Monitoreo de Vuelos, Mapa de Posiciones, Revisión, Reportes, Notificaciones, Chat), y deja la arquitectura preparada (rutas + shell) para Contratos, Finanzas, Agente y Cliente/Aerolínea, todo arrancable con un solo `npm run dev` desde una sola rama.

**Arquitectura:** `feat/gestion-humana` ya construyó exactamente el patrón necesario: un `AppShell` genérico controlado por props (`navigation`, `roleLabel`, `user`) montado vía `react-router-dom` desde `src/app/router.jsx`, con un `Sidebar`/`SidebarItem` que navega por URL (`NavLink`), tokens de Tailwind y `src/components/*` (KpiCard, StatusBadge, ProgressRing, Drawer, Modal, Toast, DataTable, Tabs, EmptyState, Avatar, Badge) y `src/hooks/*` (useCountUp, useDisclosure, useEscapeToClose, useToast) ya generalizados a partir de las versiones específicas de Admin/OCC — el propio código de `feat/gestion-humana` documenta esto en comentarios (`useCountUp.js`, `useEscapeToClose.js`, `AppShell.jsx`) citando explícitamente `feat/adminocc` como origen. Este plan usa esa arquitectura como base y le inyecta el contenido funcional de Admin/OCC que aún vive únicamente en `Lw-front`.

`Lw-front`, en contraste, es un prototipo Vite con dos entradas HTML desconectadas (`index.html`→`LoginPage` cosmético sin redirección real, `dashboard.html`→`AppShell` propio con cambio de módulo vía `useState`, sin URLs, usuario hardcodeado). No es router-based y no puede alcanzar el objetivo ("una rama, un login, navegación por URL a cada entorno") sin esta adaptación — no es una alternativa viable a conservar tal cual.

**Tech Stack:** Vite 6, React 18, react-router-dom 6.28, Tailwind 3.4, Vitest 4 + Testing Library (a incorporar desde Lw-front), maplibre-gl 6 (a incorporar desde Lw-front, para Monitoreo de Vuelos y Mapa de Posiciones).

## Restricciones globales

- No modificar backend, no crear endpoints, no tocar contratos de API (regla explícita del usuario).
- No usar `git push --force`, no eliminar ramas, no `git reset --hard` sin confirmación previa.
- No eliminar funcionalidad de ninguna de las dos ramas. Ante un archivo "ambos añadieron" (AppShell, Sidebar, SidebarItem, icons.jsx, tokens.css, tailwind.config.js), la resolución es "adoptar la versión de `feat/gestion-humana` y portar hacia ella cualquier capacidad de Admin/OCC que se perdería" (documentado módulo por módulo abajo), nunca un `--ours`/`--theirs` ciego.
- Cada tarea de módulo termina con `npx vitest run <ruta del módulo>` en verde antes de pasar a la siguiente.
- No renombrar la ruta ya usada por Gestión Humana (`/human-resources`); Admin/OCC usa `/admin-occ` (kebab-case en inglés, mismo patrón).
- Mantener compatibilidad con modo claro/oscuro: todo componente nuevo debe usar las clases `dark:` existentes, nunca colores hardcodeados fuera de los tokens.
- No commitear los artefactos de captura de Playwright MCP que ya existen sueltos en el árbol de `feat/gestion-humana` (`frontend/web/.playwright-mcp/...` o similar) como parte de este trabajo — son ruido preexistente, no tocarlos ni limpiarlos salvo que el usuario lo pida explícitamente en otra tarea.

---

## Task 1: Merge de ramas y resolución de infraestructura compartida

**Files:**
- Modify (resolución de conflicto, queda = versión `feat/gestion-humana`, sin cambios de contenido): `frontend/web/src/features/shell/AppShell.jsx`, `frontend/web/src/features/shell/components/Sidebar.jsx`, `frontend/web/src/features/shell/components/SidebarItem.jsx`
- Modify (resolución de conflicto, merge manual): `frontend/web/src/features/shell/components/icons.jsx`, `frontend/web/src/styles/tokens.css`, `frontend/web/tailwind.config.js`, `frontend/web/package.json`
- Regenerate: `frontend/web/package-lock.json`
- Auto-resuelven sin intervención (contenido idéntico en ambas ramas): `frontend/web/src/features/shell/components/ModulePlaceholder.jsx`, `frontend/web/src/features/shell/useResponsiveSidebar.js`

**Interfaces:**
- Produce: el árbol resultante tiene disponibles TODOS los archivos de `Lw-front` bajo `frontend/web/src/features/{dashboard,planning,flight-monitoring,positions-map,review,reports,notifications,chat,auth}/**` y `frontend/web/src/services/{dashboard,planning,flightMonitoring,positionsMap,review,reports,notifications,chat}Service.js`, sin que hayan sido tocados todavía (eso es trabajo de las Tasks 5–12).

- [ ] **Paso 1: Confirmar árbol limpio y hacer merge**

```bash
cd "C:/Users/laish/ELE/ELEVANT/frontend/web"
git status   # debe decir "nothing to commit, working tree clean" en feat/gestion-humana
git merge --no-ff Lw-front
```

Esto va a fallar con conflictos exactamente en los archivos listados arriba (ya lo confirmamos en la inspección: `package-lock.json`, `package.json`, `AppShell.jsx`, `Sidebar.jsx`, `SidebarItem.jsx`, `icons.jsx`, `tokens.css`, `tailwind.config.js` como "both added/modified"). Es esperado, no abortar.

- [ ] **Paso 2: Resolver AppShell.jsx, Sidebar.jsx, SidebarItem.jsx — quedarse con la versión de gestion-humana**

Estos tres son funcionalmente un superset (soportan navegación por props + React Router) de la versión de Admin/OCC. No hay nada en la versión de Admin/OCC que no pueda expresarse con la de gestion-humana vía la prop `navigation` (eso ocurre en Task 3).

```bash
git checkout --ours frontend/web/src/features/shell/AppShell.jsx
git checkout --ours frontend/web/src/features/shell/components/Sidebar.jsx
git checkout --ours frontend/web/src/features/shell/components/SidebarItem.jsx
git add frontend/web/src/features/shell/AppShell.jsx frontend/web/src/features/shell/components/Sidebar.jsx frontend/web/src/features/shell/components/SidebarItem.jsx
```

(`--ours` aquí es intencional y documentado, no automático a ciegas — es la resolución que ya decidimos tras comparar ambas versiones línea por línea en la inspección.)

- [ ] **Paso 3: Resolver icons.jsx — unión de ambos sets, sin duplicar**

La versión de `feat/gestion-humana` (`--ours`) ya contiene `LayoutGridIcon`, `CalendarIcon`, `BarChartIcon`, `MenuIcon`, `BellIcon`, `SunIcon`, `MoonIcon`, `ChevronDownIcon`, `ShieldCheckIcon`, `UsersIcon`, `ChecklistIcon`, `IdCardIcon`, `ClockIcon`, `RefreshCwIcon`, `CheckCircleIcon`, `UserMinusIcon`, `AlertTriangleIcon`, `SearchIcon`, `PlusIcon`, `XIcon`, `DotsVerticalIcon`, `MailIcon`, `KeyIcon`, `MapPinIcon`, `BriefcaseIcon`, `PlaneIcon`, `ChevronLeftIcon`, `ChevronRightIcon`, `FileTextIcon`, `LinkExternalIcon`. Falta únicamente `RadarIcon` y `MessageCircleIcon` (usados por la navegación de Admin/OCC: Monitoreo de Vuelos y Chat interno).

```bash
git checkout --ours frontend/web/src/features/shell/components/icons.jsx
git add frontend/web/src/features/shell/components/icons.jsx
```

Añadir al final del archivo (mismo wrapper `Icon` ya presente arriba, copiado literal de la versión de `Lw-front`):

```jsx
export function RadarIcon(props) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.3" />
      <circle cx="12" cy="12" r="4.8" />
      <circle cx="12" cy="12" r="0.2" fill="currentColor" stroke="none" />
      <path d="M12 12 18.2 6.4" />
    </Icon>
  );
}

export function MessageCircleIcon(props) {
  return (
    <Icon {...props}>
      <path d="M4 12.2a8 8 0 1 1 3.4 6.5L4 20l1.2-3.6a7.9 7.9 0 0 1-1.2-4.2Z" />
    </Icon>
  );
}
```

- [ ] **Paso 4: Resolver tokens.css — concatenar el bloque extra de Admin/OCC**

`feat/gestion-humana` (`--ours`) ya tiene el bloque base completo. `Lw-front` añade únicamente las reglas del marcador de aeronave en el mapa de Monitoreo de Vuelos. Tomar `--ours` y agregar al final:

```bash
git checkout --ours frontend/web/src/styles/tokens.css
git add frontend/web/src/styles/tokens.css
```

Agregar al final del archivo:

```css

.flight-monitoring-aircraft-marker__rotor {
  transform-origin: center center;
}

/* Hover feedback for aircraft markers on the flight-monitoring map. Uses !important because
   AircraftMarker.js sets the rotor's transform/transition inline (on every heading/selection
   change) — this rule only needs to win while :hover is active, recomputing the same rotation
   from the mirrored --marker-heading custom property so heading isn't lost while scaled up.
   150ms is intentionally snappier than the 3.8s inline position-transition rule. */
.flight-monitoring-aircraft-marker:hover .flight-monitoring-aircraft-marker__rotor {
  transform: rotate(var(--marker-heading, 0deg)) scale(1.15) !important;
  transition: transform 150ms ease-out !important;
}
```

- [ ] **Paso 5: Resolver tailwind.config.js — quedarse con gestion-humana (superset), añadir `./dashboard.html` NO es necesario**

`feat/gestion-humana` ya tiene `status.neutral` y la animación `fade-in` que `Lw-front` no tiene; el resto es idéntico. No agregamos `dashboard.html` al `content` porque ese archivo desaparece (Task 3 elimina el entrypoint duplicado de Admin/OCC).

```bash
git checkout --ours frontend/web/tailwind.config.js
git add frontend/web/tailwind.config.js
```

- [ ] **Paso 6: Resolver package.json — fusionar dependencias**

Editar `frontend/web/package.json` manualmente para que quede:

```json
{
  "name": "elevant-web-preview",
  "private": true,
  "version": "0.0.0",
  "description": "Vite dev preview only — not the project's chosen framework. See README.md.",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "maplibre-gl": "^6.2.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.28.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@testing-library/user-event": "^14.6.1",
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.5.4",
    "jsdom": "^29.1.1",
    "postcss": "^8.5.25",
    "tailwindcss": "^3.4.19",
    "vite": "^6.4.3",
    "vitest": "^4.1.10"
  }
}
```

```bash
git add frontend/web/package.json
```

- [ ] **Paso 7: Resolver vite.config.js y tests/setupTests.js — quedarse con gestion-humana si difieren, agregar bloque `test`**

`feat/gestion-humana` no tenía `vite.config.js` con bloque `test` (no tenía Vitest). Si `git status` marca `vite.config.js` como conflicto, tomar como base la versión de `feat/gestion-humana` si existe contenido propio (revisar `optimizeDeps.exclude: ['maplibre-gl']` de Lw-front — es necesario, view Task 7), y el bloque `test` de Lw-front. Si `feat/gestion-humana` no tiene `vite.config.js` propio (usa el default de Vite), copiar el de `Lw-front` completo:

```bash
git show Lw-front:./vite.config.js > frontend/web/vite.config.js
git add frontend/web/vite.config.js
mkdir -p frontend/web/tests
git show Lw-front:./tests/setupTests.js > frontend/web/tests/setupTests.js
git add frontend/web/tests/setupTests.js
```

Quitar del `vite.config.js` copiado el bloque `build.rollupOptions.input.dashboard` (ya no existe `dashboard.html`, se elimina en Task 3):

```js
build: {
  rollupOptions: {
    input: {
      main: 'index.html',
    },
  },
},
```

- [ ] **Paso 8: Verificar que no queden conflictos y completar el merge**

```bash
git status   # no debe quedar "Unmerged paths"
git diff --check   # sin marcadores <<<<<<< residuales
```

Si `git status` sigue mostrando archivos sin resolver que no sean los listados arriba, DETENERSE y reportar — no asumir `add -A`.

- [ ] **Paso 9: Regenerar el lockfile e instalar**

```bash
rm frontend/web/package-lock.json
cd frontend/web && npm install
```

Esto genera un `package-lock.json` limpio y consistente con el `package.json` fusionado (evita resolver el conflicto textual del lockfile a mano, que es frágil).

- [ ] **Paso 10: Commit del merge**

```bash
git add frontend/web/package-lock.json
git commit
```

(Dejar el mensaje de merge por defecto que git genera, o editarlo a algo como `Merge branch 'Lw-front' into feat/gestion-humana — integra shell compartido`.)

---

## Task 2: Reloj de estación en el Topbar compartido + `src/lib/clock.js`

Admin/OCC muestra en su Topbar el código de estación y un reloj local/UTC en vivo; `feat/gestion-humana` sustituyó ese bloque por un `roleLabel` genérico. Ambas capacidades son necesarias (regla: no eliminar funcionalidad de ninguna rama) — se añade `station` como prop opcional del Topbar compartido, sin quitar `roleLabel`.

**Files:**
- Create: `frontend/web/src/lib/clock.js`
- Modify: `frontend/web/src/features/shell/components/Topbar.jsx`
- Modify: `frontend/web/src/features/shell/AppShell.jsx` (agregar prop `station`, pasarla al Topbar)

**Interfaces:**
- Produce: `formatClockTime(isoString)`, `formatUtcClockTime(isoString)` exportadas desde `src/lib/clock.js`.
- Produce: `<Topbar station={{ code, localAbbr, localTime, utcTime }} ...>` — si `station` no se pasa, se comporta igual que hoy (usa `roleLabel`).
- Produce: `<AppShell station={...}>` — prop opcional, `undefined` para Gestión Humana.

- [ ] **Paso 1: Crear `src/lib/clock.js`**

```js
function formatTime(date, timeZone) {
  return new Intl.DateTimeFormat('es-DO', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

export function formatClockTime(isoString) {
  return formatTime(new Date(isoString));
}

// Usado por el reloj de estación del Topbar: lee la hora local de la
// máquina donde se opera (esta herramienta se usa en sitio, en la estación).
export function formatUtcClockTime(isoString) {
  return formatTime(new Date(isoString), 'UTC');
}
```

(Confirmar contra `frontend/web/src/features/dashboard/mappers.js` de `Lw-front` la implementación exacta de `formatTime` antes de finalizar este paso — copiar la lógica real, no inventarla; el bloque de arriba es un placeholder de forma, no de contenido, y debe reemplazarse por la función real leída de `git show Lw-front:./src/features/dashboard/mappers.js`.)

- [ ] **Paso 2: Modificar `dashboard/mappers.js` (se hace al portar Dashboard en Task 5) para re-exportar desde `lib/clock`**

Nota: este paso se ejecuta en Task 5, se documenta aquí para que quede registrado el motivo. `dashboard/mappers.js` pasa de definir `formatClockTime`/`formatUtcClockTime` a:

```js
export { formatClockTime, formatUtcClockTime } from '../../lib/clock';
```

Así ningún otro archivo que ya importe `formatClockTime` desde `dashboard/mappers.js` necesita cambiar.

- [ ] **Paso 3: Extender Topbar.jsx con `station` opcional**

En `frontend/web/src/features/shell/components/Topbar.jsx`, agregar el import y la prop, e insertar el bloque de estación antes del bloque de `roleLabel`, mostrando solo uno de los dos:

```jsx
import { formatClockTime, formatUtcClockTime } from '../../../lib/clock';
import { BellIcon, ChevronDownIcon, MenuIcon, MoonIcon, SunIcon } from './icons';

export default function Topbar({ roleLabel, station, notificationsCount = 0, theme, onToggleTheme, user, onOpenMenu, onOpenNotifications }) {
```

Reemplazar el bloque actual:

```jsx
      {roleLabel && (
        <span className="rounded-lg border border-black/10 px-3 py-1.5 text-sm font-semibold text-ink-900 dark:border-white/10 dark:text-text-primary-dark">
          {roleLabel}
        </span>
      )}
```

por:

```jsx
      {station ? (
        <>
          <button
            type="button"
            className="flex items-center gap-1 rounded-lg border border-black/10 px-3 py-1.5 text-sm font-semibold text-ink-900 dark:border-white/10 dark:text-text-primary-dark"
          >
            {station.code}
            <ChevronDownIcon className="h-3.5 w-3.5" />
          </button>
          <div className="flex items-center gap-3 font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
            <span>
              {station.localAbbr} {formatClockTime(station.localTime)}
            </span>
            <span aria-hidden="true">·</span>
            <span>UTC {formatUtcClockTime(station.utcTime)}</span>
          </div>
        </>
      ) : (
        roleLabel && (
          <span className="rounded-lg border border-black/10 px-3 py-1.5 text-sm font-semibold text-ink-900 dark:border-white/10 dark:text-text-primary-dark">
            {roleLabel}
          </span>
        )
      )}
```

- [ ] **Paso 4: Propagar `station` en AppShell.jsx**

En `AppShell({ navigation, roleLabel, user, notificationsPath, station })`, pasar `station={station}` al `<Topbar>` existente junto a `roleLabel={roleLabel}`.

- [ ] **Paso 5: Verificar**

```bash
cd frontend/web && npx vitest run src/features/shell
```

- [ ] **Paso 6: Commit**

```bash
git add frontend/web/src/lib/clock.js frontend/web/src/features/shell/components/Topbar.jsx frontend/web/src/features/shell/AppShell.jsx
git commit -m "feat: soporte de reloj de estación opcional en el Topbar compartido"
```

---

## Task 3: Scaffold de rutas y roles — `/admin-occ`, selector de entorno, placeholders de Contratos/Finanzas/Agente/Aerolínea

**Files:**
- Create: `frontend/web/src/features/admin-occ/navigation.js`
- Create: `frontend/web/src/features/admin-occ/AdminOccLayout.jsx`
- Create: `frontend/web/src/features/admin-occ/AdminOccPreviewContext.jsx`
- Create: `frontend/web/src/features/admin-occ/mockData.js`
- Create: `frontend/web/src/features/auth/roleRouting.js`
- Create: `frontend/web/src/features/auth/EnvironmentSelectorPage.jsx`
- Modify: `frontend/web/src/app/router.jsx`
- Modify: `frontend/web/src/features/auth/LoginPage.jsx` (solo el `handleSubmit`, el JSX/CSS visual NO se toca)

**Interfaces:**
- Produce: `ADMIN_OCC_BASE_PATH = '/admin-occ'`, `ADMIN_OCC_NAVIGATION` (mismo shape que `HUMAN_RESOURCES_NAVIGATION`: `{ id, label, path, icon, description, badge? }[]`).
- Produce: `ROLES` (constantes: `ADMIN_OCC`, `GESTION_HUMANA`, `CONTRATOS`, `FINANZAS`, `AGENTE`, `CLIENTE_AEROLINEA`) y `resolveHomeRouteForRole(role)` en `roleRouting.js`.
- Consume (Task 1/2): `AppShell` con props `navigation`, `roleLabel`, `user`, `notificationsPath`, `station`.

Decisión de diseño (documentada porque cambia el comportamiento visible del login): ni `Lw-front` ni `feat/gestion-humana` tienen hoy un backend que devuelva el rol autenticado, y el `LoginPage` de `Lw-front` es puramente cosmético (no navega a ningún lado). En vez de adivinar un rol por defecto tras el login (lo que acoplaría la arquitectura a un mock, violando la regla del usuario), se agrega una pantalla intermedia `/select-role` que muestra las 6 tarjetas de entorno; los roles ya implementados navegan a su base path, los que no, muestran "Próximamente". Esto es temporal y queda marcado como el punto exacto donde conectar la redirección automática por rol cuando exista el login real — en ese momento, `resolveHomeRouteForRole(user.role)` ya es la función a invocar, solo cambia de dónde viene `user.role`.

- [ ] **Paso 1: `roleRouting.js`**

```js
export const ROLES = {
  ADMIN_OCC: 'ADMIN_OCC',
  GESTION_HUMANA: 'GESTION_HUMANA',
  CONTRATOS: 'CONTRATOS',
  FINANZAS: 'FINANZAS',
  AGENTE: 'AGENTE',
  CLIENTE_AEROLINEA: 'CLIENTE_AEROLINEA',
};

// Única fuente de verdad para "a qué entorno entra cada rol". Hoy se invoca
// desde el selector de entorno (EnvironmentSelectorPage) porque todavía no
// existe un backend que devuelva el rol autenticado; cuando exista, esta
// misma función se invoca con el rol real recibido del login y se retira el
// selector manual.
export function resolveHomeRouteForRole(role) {
  switch (role) {
    case ROLES.ADMIN_OCC:
      return '/admin-occ';
    case ROLES.GESTION_HUMANA:
      return '/human-resources';
    default:
      return null; // Contratos, Finanzas, Agente, Cliente/Aerolínea: aún sin entorno construido.
  }
}
```

- [ ] **Paso 2: `EnvironmentSelectorPage.jsx`**

```jsx
import { useNavigate } from 'react-router-dom';
import { ROLES, resolveHomeRouteForRole } from './roleRouting';

const ENVIRONMENTS = [
  { role: ROLES.ADMIN_OCC, label: 'Administrador / OCC' },
  { role: ROLES.GESTION_HUMANA, label: 'Gestión Humana' },
  { role: ROLES.CONTRATOS, label: 'Contratos' },
  { role: ROLES.FINANZAS, label: 'Finanzas' },
  { role: ROLES.AGENTE, label: 'Agente' },
  { role: ROLES.CLIENTE_AEROLINEA, label: 'Cliente / Aerolínea' },
];

// Reemplaza temporalmente la redirección automática por rol: hoy no hay
// backend que devuelva el rol autenticado (ver roleRouting.js). Cuando lo
// haya, esta pantalla se retira y LoginPage navega directo con
// resolveHomeRouteForRole(role) del usuario real.
export default function EnvironmentSelectorPage() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-light p-6 dark:bg-surface-dark">
      <div className="w-full max-w-2xl space-y-4">
        <h1 className="text-lg font-semibold text-text-primary-light dark:text-text-primary-dark">
          Elige tu entorno
        </h1>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {ENVIRONMENTS.map(env => {
            const path = resolveHomeRouteForRole(env.role);
            return (
              <button
                key={env.role}
                type="button"
                disabled={!path}
                onClick={() => path && navigate(path)}
                className="rounded-2xl border border-black/10 bg-white/70 p-4 text-left text-sm font-medium text-text-primary-light backdrop-blur-md hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark dark:hover:bg-white/5"
              >
                {env.label}
                {!path && <span className="ml-2 text-xs text-text-secondary-light dark:text-text-secondary-dark">(Próximamente)</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Paso 3: Conectar `LoginPage.jsx` al selector (único cambio, sin tocar el JSX visual)**

En `handleSubmit`, donde hoy solo hay temporizadores de `busy`→`done`→`idle`, agregar la navegación tras el estado `done`. Import a agregar arriba del archivo:

```jsx
import { useNavigate } from 'react-router-dom';
```

Dentro de `LoginPage()`, agregar `const navigate = useNavigate();` junto a los demás hooks, y en `handleSubmit`, en el timer que hoy hace `setStatus('done')`, encadenar la navegación:

```jsx
timers.current.push(setTimeout(() => {
  setStatus('done');
  navigate('/select-role');
}, 1500));
```

(No se toca nada más de `LoginPage.jsx` ni de `LoginPage.css` — es una pantalla ya diseñada, PASO 3 del pedido del usuario prohíbe forzar cambios visuales no funcionales.)

- [ ] **Paso 4: `admin-occ/mockData.js`**

```js
export const CURRENT_USER_MOCK = { name: 'Laisha Ramírez', role: 'Administrador OCC' };

export function fallbackStation() {
  const now = new Date().toISOString();
  return { code: 'PUJ', localAbbr: 'AST', localTime: now, utcTime: now };
}
```

- [ ] **Paso 5: `admin-occ/navigation.js`**

```js
import {
  LayoutGridIcon,
  CalendarIcon,
  RadarIcon,
  MapPinIcon,
  ShieldCheckIcon,
  BarChartIcon,
  BellIcon,
  MessageCircleIcon,
} from '../shell/components/icons';

export const ADMIN_OCC_BASE_PATH = '/admin-occ';

export const ADMIN_OCC_MODULE_IDS = {
  DASHBOARD: 'dashboard',
  PLANNING: 'planning',
  FLIGHT_MONITORING: 'flight-monitoring',
  POSITIONS_MAP: 'positions-map',
  APPROVALS: 'approvals',
  REPORTS: 'reports',
  NOTIFICATIONS: 'notifications',
  CHAT: 'chat',
};

export const ADMIN_OCC_NAVIGATION = [
  { id: ADMIN_OCC_MODULE_IDS.DASHBOARD, label: 'Dashboard', path: `${ADMIN_OCC_BASE_PATH}/dashboard`, icon: LayoutGridIcon, description: 'Vista general en tiempo real de vuelos, servicios, agentes y aprobaciones del día.' },
  { id: ADMIN_OCC_MODULE_IDS.PLANNING, label: 'Planificación operativa', path: `${ADMIN_OCC_BASE_PATH}/planning`, icon: CalendarIcon, description: 'Consulta de itinerarios y asignación de agentes y posiciones para las operaciones del día.' },
  { id: ADMIN_OCC_MODULE_IDS.FLIGHT_MONITORING, label: 'Monitoreo de vuelos', path: `${ADMIN_OCC_BASE_PATH}/flight-monitoring`, icon: RadarIcon, description: 'Mapa interactivo en vivo con el estado de cada vuelo en tránsito hacia o desde la estación.' },
  { id: ADMIN_OCC_MODULE_IDS.POSITIONS_MAP, label: 'Mapa de posiciones', path: `${ADMIN_OCC_BASE_PATH}/positions-map`, icon: MapPinIcon, description: 'Mapa georreferenciado completo de las posiciones de Terminal A, Terminal B y el área FBO.' },
  { id: ADMIN_OCC_MODULE_IDS.APPROVALS, label: 'Revisión', path: `${ADMIN_OCC_BASE_PATH}/review`, icon: ShieldCheckIcon, description: 'Centro de control para validar operaciones de ground handling antes de enviarlas a Finanzas.' },
  { id: ADMIN_OCC_MODULE_IDS.REPORTS, label: 'Reportes', path: `${ADMIN_OCC_BASE_PATH}/reports`, icon: BarChartIcon, description: 'Cierre operacional del día, indicadores clave y búsqueda histórica de operaciones.' },
  { id: ADMIN_OCC_MODULE_IDS.NOTIFICATIONS, label: 'Notificaciones', path: `${ADMIN_OCC_BASE_PATH}/notifications`, icon: BellIcon, description: 'Historial completo de alertas y avisos del sistema, más allá del resumen del Dashboard.' },
  { id: ADMIN_OCC_MODULE_IDS.CHAT, label: 'Chat interno', path: `${ADMIN_OCC_BASE_PATH}/chat`, icon: MessageCircleIcon, description: 'Comunicación directa con los agentes de rampa, organizada por vuelo.' },
];
```

- [ ] **Paso 6: `admin-occ/AdminOccPreviewContext.jsx`**

Sustituye a `usePreviewControls.js` de Admin/OCC: el `theme` ahora lo maneja el `useTheme()` compartido del shell (global a toda la app), así que este contexto conserva únicamente `forceState` (el panel de desarrollo para forzar loading/error/vacío en cada módulo), y lo hace persistente a través de la navegación entre módulos de Admin/OCC (cada ruta hija se desmonta/monta; sin este contexto, `forceState` se resetearía en cada click del sidebar).

```jsx
import { createContext, useContext, useState } from 'react';

const AdminOccPreviewContext = createContext({ forceState: 'default', setForceState: () => {} });

export function AdminOccPreviewProvider({ children }) {
  const [forceState, setForceState] = useState('default');
  return (
    <AdminOccPreviewContext.Provider value={{ forceState, setForceState }}>
      {children}
    </AdminOccPreviewContext.Provider>
  );
}

export function useAdminOccPreview() {
  return useContext(AdminOccPreviewContext);
}
```

- [ ] **Paso 7: `admin-occ/AdminOccLayout.jsx`**

```jsx
import AppShell from '../shell/AppShell';
import { ADMIN_OCC_NAVIGATION, ADMIN_OCC_BASE_PATH } from './navigation';
import { CURRENT_USER_MOCK, fallbackStation } from './mockData';

export default function AdminOccLayout() {
  return (
    <AppShell
      navigation={ADMIN_OCC_NAVIGATION}
      roleLabel="Administrador / OCC"
      user={CURRENT_USER_MOCK}
      station={fallbackStation()}
      notificationsPath={`${ADMIN_OCC_BASE_PATH}/notifications`}
    />
  );
}
```

Nota: `station` aquí queda con el fallback estático hasta que la Task 5 (Dashboard) conecte el dato real vía contexto — si se prefiere el reloj en vivo desde el primer commit, ampliar `AdminOccPreviewContext` para incluir `station` también; no es obligatorio para que la navegación funcione.

- [ ] **Paso 8: Placeholders de Contratos, Finanzas, Agente y Cliente/Aerolínea**

Reutilizar `ModulePlaceholder` ya existente (`frontend/web/src/features/shell/components/ModulePlaceholder.jsx`) directamente en el router, sin crear feature folders vacíos todavía — evita "refactorización masiva innecesaria" (PASO 6 del pedido) mientras deja la ruta reservada.

- [ ] **Paso 9: Wiring en `router.jsx`**

```jsx
import { createBrowserRouter, Navigate } from 'react-router-dom';
import LoginPage from '../features/auth/LoginPage';
import EnvironmentSelectorPage from '../features/auth/EnvironmentSelectorPage';
import HumanResourcesLayout from '../features/human-resources/HumanResourcesLayout';
import ModulePlaceholder from '../features/shell/components/ModulePlaceholder';
import HumanResourcesDashboardPage from '../features/human-resources/dashboard/DashboardPage';
import UsersPage from '../features/human-resources/users/UsersPage';
import CertificationsPage from '../features/human-resources/certifications/CertificationsPage';
import {
  HUMAN_RESOURCES_NAVIGATION,
  HUMAN_RESOURCES_BASE_PATH,
  HUMAN_RESOURCES_MODULE_IDS,
} from '../features/human-resources/navigation';
import AdminOccLayout from '../features/admin-occ/AdminOccLayout';
import { AdminOccPreviewProvider } from '../features/admin-occ/AdminOccPreviewContext';
import { ADMIN_OCC_BASE_PATH } from '../features/admin-occ/navigation';
import DashboardRoute from '../features/dashboard/DashboardRoute';
import PlanningRoute from '../features/planning/PlanningRoute';
import FlightMonitoringRoute from '../features/flight-monitoring/FlightMonitoringRoute';
import PositionsMapRoute from '../features/positions-map/PositionsMapRoute';
import ReviewRoute from '../features/review/ReviewRoute';
import ReportsRoute from '../features/reports/ReportsRoute';
import NotificationsRoute from '../features/notifications/NotificationsRoute';
import ChatRoute from '../features/chat/ChatRoute';

const humanResourcesChildren = HUMAN_RESOURCES_NAVIGATION.map(item => ({
  path: item.path.slice(HUMAN_RESOURCES_BASE_PATH.length + 1),
  element:
    item.id === HUMAN_RESOURCES_MODULE_IDS.DASHBOARD ? (
      <HumanResourcesDashboardPage />
    ) : item.id === HUMAN_RESOURCES_MODULE_IDS.USERS ? (
      <UsersPage />
    ) : item.id === HUMAN_RESOURCES_MODULE_IDS.CERTIFICATIONS ? (
      <CertificationsPage />
    ) : (
      <ModulePlaceholder icon={item.icon} label={item.label} description={item.description} />
    ),
}));

const router = createBrowserRouter([
  { path: '/', element: <LoginPage /> },
  { path: '/select-role', element: <EnvironmentSelectorPage /> },
  {
    path: HUMAN_RESOURCES_BASE_PATH,
    element: <HumanResourcesLayout />,
    children: [
      { index: true, element: <Navigate to="dashboard" replace /> },
      ...humanResourcesChildren,
    ],
  },
  {
    path: ADMIN_OCC_BASE_PATH,
    element: (
      <AdminOccPreviewProvider>
        <AdminOccLayout />
      </AdminOccPreviewProvider>
    ),
    children: [
      { index: true, element: <Navigate to="dashboard" replace /> },
      { path: 'dashboard', element: <DashboardRoute /> },
      { path: 'planning', element: <PlanningRoute /> },
      { path: 'flight-monitoring', element: <FlightMonitoringRoute /> },
      { path: 'positions-map', element: <PositionsMapRoute /> },
      { path: 'review', element: <ReviewRoute /> },
      { path: 'reports', element: <ReportsRoute /> },
      { path: 'notifications', element: <NotificationsRoute /> },
      { path: 'chat', element: <ChatRoute /> },
    ],
  },
  {
    path: '/contratos',
    element: <ModulePlaceholder label="Contratos" description="Entorno de Contratos — pendiente de construcción." />,
  },
  {
    path: '/finanzas',
    element: <ModulePlaceholder label="Finanzas" description="Entorno de Finanzas — pendiente de construcción." />,
  },
  {
    path: '/agente',
    element: <ModulePlaceholder label="Agente" description="Experiencia de Agente — pendiente de construcción." />,
  },
  {
    path: '/aerolinea',
    element: <ModulePlaceholder label="Cliente / Aerolínea" description="Portal de aerolínea — pendiente de construcción." />,
  },
]);

export default router;
```

(Los imports `*Route` se crean recién en las Tasks 5–12; este archivo se termina de escribir de forma incremental — en cada Task se descomenta/agrega su línea de import y su entrada en `children`, no se deja el router roto entre tasks: cada Task 5–12 incluye su propio paso de edición de `router.jsx`.)

- [ ] **Paso 10: Verificar que la app arranca y el login navega**

```bash
cd frontend/web && npm run dev
```

Abrir `http://localhost:5173/`, enviar el formulario de login, confirmar que redirige a `/select-role`, que "Gestión Humana" navega a `/human-resources/dashboard` (ya funcionaba antes), y que "Administrador / OCC" navega a `/admin-occ` y no crashea aunque las rutas hijas de Task 5–12 todavía no existan (dará 404 de React Router en los `children`, aceptable hasta que se completen esas tasks — o comentar temporalmente los `children` hasta la Task 5 si se prefiere no ver el placeholder de ruta rota).

- [ ] **Paso 11: Commit**

```bash
git add frontend/web/src/features/admin-occ frontend/web/src/features/auth/roleRouting.js frontend/web/src/features/auth/EnvironmentSelectorPage.jsx frontend/web/src/features/auth/LoginPage.jsx frontend/web/src/app/router.jsx
git commit -m "feat: scaffold de rutas /admin-occ y selector de entorno por rol"
```

---

## Task 4: Port de la capa de servicios de Admin/OCC

**Files:**
- Create: `frontend/web/src/services/dashboardService.js`, `planningService.js`, `flightMonitoringService.js`, `positionsMapService.js`, `reviewService.js`, `reportsService.js`, `notificationsService.js`, `chatService.js`
- Create (tests, copiados junto con su servicio): `*.test.js` correspondientes a cada uno de los anteriores

**Interfaces:**
- Produce: los mismos exports que ya existen en `Lw-front` (p. ej. `getDashboardSnapshot`, `getPlanningSnapshot`, etc.) — no se renombra nada, se copian literales.

- [ ] **Paso 1: Copiar cada servicio y su test, sin modificar contenido**

```bash
for f in dashboardService planningService flightMonitoringService positionsMapService reviewService reportsService notificationsService chatService; do
  git show Lw-front:./src/services/$f.js > frontend/web/src/services/$f.js
  git show Lw-front:./src/services/$f.test.js > frontend/web/src/services/$f.test.js
done
```

- [ ] **Paso 2: Verificar que no colisionan con servicios existentes de Gestión Humana**

```bash
ls frontend/web/src/services/
```

Confirmar que quedan junto a `humanResourcesDashboardService.js`, `humanResourcesQualificationsService.js`, `humanResourcesUsersService.js` sin sobrescribir ninguno (nombres distintos, no debería haber colisión).

- [ ] **Paso 3: Correr los tests de servicios**

```bash
cd frontend/web && npx vitest run src/services
```

- [ ] **Paso 4: Commit**

```bash
git add frontend/web/src/services
git commit -m "feat: port de la capa de servicios (mocks) de Admin/OCC"
```

---

## Task 5: Port del módulo Dashboard (Admin/OCC)

**Files:**
- Create: todo `frontend/web/src/features/dashboard/**` copiado de `Lw-front` (lista completa: `DashboardPage.jsx` + `.test.jsx`, `mappers.js` + `.test.js`, `positionsData.js`, `statusMeta.js` + `.test.js`, `useDashboardData.js` + `.test.js`, y en `components/`: `AlertsFeed`, `ApprovalPreviewList`, `DevPreviewPanel`, `FlightStatusChart`, `FlightStripCard`, `FlyAwareStatusPanel`, `PositionsMapPreview`, cada uno con su `.test.jsx`, más `icons/index.jsx` + `icons/icons.test.jsx`)
- Create: `frontend/web/src/features/dashboard/DashboardRoute.jsx`
- Delete (consolidado en shared): `frontend/web/src/features/dashboard/components/KpiCard.jsx` (+ test), `frontend/web/src/features/dashboard/components/StatusBadge.jsx` (+ test), `frontend/web/src/features/dashboard/components/ProgressRing.jsx` (+ test), `frontend/web/src/features/dashboard/useCountUp.js` (+ test)
- Modify: `frontend/web/src/features/dashboard/mappers.js` (re-exportar clock desde `lib/clock`, y ajustar `StatusBadge` call sites según Paso 4)
- Modify: cada componente que importaba `KpiCard`/`StatusBadge`/`ProgressRing`/`useCountUp` locales
- Modify: `frontend/web/src/app/router.jsx` (agregar import + entrada `dashboard` ya prevista en Task 3)

**Interfaces:**
- Consume (Task 4): `getDashboardSnapshot` de `src/services/dashboardService.js`.
- Consume (Task 3): `useAdminOccPreview()` de `admin-occ/AdminOccPreviewContext.jsx`.
- Consume (ya existente en gestion-humana): `KpiCard` de `src/components/KpiCard.jsx`, `StatusBadge` de `src/components/StatusBadge.jsx`, `ProgressRing` de `src/components/ProgressRing.jsx`, `useCountUp` de `src/hooks/useCountUp.js`.
- Produce: `DashboardRoute` — componente sin props, usado directamente como `element` de la ruta `dashboard`.

- [ ] **Paso 1: Copiar el árbol completo del módulo, sin modificar todavía**

```bash
mkdir -p frontend/web/src/features/dashboard/components/icons
for f in DashboardPage DashboardPage.test mappers mappers.test positionsData statusMeta statusMeta.test useDashboardData useDashboardData.test usePreviewControls usePreviewControls.test; do
  git show "Lw-front:./src/features/dashboard/$f.jsx" > "frontend/web/src/features/dashboard/$f.jsx" 2>/dev/null || \
  git show "Lw-front:./src/features/dashboard/$f.js"  > "frontend/web/src/features/dashboard/$f.js"  2>/dev/null
done
for f in AlertsFeed ApprovalPreviewList DevPreviewPanel FlightStatusChart FlightStripCard FlyAwareStatusPanel PositionsMapPreview; do
  git show "Lw-front:./src/features/dashboard/components/$f.jsx" > "frontend/web/src/features/dashboard/components/$f.jsx"
  git show "Lw-front:./src/features/dashboard/components/$f.test.jsx" > "frontend/web/src/features/dashboard/components/$f.test.jsx"
done
git show "Lw-front:./src/features/dashboard/components/icons/index.jsx" > "frontend/web/src/features/dashboard/components/icons/index.jsx"
git show "Lw-front:./src/features/dashboard/components/icons/icons.test.jsx" > "frontend/web/src/features/dashboard/components/icons/icons.test.jsx"
```

(No copiar `KpiCard.jsx`, `StatusBadge.jsx`, `ProgressRing.jsx`, `Topbar.jsx`, `useCountUp.js` ni sus tests — se consolidan/descartan en los pasos siguientes.)

- [ ] **Paso 2: `mappers.js` — reemplazar la definición local de reloj por el re-export de `lib/clock`**

En `frontend/web/src/features/dashboard/mappers.js`, sustituir la definición de `formatClockTime`/`formatUtcClockTime`/`formatTime` por:

```js
export { formatClockTime, formatUtcClockTime } from '../../lib/clock';
```

manteniendo el resto del archivo (`mapApprovalToStrip`, etc.) intacto.

- [ ] **Paso 3: Redirigir `useCountUp` al hook compartido**

En cualquier archivo bajo `dashboard/components/` que tenga `import { useCountUp } from '../useCountUp';`, cambiar a:

```js
import { useCountUp } from '../../../hooks/useCountUp';
```

Confirmar con `git grep -n "useCountUp" frontend/web/src/features/dashboard` cuáles archivos lo usan (según la inspección, al menos `KpiCard.jsx`, que de todos modos se descarta — verificar si algún otro componente del módulo lo usa directamente).

- [ ] **Paso 4: Redirigir usos de `StatusBadge`/`KpiCard`/`ProgressRing` al shared**

Para cada componente de `dashboard/components/` que importe estos tres desde `./KpiCard`, `./StatusBadge`, `./ProgressRing` locales, cambiar el import a `../../../components/KpiCard`, `../../../components/StatusBadge`, `../../../components/ProgressRing`.

El `StatusBadge` compartido espera `{ tone, label }` en vez de `{ domain, status }`. En cada call site (`git grep -n "<StatusBadge" frontend/web/src/features/dashboard` para listarlos), cambiar:

```jsx
<StatusBadge domain="flight" status={flight.status} />
```

por (resolviendo primero con el `statusMeta.js` del propio módulo, que ya existe y no cambia):

```jsx
const meta = getStatusMeta('flight', flight.status);
// ...
<StatusBadge tone={meta.color} label={meta.label} />
```

Verificar en `statusMeta.js` que los valores de `color` que devuelve (`info`, `active`, `success`, `warning`, `danger`, `neutral`) coinciden con las claves de `DOT_TONE_CLASSES` del `StatusBadge` compartido (`src/components/StatusBadge.jsx`) — deberían coincidir porque `feat/gestion-humana` agregó `status.active` a `tailwind.config.js` específicamente para este caso; si aparece algún valor de color que el compartido no reconozca, es un hallazgo a reportar, no a silenciar con un fallback inventado.

- [ ] **Paso 5: Borrar los archivos consolidados**

```bash
rm frontend/web/src/features/dashboard/components/KpiCard.jsx frontend/web/src/features/dashboard/components/KpiCard.test.jsx
rm frontend/web/src/features/dashboard/components/StatusBadge.jsx frontend/web/src/features/dashboard/components/StatusBadge.test.jsx
rm frontend/web/src/features/dashboard/components/ProgressRing.jsx frontend/web/src/features/dashboard/components/ProgressRing.test.jsx
rm frontend/web/src/features/dashboard/useCountUp.js frontend/web/src/features/dashboard/useCountUp.test.js
```

- [ ] **Paso 6: Crear `DashboardRoute.jsx`**

Este componente reemplaza la porción de `AppShell` de Admin/OCC que antes orquestaba `useDashboardData` + `retryToken` + `forceState` para este módulo específicamente. `forceState` viene del contexto de Task 3; `retryToken` es estado local de esta ruta (antes vivía en el `AppShell` monolítico de Admin/OCC, ahora vive en cada Route — cada módulo ya era independiente en los datos que consume, solo compartía el contenedor).

```jsx
import { useState } from 'react';
import DashboardPage from './DashboardPage';
import { useDashboardData } from './useDashboardData';
import { useAdminOccPreview } from '../admin-occ/AdminOccPreviewContext';

export default function DashboardRoute() {
  const [retryToken, setRetryToken] = useState(0);
  const { status, data, error } = useDashboardData('PUJ', retryToken);
  const { forceState } = useAdminOccPreview();

  return (
    <DashboardPage
      status={status}
      data={data}
      error={error}
      onRetry={() => setRetryToken(token => token + 1)}
      forceState={forceState}
    />
  );
}
```

Nota: el `DashboardPage.jsx` copiado de Admin/OCC recibe también `onOpenPositionsMap` en el `AppShell` original (navegación cruzada dashboard→mapa). En el nuevo modelo de rutas, cambiar ese prop dentro de `DashboardRoute.jsx` para que use `useNavigate()` de `react-router-dom` en vez del callback que antes le pasaba el `AppShell` de Admin/OCC:

```jsx
import { useNavigate } from 'react-router-dom';
// ...
const navigate = useNavigate();
// ...
<DashboardPage
  // ...
  onOpenPositionsMap={() => navigate('/admin-occ/positions-map')}
/>
```

- [ ] **Paso 7: DevPreviewPanel — montarlo dentro del layout, no del route**

`DevPreviewPanel` (theme, forceState, toggles) debe verse en todos los módulos de Admin/OCC, no solo en Dashboard. Moverlo de `DashboardRoute` a `AdminOccLayout.jsx` (Task 3), usando el `useTheme()` compartido para `theme`/`onToggleTheme` y `useAdminOccPreview()` para `forceState`/`onSetForceState`:

En `frontend/web/src/features/admin-occ/AdminOccLayout.jsx`, envolver el retorno actual agregando el panel como hermano de `<AppShell>` (fuera de él, para no forzar a `AppShell` a conocer un concepto admin-específico):

```jsx
import AppShell from '../shell/AppShell';
import DevPreviewPanel from '../dashboard/components/DevPreviewPanel';
import { useTheme } from '../shell/useTheme';
import { useAdminOccPreview } from './AdminOccPreviewContext';
import { ADMIN_OCC_NAVIGATION, ADMIN_OCC_BASE_PATH } from './navigation';
import { CURRENT_USER_MOCK, fallbackStation } from './mockData';

export default function AdminOccLayout() {
  const { theme, toggleTheme } = useTheme();
  const { forceState, setForceState } = useAdminOccPreview();

  return (
    <>
      <AppShell
        navigation={ADMIN_OCC_NAVIGATION}
        roleLabel="Administrador / OCC"
        user={CURRENT_USER_MOCK}
        station={fallbackStation()}
        notificationsPath={`${ADMIN_OCC_BASE_PATH}/notifications`}
      />
      <DevPreviewPanel theme={theme} forceState={forceState} onToggleTheme={toggleTheme} onSetForceState={setForceState} />
    </>
  );
}
```

(Esto sustituye la versión de `AdminOccLayout.jsx` escrita en la Task 3, Paso 7 — es la misma idea, con el panel añadido.)

- [ ] **Paso 8: Wiring en `router.jsx`**

Descomentar/agregar en `frontend/web/src/app/router.jsx`:

```jsx
import DashboardRoute from '../features/dashboard/DashboardRoute';
```

y en los `children` de `ADMIN_OCC_BASE_PATH`:

```jsx
{ path: 'dashboard', element: <DashboardRoute /> },
```

(Si Task 3 ya dejó esta línea presente apuntando a un archivo que no existía, este paso solo confirma que ahora sí resuelve.)

- [ ] **Paso 9: Verificar**

```bash
cd frontend/web && npx vitest run src/features/dashboard
npm run dev
```

Navegar a `/admin-occ/dashboard`, confirmar KPIs, gráfico de estado de vuelos, panel FlyAware, y que el `DevPreviewPanel` permite forzar `loading`/`error`/estados vacíos correctamente. Alternar modo oscuro desde el Topbar y confirmar que todo el dashboard respeta `dark:`.

- [ ] **Paso 10: Commit**

```bash
git add frontend/web/src/features/dashboard frontend/web/src/features/admin-occ/AdminOccLayout.jsx frontend/web/src/app/router.jsx
git commit -m "feat: port del módulo Dashboard de Admin/OCC a /admin-occ/dashboard"
```

---

## Task 6: Port del módulo Planificación operativa

**Files:**
- Create: todo `frontend/web/src/features/planning/**` copiado de `Lw-front` (`PlanningPage.jsx`+test, `planningMappers.js`+test, `usePlanningData.js`+test, `usePlanningFilters.js`+test, `components/{AssignmentSummary,ConflictIndicator,EmptyPlanningState,FlightCard,FlightTimeline,PlanningDrawer,PlanningFilters,PlanningHeader,PlanningKPIs,PlanningSkeleton,ViewSwitcher}.jsx`+tests, `components/icons.jsx`+test)
- Create: `frontend/web/src/features/planning/PlanningRoute.jsx`
- Modify: cualquier componente que use `Drawer`/`Modal` locales si existieran equivalentes exactos en `src/components/Drawer.jsx`/`Modal.jsx` (verificar `PlanningDrawer.jsx` — si es un drawer genérico reimplementado, evaluar si conviene consolidar sobre `src/components/Drawer.jsx`; si tiene lógica específica de planificación embebida en el mismo archivo, dejarlo local, PASO 7 del pedido: no forzar consolidación que no corresponde funcionalmente)
- Modify: `frontend/web/src/app/router.jsx`

**Interfaces:**
- Consume (Task 4): `getPlanningSnapshot` (o el nombre real exportado por `planningService.js`).
- Consume (Task 3): `useAdminOccPreview()`.

- [ ] **Paso 1: Copiar el árbol del módulo**

```bash
mkdir -p frontend/web/src/features/planning/components
for f in PlanningPage PlanningPage.test planningMappers planningMappers.test usePlanningData usePlanningData.test usePlanningFilters usePlanningFilters.test; do
  git show "Lw-front:./src/features/planning/$f.jsx" > "frontend/web/src/features/planning/$f.jsx" 2>/dev/null || \
  git show "Lw-front:./src/features/planning/$f.js"  > "frontend/web/src/features/planning/$f.js"  2>/dev/null
done
for f in AssignmentSummary ConflictIndicator EmptyPlanningState FlightCard FlightTimeline PlanningDrawer PlanningFilters PlanningHeader PlanningKPIs PlanningSkeleton ViewSwitcher icons; do
  git show "Lw-front:./src/features/planning/components/$f.jsx" > "frontend/web/src/features/planning/components/$f.jsx"
  git show "Lw-front:./src/features/planning/components/$f.test.jsx" > "frontend/web/src/features/planning/components/$f.test.jsx"
done
```

- [ ] **Paso 2: Revisar `PlanningDrawer.jsx` para posible consolidación con `src/components/Drawer.jsx`**

Leer ambos archivos. Si `PlanningDrawer` es un wrapper delgado sobre un patrón de drawer genérico (overlay + panel deslizante + `useEscapeToClose`), migrar su base a `src/components/Drawer.jsx` + `src/hooks/useEscapeToClose.js` compartidos, conservando el contenido específico de planificación (KPIs, resumen de asignación) como children. Si en cambio tiene comportamiento de drag/resize u otra lógica no genérica, dejarlo tal cual — no forzar.

- [ ] **Paso 3: Crear `PlanningRoute.jsx`**

```jsx
import { useState } from 'react';
import PlanningPage from './PlanningPage';
import { usePlanningData } from './usePlanningData';
import { useAdminOccPreview } from '../admin-occ/AdminOccPreviewContext';

export default function PlanningRoute() {
  const [retryToken, setRetryToken] = useState(0);
  const planning = usePlanningData('PUJ', undefined, retryToken);
  const { forceState } = useAdminOccPreview();

  return (
    <PlanningPage
      status={planning.status}
      data={planning.data}
      error={planning.error}
      onRetry={() => setRetryToken(token => token + 1)}
      forceState={forceState}
    />
  );
}
```

(Confirmar la firma exacta de `usePlanningData` leyendo `frontend/web/src/features/planning/usePlanningData.js` ya copiado — el segundo argumento `undefined` reproduce el mismo valor que le pasaba el `AppShell` original de Admin/OCC; ajustar si la firma real difiere.)

- [ ] **Paso 4: Wiring en `router.jsx`**

```jsx
import PlanningRoute from '../features/planning/PlanningRoute';
// ...
{ path: 'planning', element: <PlanningRoute /> },
```

- [ ] **Paso 5: Verificar**

```bash
cd frontend/web && npx vitest run src/features/planning
npm run dev
```

Navegar a `/admin-occ/planning`, confirmar timeline de vuelos, drawer de asignación, filtros y KPIs.

- [ ] **Paso 6: Commit**

```bash
git add frontend/web/src/features/planning frontend/web/src/app/router.jsx
git commit -m "feat: port del módulo Planificación operativa de Admin/OCC"
```

---

## Task 7: Port del módulo Monitoreo de Vuelos (con maplibre-gl)

**Files:**
- Create: todo `frontend/web/src/features/flight-monitoring/**` copiado de `Lw-front` (lista completa vista en la inspección: `FlightMonitoringPage.jsx`+test, `flightMonitoringMappers.js`+test, `useFlightAlerts.js`+test, `useFlightMonitoringData.js`+test, `useFlightMonitoringFilters.js`+test, `useIsTabletBreakpoint.js`+test, y en `components/`: `AircraftMarker.js`+test, `AirportMarker.js`+test, `EmptyFlightState`, `FlightConnectionStatus`, `FlightDetailPopover`, `FlightFilterChips`, `FlightLegend`, `FlightListDrawer`, `FlightListItem`, `FlightListPanel`, `FlightMap`, `FlightMonitoringSkeleton`, `FlightSearch`, `FlightToast`, `FlightToolbar`, `icons.jsx`, todos con su `.test.jsx`)
- Create: `frontend/web/src/features/flight-monitoring/FlightMonitoringRoute.jsx`
- Modify: `frontend/web/vite.config.js` (confirmar que ya tiene `optimizeDeps.exclude: ['maplibre-gl']` desde Task 1, Paso 7 — si no, agregarlo)
- Modify: `frontend/web/src/app/router.jsx`

**Interfaces:**
- Consume (Task 4): servicio de `flightMonitoringService.js`.
- Consume (Task 3): `useAdminOccPreview()`, y el `focusFlightId` que hoy llega por navegación cruzada desde Notificaciones/Revisión (ver Paso 3).

- [ ] **Paso 1: Copiar el árbol del módulo**

```bash
mkdir -p frontend/web/src/features/flight-monitoring/components
for f in FlightMonitoringPage FlightMonitoringPage.test flightMonitoringMappers flightMonitoringMappers.test useFlightAlerts useFlightAlerts.test useFlightMonitoringData useFlightMonitoringData.test useFlightMonitoringFilters useFlightMonitoringFilters.test useIsTabletBreakpoint useIsTabletBreakpoint.test; do
  git show "Lw-front:./src/features/flight-monitoring/$f.jsx" > "frontend/web/src/features/flight-monitoring/$f.jsx" 2>/dev/null || \
  git show "Lw-front:./src/features/flight-monitoring/$f.js"  > "frontend/web/src/features/flight-monitoring/$f.js"  2>/dev/null
done
for f in AircraftMarker AirportMarker; do
  git show "Lw-front:./src/features/flight-monitoring/components/$f.js" > "frontend/web/src/features/flight-monitoring/components/$f.js"
  git show "Lw-front:./src/features/flight-monitoring/components/$f.test.js" > "frontend/web/src/features/flight-monitoring/components/$f.test.js"
done
for f in EmptyFlightState FlightConnectionStatus FlightDetailPopover FlightFilterChips FlightLegend FlightListDrawer FlightListItem FlightListPanel FlightMap FlightMonitoringSkeleton FlightSearch FlightToast FlightToolbar icons; do
  git show "Lw-front:./src/features/flight-monitoring/components/$f.jsx" > "frontend/web/src/features/flight-monitoring/components/$f.jsx"
  git show "Lw-front:./src/features/flight-monitoring/components/$f.test.jsx" > "frontend/web/src/features/flight-monitoring/components/$f.test.jsx"
done
```

- [ ] **Paso 2: Confirmar `maplibre-gl` en `package.json` (ya cubierto en Task 1) y reinstalar si es necesario**

```bash
cd frontend/web && npm install
```

- [ ] **Paso 3: Crear `FlightMonitoringRoute.jsx` con soporte de `focusFlightId` vía query param**

El `AppShell` original de Admin/OCC guardaba `focusResource` en estado local y lo pasaba a `FlightMonitoringPage` cuando la navegación venía de Notificaciones o Revisión (`handleNavigateToResource`). Con rutas reales, ese "recurso a enfocar" se expresa como query param en la URL en vez de estado en memoria — así es enlazable y sobrevive a un refresh:

```jsx
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import FlightMonitoringPage from './FlightMonitoringPage';
import { useFlightMonitoringData } from './useFlightMonitoringData';
import { useAdminOccPreview } from '../admin-occ/AdminOccPreviewContext';

export default function FlightMonitoringRoute() {
  const [retryToken, setRetryToken] = useState(0);
  const [searchParams] = useSearchParams();
  const { forceState } = useAdminOccPreview();
  const monitoring = useFlightMonitoringData('PUJ', retryToken, forceState === 'monitoringDisconnected');

  return (
    <FlightMonitoringPage
      status={monitoring.status}
      data={monitoring.data}
      error={monitoring.error}
      connection={monitoring.connection}
      lastUpdatedAt={monitoring.lastUpdatedAt}
      onRetry={() => setRetryToken(token => token + 1)}
      forceState={forceState}
      focusFlightId={searchParams.get('flightId') ?? undefined}
    />
  );
}
```

Nota: el prop `theme` que el `FlightMonitoringPage` original recibía del `AppShell` para pintar el mapa según modo claro/oscuro debe seguir llegando — importar `useTheme` del shell compartido (`../shell/useTheme`) dentro de esta misma `Route` y pasarlo como prop `theme={theme}`.

Los lugares donde Notificaciones/Revisión navegaban a este módulo (`handleNavigateToResource`) deben actualizarse en las Tasks 9 y 11 para usar `navigate(`/admin-occ/flight-monitoring?flightId=${resourceId}`)` en vez del callback centralizado que existía en el `AppShell` de Admin/OCC.

- [ ] **Paso 4: Wiring en `router.jsx`**

```jsx
import FlightMonitoringRoute from '../features/flight-monitoring/FlightMonitoringRoute';
// ...
{ path: 'flight-monitoring', element: <FlightMonitoringRoute /> },
```

- [ ] **Paso 5: Verificar**

```bash
cd frontend/web && npx vitest run src/features/flight-monitoring
npm run dev
```

Navegar a `/admin-occ/flight-monitoring`, confirmar que el mapa MapLibre carga tiles/marcadores (revisar consola del navegador por 404 del worker de maplibre-gl — si aparece, revisar que `vite.config.js` mantuvo el `optimizeDeps.exclude`), alternar modo oscuro, probar el drawer de lista de vuelos en viewport tablet.

- [ ] **Paso 6: Commit**

```bash
git add frontend/web/src/features/flight-monitoring frontend/web/vite.config.js frontend/web/src/app/router.jsx
git commit -m "feat: port del módulo Monitoreo de Vuelos de Admin/OCC (maplibre-gl)"
```

---

## Task 8: Port del módulo Mapa de Posiciones (con maplibre-gl)

**Files:**
- Create: todo `frontend/web/src/features/positions-map/**` copiado de `Lw-front` (`PositionsMapPage.jsx`+test, `positionsMapMappers.js`+test, `usePositionAlerts.js`+test, `usePositionsMapData.js`, `usePositionsMapFilters.js`+test, y en `components/`: `CombinedPositionBanner`, `EmptyPositionsState`, `MapControls`, `PositionDetailDrawer`, `PositionLegend`, `PositionListItem`, `PositionMap`, `PositionSearchBar`, `PositionSummary`, `PositionToast`, `PositionsListDrawer`, `PositionsMapSkeleton`, `PositionsSidePanel`, `PositionsToolbar`, `TerminalSelector`, `icons.jsx`, `positionMapLayers.js`, `positionMarkerIcons.js` — estos tres últimos sin test)
- Create: `frontend/web/src/features/positions-map/PositionsMapRoute.jsx`
- Modify: `frontend/web/src/app/router.jsx`

**Interfaces:**
- Consume (Task 4): servicio de `positionsMapService.js`.
- Consume (Task 5): navegación cruzada desde Dashboard (`onOpenPositionsMap`, ya resuelta en Task 5 Paso 6 como `navigate('/admin-occ/positions-map')`).
- Produce: mismo patrón `onNavigateToResource` que Monitoreo de Vuelos (Task 7 Paso 3) para saltar desde aquí hacia Monitoreo de Vuelos con un vuelo enfocado — usar el mismo mecanismo de query param.

- [ ] **Paso 1: Copiar el árbol del módulo**

```bash
mkdir -p frontend/web/src/features/positions-map/components
for f in PositionsMapPage PositionsMapPage.test positionsMapMappers positionsMapMappers.test usePositionAlerts usePositionAlerts.test usePositionsMapData usePositionsMapFilters usePositionsMapFilters.test; do
  git show "Lw-front:./src/features/positions-map/$f.jsx" > "frontend/web/src/features/positions-map/$f.jsx" 2>/dev/null || \
  git show "Lw-front:./src/features/positions-map/$f.js"  > "frontend/web/src/features/positions-map/$f.js"  2>/dev/null
done
for f in CombinedPositionBanner EmptyPositionsState MapControls PositionDetailDrawer PositionLegend PositionListItem PositionMap PositionSearchBar PositionSummary PositionToast PositionsListDrawer PositionsMapSkeleton PositionsSidePanel PositionsToolbar TerminalSelector icons; do
  git show "Lw-front:./src/features/positions-map/components/$f.jsx" > "frontend/web/src/features/positions-map/components/$f.jsx"
done
for f in positionMapLayers positionMarkerIcons; do
  git show "Lw-front:./src/features/positions-map/components/$f.js" > "frontend/web/src/features/positions-map/components/$f.js"
done
```

- [ ] **Paso 2: Crear `PositionsMapRoute.jsx`**

```jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PositionsMapPage from './PositionsMapPage';
import { usePositionsMapData } from './usePositionsMapData';
import { useAdminOccPreview } from '../admin-occ/AdminOccPreviewContext';
import { useTheme } from '../shell/useTheme';

export default function PositionsMapRoute() {
  const [retryToken, setRetryToken] = useState(0);
  const { forceState } = useAdminOccPreview();
  const { theme } = useTheme();
  const positionsMap = usePositionsMapData('PUJ', retryToken, forceState === 'positionsMapDisconnected');
  const navigate = useNavigate();

  return (
    <PositionsMapPage
      status={positionsMap.status}
      data={positionsMap.data}
      error={positionsMap.error}
      connection={positionsMap.connection}
      lastUpdatedAt={positionsMap.lastUpdatedAt}
      onRetry={() => setRetryToken(token => token + 1)}
      forceState={forceState}
      theme={theme}
      onNavigateToResource={(moduleId, resourceId) => {
        if (moduleId === 'flight-monitoring') {
          navigate(`/admin-occ/flight-monitoring?flightId=${resourceId}`);
        }
      }}
    />
  );
}
```

(Confirmar en `PositionsMapPage.jsx` copiado cuáles `moduleId` produce realmente `onNavigateToResource` — el bloque `if` de arriba debe cubrir exactamente esos casos, no inventar otros.)

- [ ] **Paso 3: Wiring en `router.jsx`**

```jsx
import PositionsMapRoute from '../features/positions-map/PositionsMapRoute';
// ...
{ path: 'positions-map', element: <PositionsMapRoute /> },
```

- [ ] **Paso 4: Verificar**

```bash
cd frontend/web && npx vitest run src/features/positions-map
npm run dev
```

Navegar a `/admin-occ/positions-map`, confirmar mapa, selector de terminal, drawer de detalle de posición, y que "Dashboard → Ver mapa de posiciones" (Task 5) llega aquí correctamente.

- [ ] **Paso 5: Commit**

```bash
git add frontend/web/src/features/positions-map frontend/web/src/app/router.jsx
git commit -m "feat: port del módulo Mapa de Posiciones de Admin/OCC (maplibre-gl)"
```

---

## Task 9: Port del módulo Revisión

**Files:**
- Create: todo `frontend/web/src/features/review/**` copiado de `Lw-front` (lista completa vista en la inspección: `ReviewPage.jsx`+test, `reviewMappers.js`+test, `useReviewData.js`+test, `useReviewFilters.js`+test, `useReviewSelection.js`+test, `useReviewToasts.js`+test, y ~25 componentes en `components/` con sus tests, más `components/icons.jsx`+test)
- Create: `frontend/web/src/features/review/ReviewRoute.jsx`
- Modify: `frontend/web/src/features/review/useReviewToasts.js` (evaluar consolidación con `src/hooks/useToast.js` compartido — mismo criterio que Paso 2 de Task 6: solo si es genuinamente el mismo patrón)
- Modify: `frontend/web/src/app/router.jsx`

**Interfaces:**
- Consume (Task 4): servicio de `reviewService.js` (`approveOperation`, `returnOperation`, `bulkApprove`, `bulkReturn` — confirmar nombres exactos leyendo el archivo copiado).
- Produce: mismo patrón de navegación cruzada hacia Monitoreo de Vuelos que Task 8 (vía `focusOperationId`/query param, si `ReviewPage` lo requiere — confirmar en el archivo copiado si usa `focusOperationId` como se veía en el `AppShell` original).

- [ ] **Paso 1: Copiar el árbol del módulo**

```bash
mkdir -p frontend/web/src/features/review/components
for f in ReviewPage ReviewPage.test reviewMappers reviewMappers.test useReviewData useReviewData.test useReviewFilters useReviewFilters.test useReviewSelection useReviewSelection.test useReviewToasts useReviewToasts.test; do
  git show "Lw-front:./src/features/review/$f.jsx" > "frontend/web/src/features/review/$f.jsx" 2>/dev/null || \
  git show "Lw-front:./src/features/review/$f.js"  > "frontend/web/src/features/review/$f.js"  2>/dev/null
done
for f in ApprovalConfirmation EquipmentList EvidenceList FlightInfoSection FlightTimeline IncidentList ObservationList PlanningVsExecution ReconciliationDiff ReturnCorrectionModal ReviewActionBar ReviewDetailDrawer ReviewEmptyState ReviewFilters ReviewHeader ReviewHistoryLog ReviewKPIs ReviewPriorityBadge ReviewQueueRow ReviewQueueTable ReviewSection ReviewSelectionBar ReviewSkeleton ReviewStatusBadge ReviewTabs ReviewToast ServiceChecklist SignatureStatus icons; do
  git show "Lw-front:./src/features/review/components/$f.jsx" > "frontend/web/src/features/review/components/$f.jsx"
done
for f in ApprovalConfirmation EquipmentList EvidenceList FlightInfoSection FlightTimeline IncidentList ObservationList PlanningVsExecution ReconciliationDiff ReturnCorrectionModal ReviewActionBar ReviewDetailDrawer ReviewEmptyState ReviewFilters ReviewHeader ReviewHistoryLog ReviewKPIs ReviewPriorityBadge ReviewQueueRow ReviewQueueTable ReviewSelectionBar ReviewSkeleton ReviewStatusBadge ReviewTabs ServiceChecklist SignatureStatus icons; do
  git show "Lw-front:./src/features/review/components/$f.test.jsx" > "frontend/web/src/features/review/components/$f.test.jsx"
done
```

(`ReviewSection.jsx` y `ReviewToast.jsx` no tenían `.test.jsx` en la lista de la inspección — no forzar su creación.)

- [ ] **Paso 2: Crear `ReviewRoute.jsx`**

```jsx
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ReviewPage from './ReviewPage';
import { useReviewData } from './useReviewData';
import { useAdminOccPreview } from '../admin-occ/AdminOccPreviewContext';

export default function ReviewRoute() {
  const [retryToken, setRetryToken] = useState(0);
  const [searchParams] = useSearchParams();
  const { forceState } = useAdminOccPreview();
  const review = useReviewData('PUJ', retryToken);

  return (
    <ReviewPage
      status={review.status}
      data={review.data}
      error={review.error}
      onRetry={() => setRetryToken(token => token + 1)}
      onApprove={review.approveOperation}
      onReturn={review.returnOperation}
      onBulkApprove={review.bulkApprove}
      onBulkReturn={review.bulkReturn}
      forceState={forceState}
      focusOperationId={searchParams.get('operationId') ?? undefined}
    />
  );
}
```

(Confirmar contra `useReviewData.js` copiado que los nombres `approveOperation`/`returnOperation`/`bulkApprove`/`bulkReturn` existen tal cual — son los que usaba el `AppShell` original de Admin/OCC.)

- [ ] **Paso 3: Wiring en `router.jsx`**

```jsx
import ReviewRoute from '../features/review/ReviewRoute';
// ...
{ path: 'review', element: <ReviewRoute /> },
```

- [ ] **Paso 4: Verificar**

```bash
cd frontend/web && npx vitest run src/features/review
npm run dev
```

Navegar a `/admin-occ/review`, confirmar tabla de cola de revisión, drawer de detalle, flujo de aprobación/devolución, barra de selección múltiple.

- [ ] **Paso 5: Commit**

```bash
git add frontend/web/src/features/review frontend/web/src/app/router.jsx
git commit -m "feat: port del módulo Revisión de Admin/OCC"
```

---

## Task 10: Port del módulo Reportes

**Files:**
- Create: todo `frontend/web/src/features/reports/**` copiado de `Lw-front` (`ReportsPage.jsx`+test, `reportsMappers.js`+test, `useReportFilters.js`+test, `useReportsData.js`+test, y en `components/`: `BarChart`, `DailyClosureTable`, `DateRangePicker`, `ExpandableReportRow`, `ExportButton`, `GroundTimeTable`, `OperationalOverviewCharts`, `ReconciliationSummaryTable`, `ReportDetailPanel`, `ReportEmptyState`, `ReportFilterBar`, `ReportKpiGrid`, `ReportSkeleton`, `ReportTable`, `ReportTabs`, `ReportsHeader`, `icons.jsx` — algunos sin test según la inspección: `ExpandableReportRow`, `ReportEmptyState`, `ReportSkeleton`, `ReportTabs`, `ReportsHeader`, `icons.jsx`, no forzar su creación)
- Create: `frontend/web/src/features/reports/ReportsRoute.jsx`
- Modify: `frontend/web/src/app/router.jsx`

**Interfaces:**
- Consume (Task 4): servicio de `reportsService.js`.

- [ ] **Paso 1: Copiar el árbol del módulo**

```bash
mkdir -p frontend/web/src/features/reports/components
for f in ReportsPage ReportsPage.test reportsMappers reportsMappers.test useReportFilters useReportFilters.test useReportsData useReportsData.test; do
  git show "Lw-front:./src/features/reports/$f.jsx" > "frontend/web/src/features/reports/$f.jsx" 2>/dev/null || \
  git show "Lw-front:./src/features/reports/$f.js"  > "frontend/web/src/features/reports/$f.js"  2>/dev/null
done
for f in BarChart DailyClosureTable DateRangePicker ExpandableReportRow ExportButton GroundTimeTable OperationalOverviewCharts ReconciliationSummaryTable ReportDetailPanel ReportEmptyState ReportFilterBar ReportKpiGrid ReportSkeleton ReportTable ReportTabs ReportsHeader icons; do
  git show "Lw-front:./src/features/reports/components/$f.jsx" > "frontend/web/src/features/reports/components/$f.jsx"
done
for f in BarChart DailyClosureTable DateRangePicker ExportButton GroundTimeTable OperationalOverviewCharts ReconciliationSummaryTable ReportDetailPanel ReportFilterBar ReportKpiGrid ReportTable; do
  git show "Lw-front:./src/features/reports/components/$f.test.jsx" > "frontend/web/src/features/reports/components/$f.test.jsx"
done
```

- [ ] **Paso 2: Revisar posible consolidación de `BarChart.jsx` con `src/components/CategoryDonutChart.jsx`/`HorizontalBarList.jsx` de gestion-humana**

Son visualizaciones distintas (barra vs. dona vs. lista horizontal) — probablemente NO son el mismo componente. Confirmar leyendo ambos; si no coinciden en propósito, dejar `BarChart.jsx` local sin forzar nada (PASO 7 del pedido).

- [ ] **Paso 3: Crear `ReportsRoute.jsx`**

`ReportsPage` en el `AppShell` original de Admin/OCC solo recibía `forceState` (maneja sus propios datos internamente vía `useReportsData`, a diferencia de los demás módulos — confirmar esto leyendo `ReportsPage.jsx` copiado antes de escribir la Route):

```jsx
import ReportsPage from './ReportsPage';
import { useAdminOccPreview } from '../admin-occ/AdminOccPreviewContext';

export default function ReportsRoute() {
  const { forceState } = useAdminOccPreview();
  return <ReportsPage forceState={forceState} />;
}
```

Si al leer `ReportsPage.jsx` resulta que SÍ espera `status`/`data`/`error`/`onRetry` como los demás módulos, ajustar `ReportsRoute.jsx` al mismo patrón que `DashboardRoute.jsx` (Task 5) usando `useReportsData`.

- [ ] **Paso 4: Wiring en `router.jsx`**

```jsx
import ReportsRoute from '../features/reports/ReportsRoute';
// ...
{ path: 'reports', element: <ReportsRoute /> },
```

- [ ] **Paso 5: Verificar**

```bash
cd frontend/web && npx vitest run src/features/reports
npm run dev
```

- [ ] **Paso 6: Commit**

```bash
git add frontend/web/src/features/reports frontend/web/src/app/router.jsx
git commit -m "feat: port del módulo Reportes de Admin/OCC"
```

---

## Task 11: Port del módulo Notificaciones

**Files:**
- Create: todo `frontend/web/src/features/notifications/**` copiado de `Lw-front` (`NotificationsPage.jsx`+test, `notificationsMappers.js`+test, `useNotificationFilters.js`+test, `useNotificationsData.js`+test, y en `components/`: `NotificationBulkActionsBar`, `NotificationCard`, `NotificationDetailDrawer`, `NotificationEmptyState`, `NotificationFeed`, `NotificationFilterBar`, `NotificationSettingsDrawer`, `NotificationSeverityBadge`, `NotificationSkeleton`, `NotificationsHeader`, `icons.jsx`, todos con test)
- Delete (consolidado en shared): `frontend/web/src/features/notifications/useEscapeToClose.js` (sin test según inspección)
- Create: `frontend/web/src/features/notifications/NotificationsRoute.jsx`
- Modify: cualquier componente que importe `./useEscapeToClose` local → `../../hooks/useEscapeToClose`
- Modify: `frontend/web/src/app/router.jsx`

**Interfaces:**
- Consume (Task 4): servicio de `notificationsService.js`.
- Produce: navegación cruzada hacia Monitoreo de Vuelos / Revisión (mismo patrón de query param que Tasks 7–9).

- [ ] **Paso 1: Copiar el árbol del módulo**

```bash
mkdir -p frontend/web/src/features/notifications/components
for f in NotificationsPage NotificationsPage.test notificationsMappers notificationsMappers.test useNotificationFilters useNotificationFilters.test useNotificationsData useNotificationsData.test; do
  git show "Lw-front:./src/features/notifications/$f.jsx" > "frontend/web/src/features/notifications/$f.jsx" 2>/dev/null || \
  git show "Lw-front:./src/features/notifications/$f.js"  > "frontend/web/src/features/notifications/$f.js"  2>/dev/null
done
for f in NotificationBulkActionsBar NotificationCard NotificationDetailDrawer NotificationEmptyState NotificationFeed NotificationFilterBar NotificationSettingsDrawer NotificationSeverityBadge NotificationSkeleton NotificationsHeader icons; do
  git show "Lw-front:./src/features/notifications/components/$f.jsx" > "frontend/web/src/features/notifications/components/$f.jsx"
  git show "Lw-front:./src/features/notifications/components/$f.test.jsx" > "frontend/web/src/features/notifications/components/$f.test.jsx"
done
```

- [ ] **Paso 2: Redirigir `useEscapeToClose` al hook compartido**

```bash
git grep -rn "useEscapeToClose" frontend/web/src/features/notifications
```

En cada resultado que importe `./useEscapeToClose` (probablemente `NotificationDetailDrawer.jsx`, `NotificationSettingsDrawer.jsx`), cambiar a:

```js
import { useEscapeToClose } from '../../../hooks/useEscapeToClose';
```

Luego:

```bash
rm frontend/web/src/features/notifications/useEscapeToClose.js
```

- [ ] **Paso 3: Crear `NotificationsRoute.jsx`**

```jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import NotificationsPage from './NotificationsPage';
import { useNotificationsData } from './useNotificationsData';
import { useAdminOccPreview } from '../admin-occ/AdminOccPreviewContext';

export default function NotificationsRoute() {
  const [retryToken, setRetryToken] = useState(0);
  const { forceState } = useAdminOccPreview();
  const notifications = useNotificationsData('PUJ', retryToken);
  const navigate = useNavigate();

  return (
    <NotificationsPage
      status={notifications.status}
      data={notifications.data}
      error={notifications.error}
      onRetry={() => setRetryToken(token => token + 1)}
      onMarkAsRead={notifications.markAsRead}
      onMarkAsUnread={notifications.markAsUnread}
      onMarkManyAsRead={notifications.markManyAsRead}
      onMarkManyAsUnread={notifications.markManyAsUnread}
      onMarkAllAsRead={notifications.markAllAsRead}
      onNavigateToResource={(moduleId, resourceId) => {
        if (moduleId === 'flight-monitoring') navigate(`/admin-occ/flight-monitoring?flightId=${resourceId}`);
        if (moduleId === 'approvals') navigate(`/admin-occ/review?operationId=${resourceId}`);
      }}
      forceState={forceState}
    />
  );
}
```

(Confirmar en `NotificationsPage.jsx` copiado que `notifications.markAsRead` etc. son los nombres reales expuestos por `useNotificationsData` — ya vistos en el `AppShell` original de Admin/OCC, deberían coincidir.)

- [ ] **Paso 4: Badge de notificaciones no leídas en el Sidebar**

El `AppShell` original de Admin/OCC calculaba `unreadNotificationsCount` centralizadamente y lo pasaba como `badgeCounts` al `Sidebar`. En el modelo de `feat/gestion-humana`, el badge vive en la propia definición de `navigation.js` (ver `HUMAN_RESOURCES_NAVIGATION`, que resuelve el badge de notificaciones a partir de un mock estático). Para Admin/OCC, el conteo real depende de datos que solo se cargan cuando se visita `/admin-occ/notifications` — esto es una limitación aceptable por ahora (el badge no se actualiza en vivo desde otras rutas); dejar el ítem de notificaciones en `admin-occ/navigation.js` (Task 3) sin badge dinámico, y anotar esto como pendiente conocido en el resumen final en vez de construir un mecanismo de estado global solo para esto (evitar "refactorización masiva innecesaria").

- [ ] **Paso 5: Wiring en `router.jsx`**

```jsx
import NotificationsRoute from '../features/notifications/NotificationsRoute';
// ...
{ path: 'notifications', element: <NotificationsRoute /> },
```

- [ ] **Paso 6: Verificar**

```bash
cd frontend/web && npx vitest run src/features/notifications
npm run dev
```

- [ ] **Paso 7: Commit**

```bash
git add frontend/web/src/features/notifications frontend/web/src/app/router.jsx
git commit -m "feat: port del módulo Notificaciones de Admin/OCC"
```

---

## Task 12: Port del módulo Chat interno

**Files:**
- Create: todo `frontend/web/src/features/chat/**` copiado de `Lw-front` (`ChatPage.jsx`+test, `chatMappers.js`+test, `useChatData.js`+test, `useChatFilters.js`+test, y en `components/`: `AttachmentPreview`, `ChatEmptyState`, `ChatHeader`, `ChatSkeleton`, `ConversationFilters`, `ConversationList`, `ConversationListItem`, `ConversationSearch`, `ConversationStatusBadge`, `MessageComposer`, `MessageItem`, `MessageList`, `NewConversationDrawer`, `OperationContext`, `SystemEvent`, `icons.jsx`, todos con test)
- Create: `frontend/web/src/features/chat/ChatRoute.jsx`
- Modify: `frontend/web/src/app/router.jsx`

**Interfaces:**
- Consume (Task 4): servicio de `chatService.js`.

- [ ] **Paso 1: Copiar el árbol del módulo**

```bash
mkdir -p frontend/web/src/features/chat/components
for f in ChatPage ChatPage.test chatMappers chatMappers.test useChatData useChatData.test useChatFilters useChatFilters.test; do
  git show "Lw-front:./src/features/chat/$f.jsx" > "frontend/web/src/features/chat/$f.jsx" 2>/dev/null || \
  git show "Lw-front:./src/features/chat/$f.js"  > "frontend/web/src/features/chat/$f.js"  2>/dev/null
done
for f in AttachmentPreview ChatEmptyState ChatHeader ChatSkeleton ConversationFilters ConversationList ConversationListItem ConversationSearch ConversationStatusBadge MessageComposer MessageItem MessageList NewConversationDrawer OperationContext SystemEvent icons; do
  git show "Lw-front:./src/features/chat/components/$f.jsx" > "frontend/web/src/features/chat/components/$f.jsx"
  git show "Lw-front:./src/features/chat/components/$f.test.jsx" > "frontend/web/src/features/chat/components/$f.test.jsx"
done
```

- [ ] **Paso 2: Crear `ChatRoute.jsx`**

```jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ChatPage from './ChatPage';
import { useChatData } from './useChatData';
import { useAdminOccPreview } from '../admin-occ/AdminOccPreviewContext';

export default function ChatRoute() {
  const [retryToken, setRetryToken] = useState(0);
  const { forceState } = useAdminOccPreview();
  const chat = useChatData('PUJ', retryToken, forceState === 'chatDisconnected');
  const navigate = useNavigate();

  return (
    <ChatPage
      status={chat.status}
      data={chat.data}
      error={chat.error}
      connection={chat.connection}
      onRetry={() => setRetryToken(token => token + 1)}
      onSendMessage={chat.sendMessage}
      onMarkAsRead={chat.markAsRead}
      onCloseConversation={chat.closeConversation}
      onCreateConversation={chat.createConversation}
      onNavigateToResource={(moduleId, resourceId) => {
        if (moduleId === 'flight-monitoring') navigate(`/admin-occ/flight-monitoring?flightId=${resourceId}`);
      }}
      forceState={forceState}
    />
  );
}
```

- [ ] **Paso 3: Wiring en `router.jsx`**

```jsx
import ChatRoute from '../features/chat/ChatRoute';
// ...
{ path: 'chat', element: <ChatRoute /> },
```

- [ ] **Paso 4: Verificar**

```bash
cd frontend/web && npx vitest run src/features/chat
npm run dev
```

- [ ] **Paso 5: Commit**

```bash
git add frontend/web/src/features/chat frontend/web/src/app/router.jsx
git commit -m "feat: port del módulo Chat interno de Admin/OCC"
```

---

## Task 13: Limpieza final y verificación integral

**Files:**
- Delete: `frontend/web/dashboard.html` si quedó copiado en algún paso anterior (no debería, no está en la lista de Task 1–12, pero confirmar que no existe)
- Verify only (sin cambios de archivo): todo el árbol

- [ ] **Paso 1: Confirmar que no quedó ningún resto del entrypoint duplicado de Admin/OCC**

```bash
test -f frontend/web/dashboard.html && echo "BORRAR: sigue existiendo dashboard.html" || echo "OK: no existe"
git grep -rn "dashboard-main" frontend/web/src frontend/web/*.html frontend/web/*.js 2>/dev/null
```

Si aparece algo, es un residuo de la copia de `Lw-front` que no debía llegar (no estaba en ninguna lista de archivos de las Tasks 1–12) — eliminarlo.

- [ ] **Paso 2: Instalar dependencias limpias y correr toda la suite**

```bash
cd frontend/web
npm install
npx vitest run
```

Todos los tests (los ya existentes de Gestión Humana + los recién portados de Admin/OCC) deben pasar. Cualquier falla debe investigarse — no se marca esta tarea como completa con tests en rojo.

- [ ] **Paso 3: Build de producción**

```bash
npm run build
```

Debe completar sin errores. Revisar el output por advertencias de imports no resueltos o dependencias faltantes.

- [ ] **Paso 4: Smoke test manual con el servidor de desarrollo**

```bash
npm run dev
```

Checklist manual (marcar cada uno):
- [ ] `/` carga `LoginPage` con su diseño intacto.
- [ ] Enviar el formulario navega a `/select-role`.
- [ ] "Gestión Humana" navega a `/human-resources/dashboard`; Sidebar muestra solo los ítems de Gestión Humana (Dashboard, Usuarios, Habilitaciones, Carnets, Horarios, Reportes, Auditoría, Notificaciones).
- [ ] "Administrador / OCC" navega a `/admin-occ/dashboard`; Sidebar muestra solo los ítems de Admin/OCC (Dashboard, Planificación, Monitoreo, Mapa de posiciones, Revisión, Reportes, Notificaciones, Chat) — confirmar que NO aparecen ítems de Gestión Humana ni viceversa.
- [ ] Cada una de las 8 rutas de `/admin-occ/*` carga sin error de consola.
- [ ] Cada una de las rutas ya existentes de `/human-resources/*` sigue funcionando igual que antes del merge.
- [ ] Alternar modo oscuro desde el Topbar en ambos entornos — persiste correctamente y no hay contraste roto en ningún módulo portado.
- [ ] `/contratos`, `/finanzas`, `/agente`, `/aerolinea` cargan el placeholder sin crashear.
- [ ] No hay dos Sidebars ni dos Topbars montados simultáneamente en ninguna vista.

- [ ] **Paso 5: Revisión de git antes de terminar**

```bash
git log --oneline main..HEAD
git status
git diff feat/gestion-humana@{1} --stat   # resumen de todo lo cambiado en esta integración, comparado con el estado antes del merge
```

No hacer push. Reportar al usuario el resumen pedido (rama final, cambios integrados, cambios conservados, conflictos y su resolución, componentes compartidos, routing por rol, comandos de validación y resultado, pendientes).

- [ ] **Paso 6: Pendientes conocidos a reportar (no resolver en este plan salvo pedido explícito)**

- El badge de notificaciones no leídas en el Sidebar de Admin/OCC no se actualiza en vivo desde otras rutas (Task 11, Paso 4).
- `EnvironmentSelectorPage`/`/select-role` es un puente temporal hasta que exista login real con rol en la respuesta del backend (Task 3).
- Contratos, Finanzas, Agente y Cliente/Aerolínea solo tienen la ruta reservada con placeholder — sin feature folder, sin navegación propia, sin datos (ya así lo pidió el usuario: "no necesariamente todos los módulos estarán construidos").
- Cualquier `PlanningDrawer`/`useReviewToasts` que en las Tasks 6/9 se decidió NO consolidar con el equivalente compartido, con la razón puntual de por qué no correspondía.
