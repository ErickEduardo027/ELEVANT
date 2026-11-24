# ADR-0044: Sistema visual NOC del OCC: «cabina oscura», solo oscuro, un juego de tokens y puente heredado

## Estado

Accepted — 2026-11-12.

## Contexto

El plan «OCC a nivel NOC», aprobado el 12 de noviembre de 2026, lleva el Centro de Operaciones a la estética de un centro de monitoreo: oscura, sobria y centrada en los mapas. Avanza en tres carriles con archivos separados (API, mapas y estilo visual); los carriles de API y de mapas registran sus decisiones en sus propios ADR. El carril visual son seis PR, de U1 a U6. Este ADR recoge el sistema visual que fija U1 «Fundaciones visuales» y las reglas que seguirán U2 a U6. El código de U1 llegó en tres pasos: tokens y vocabulario (`9a4360fa`), solo oscuro (`91cc9675`) y el puente heredado (`aca575ff`). No reestructura el JSX de ninguna pantalla.

Antes de U1 (`3c93f12c`), en `frontend/private-web`:
- **Tres sistemas de color.**
  - Los tokens `occ-*` de `src/styles/occ.css`, con un bloque claro y otro oscuro, pintaban el marco, la consola del dashboard y algunos mapas.
  - Las demás pantallas usaban las clases heredadas de `tailwind.config.js`, con estilo «cristal»: `bg-white/70`, `dark:bg-surface-dark-card`, `text-text-secondary-*`, desenfoque y sombras. Al cerrar U1 siguen en 106 de los 290 archivos montados bajo `/admin-occ`, con 146 clases de color distintas y unos 2 200 usos. Algunas no llegaban a 3:1 sobre la tarjeta oscura, como `text-accent-600`.
  - Una tercera familia, `--occ-ui-soft`, `-line`, `-glass`, `-text`, `-solid` y `-muted`, la leían `ChatWorkspace.module.css` y `PresencePeople.module.css` (27 usos), pero nadie la definía desde la reversión `d9418b29`: el chat no tenía fondos ni bordes.
- **Tema claro al arrancar, con parpadeo.** `ThemeProvider` pintaba primero en claro y aplicaba después de montar el tema guardado o la preferencia del sistema. La barra del OCC tenía un botón de tema y el mapa de Planificación se dibujaba siempre en claro.
- **La lección del rediseño anterior.** El PR #156 (cabecera horizontal, «cristal azulado», sin los mapas de Monitoreo y de Posiciones) se mergeó el 2 de noviembre de 2026 y se revirtió al día siguiente (`d9418b29`, PR #157), que devolvió el riel `OccSidebar`, la barra `OccTopbar` y los mapas. Por eso se conservan el riel, la barra superior, los 14 módulos con sus nombres y todos los mapas; nada de cristal ni desenfoque; y se entrega en pasos pequeños y reversibles.

Decisiones de Erick del 12 de noviembre de 2026:
- **16. El OCC queda solo en oscuro.** Desaparece el botón de cambio de tema dentro del OCC; los demás departamentos no cambian. El diseño y la revisión visual se concentran en un solo tema.
- **17. Color «cabina oscura», con su leyenda.** Lo normal no lleva color. Solo hay tres señales (cian = elegido o accionable, ámbar = atención, rojo = urgente), siempre con forma y texto. Cada mapa y cada tablero lleva su leyenda.
- **18. Tono base minimalista y moderno.** Erick dejó abierta la elección; se eligió una pizarra neutra, un gris apenas azulado: ni negro ni azul marino.

## Decisión

**1. «Cabina oscura».** Cuando la operación está normal, nada se enciende: si la pantalla está tranquila, la operación está tranquila.
- Los estados normales no llevan tono. Cian (`--occ-accent`) marca lo elegido, lo accionable y el foco. Ámbar (`--occ-warn`), con un triángulo con «!», pide atención. Rojo (`--occ-danger`), con un octágono con «!», es urgente. Un aviso simple es un rombo sin color.
- Sin verde, sin naranja fuera del logo y sin violeta. Nada depende solo del color ni del cursor: cada estado lleva forma y palabra.
- La acción principal es una «tecla» clara (`--occ-primary`, con la tinta `--occ-on-primary`). El cian queda para el texto accionable, la selección y el foco.
- Prioridad de las alertas: «Urgente», toda incidencia; «Atención», desviación, vuelo cancelado o desviado por el proveedor, agente liberado, operación sin agente elegible, documento o contrato no vigente; el resto, «Aviso». La aplica la cola de alertas, que llega con U2 y U3.
- *Por qué:* es la regla de las cabinas y las salas de control (el color se reserva para lo anormal) y lo contrario del cristal revertido. Un verde legible sobre fondo oscuro se confunde con el rojo o el ámbar con protanopia y deuteranopia, y un violeta para «demo» queda demasiado cerca del cian; por eso la procedencia va por textura y palabra (sección 6). `--occ-ok` queda como alias de `--occ-text`: con un solo valor se podría volver al verde.
- *Descartado:* verde para «libre» o «conectado», violeta para «demo», naranja de marca para «en operación».

**2. Solo oscuro.**
- `src/features/shell/occTheme.js` exporta `OCC_PATH_PREFIX`, `isOccPath(pathname)` y `occThemeBootScript()`. `isOccPath` es verdadero para `/admin-occ` y sus subrutas; `/admin-occupancy` no es del OCC. El módulo no usa React porque lo importa el layout de servidor, y un módulo que crea un contexto no puede importarse desde un Server Component.
- `app/layout.jsx` lee el nonce de la petición (la cabecera `x-nonce`, que pone `proxy.js`) y escribe en `<head>` el script de arranque con ese nonce.
  - El script añade la clase `dark` a `<html>` solo en rutas del OCC, antes del primer pintado y de la hidratación. Solo lee la ruta: no lee almacenamiento ni toca nada más.
  - `<html>` lleva `suppressHydrationWarning`, porque el script cambia su lista de clases antes de hidratar.
  - La CSP no cambia (`script-src 'self' 'nonce-…' 'strict-dynamic'`). Sin nonce en la petición, el script sale sin el atributo y la política lo bloquea.
- `ThemeProvider` (`src/features/shell/useTheme.jsx`) lee la ruta con `usePathname()`.
  - Bajo `/admin-occ` el tema es `dark`, `toggleTheme` no hace nada y `elevant-theme` no se escribe.
  - La clase se aplica en `useLayoutEffect`, antes del pintado, con la ruta como dependencia. Los marcos de Contratos, Finanzas y Superadministración quitan la clase por su cuenta: al entrar al OCC vuelve aunque el tema no haya cambiado. También vuelve tras el remontaje de Strict Mode.
  - Fuera del OCC nada cambia: manda el tema guardado o la preferencia del sistema, y al salir del OCC vuelve el tema de la cuenta.
- `OccTopbar` ya no tiene botón de tema ni sus dos mensajes, y el panel de vista previa de desarrollo del OCC (`DevPreviewPanel`) ya no tiene el botón «Tema». El mapa de Planificación pasa de `theme="light"` a `theme="dark"`.
- *Descartado:*
  - un tema claro del OCC con su propia clave `elevant-theme-occ`, que el diseño proponía antes de la decisión 16;
  - una cookie leída por el layout raíz, que no conoce la ruta;
  - el oscuro para toda la web interna: queda fuera de la decisión 16, y otros marcos fuerzan el claro.

**3. Un solo juego de tokens.** `src/styles/occ.css` define los valores una sola vez sobre `[data-department='occ']`, sin bloque claro ni dependencia de la clase `dark`, con `color-scheme: dark`. `ShellFrame` pone ese atributo cuando `AdminOccLayout` pasa `department: 'occ'`; ningún otro departamento lo recibe.

| Token | Valor | Uso |
|---|---|---|
| `--occ-nav` | `#0F161A` | riel («Hangar») |
| `--occ-canvas` | `#161E22` | fondo («Plataforma») |
| `--occ-panel` | `#20282D` | paneles («Asfalto») |
| `--occ-panel-raised` | `#2A3439` | encabezados y fila elegida («Losa») |
| `--occ-panel-float` | `rgb(32 40 45 / 0.94)` | paneles flotantes, casi opacos y sin desenfoque |
| `--occ-field` | `#161E22` | fondo de los campos |
| `--occ-arriving-fill` | `rgb(42 52 57 / 0.4)` | relleno de una posición «Llegando»: la losa al 40 % |
| `--occ-line` | `#394348` | juntas |
| `--occ-line-strong` | `#768289` | borde de todo control |
| `--occ-text` | `#E8EEF1` | texto y tecla principal («Pintura blanca») |
| `--occ-muted` | `#BCC8CE` | texto secundario |
| `--occ-faint` | `#95A2A9` | marcadores de posición y texto deshabilitado |
| `--occ-accent` | `#6FD4F5` | lo elegido, lo accionable y el foco («Cian de cabina») |
| `--occ-accent-soft` | `#2D444D` | fondo de lo elegido |
| `--occ-warn`, `--occ-warn-fill` | `#FDC14F` | atención |
| `--occ-warn-soft` | `#434032` | fondo de atención |
| `--occ-danger`, `--occ-danger-fill` | `#F5746D` | urgente |
| `--occ-danger-soft` | `#423437` | fondo de urgente |
| `--occ-primary`, `--occ-primary-hover` | `#E8EEF1`, `#FFFFFF` | tecla principal |
| `--occ-on-primary`, `--occ-on-accent`, `--occ-on-warn`, `--occ-on-danger` | `#0F161A` | tinta sobre un relleno |
| `--occ-scrim` | `rgb(15 22 26 / 0.72)` | velo detrás de cajones y diálogos |
| `--occ-nav-line`, `--occ-nav-active` | `#252C30` | juntas y elemento activo del riel |
| `--occ-nav-hover` | `#1A2227` | elemento del riel bajo el cursor |
| `--occ-nav-text`, `--occ-nav-muted`, `--occ-nav-accent` | `#C9D3D8`, `#95A2A9`, `#6FD4F5` | texto, texto secundario y foco del riel |
| `--occ-radius-plate`, `-control`, `-panel`, `-overlay` | 2, 4, 6 y 8 px | radio por papel |

- **Alias.**
  - `--occ-ok` es `--occ-text`.
  - `--occ-panel-muted` es `--occ-panel-raised`, hasta que ninguna clase lo use.
  - Los seis nombres del chat reparan sus hojas sin tocarlas: `--occ-ui-soft` (`--occ-panel-raised`), `--occ-ui-line` (`--occ-line`), `--occ-ui-glass` (`--occ-field`), `--occ-ui-text` (`--occ-text`), `--occ-ui-solid` (`--occ-panel`) y `--occ-ui-muted` (`--occ-muted`).
  - `--occ-signal` se retira junto con su llave de Tailwind.
- **Tailwind.** No todos los tokens tienen clase. `tailwind.config.js` expone en `colors.occ`, cada uno como `'<nombre>': 'var(--occ-<nombre>)'`, solo estos colores: `canvas`, `panel`, `panel-raised`, `panel-float`, `panel-muted`, `line`, `line-strong`, `text`, `muted`, `faint`, `accent`, `accent-soft`, `ok`, `warn`, `warn-soft`, `danger`, `danger-soft` y los siete del riel (`nav`, `nav-line`, `nav-text`, `nav-muted`, `nav-hover`, `nav-active` y `nav-accent`). De ellos, U1 suma `panel-raised`, `panel-float`, `faint`, `warn-soft` y `danger-soft`.
  - `--occ-field`, `--occ-arriving-fill`, `--occ-primary`, `--occ-primary-hover`, los cuatro `--occ-on-*`, `--occ-warn-fill`, `--occ-danger-fill` y `--occ-scrim` solo existen como variables CSS. Tailwind no genera la clase de un color sin llave: `bg-occ-primary` no pintaría nada. El PR que necesite una de esas clases añade su llave a `colors.occ`; si no, falla una guarda (sección 4). Los radios `--occ-radius-*` tampoco tienen clase.
  - **Nunca se usa un modificador de opacidad sobre una clase `occ-*`**: con un color `var()`, Tailwind no genera la clase. `bg-occ-panel/90` no pintaba nada; para los fondos tenues existen los tokens `-soft`, y para el relleno de «Llegando», `--occ-arriving-fill`.
- **Para JavaScript.** `src/features/occ-ui/occPalette.js` exporta `OCC_PALETTE` (token → valor, solo los colores) y `occColor(token)`. Es para quien no lee variables CSS: la pintura de MapLibre, los iconos de canvas y el SVG dibujado en código. Una prueba de paridad lo compara con `occ.css`, y un nombre desconocido lanza un error en lugar de pintar `undefined`. Los mapas tomarán de ahí los colores de estado y guardarán en su propio módulo solo los del mapa base.
- **Contraste (WCAG 2), sobre el panel y sobre la losa:**
  - texto, 12,8:1 y 10,9:1; secundario, 8,8:1 y 7,5:1; tenue, 5,7:1 y 4,9:1;
  - cian, 8,9:1 y 7,5:1; ámbar, 9,2:1 y 7,8:1; rojo, 5,4:1 y 4,6:1, el mínimo de la paleta;
  - borde de control, 3,8:1 y 3,2:1;
  - la tinta sobre los rellenos va de 6,6:1 (rojo) a 15,6:1 (tecla).
  - El rojo sobre su propio fondo tenue queda en 4,3:1: sobre ese fondo el texto va en `--occ-text`, y el color queda en el fondo y el borde.

**4. El puente heredado.** `src/styles/occ-legacy-bridge.css` es una hoja generada y versionada que repinta con los tokens oscuros las clases heredadas de las pantallas montadas bajo `/admin-occ`. `app/layout.jsx` la importa justo después de `occ.css`. No cambia ningún JSX, texto, rol, nombre accesible ni `data-testid`.
- **Alcance e interruptor.** Todas las reglas están limitadas a `[data-department="occ"][data-occ-bridge]`. `AdminOccLayout` pone `data-occ-bridge` en la raíz del marco con la prop nueva `rootAttributes` de `ShellFrame`. Quitar ese atributo apaga el puente entero, y fuera del OCC no existe.
- **Peso.** La regla de cada clase pesa al menos dos atributos y una clase: gana a la utilidad simple de Tailwind (una clase) y a la `dark:` (dos clases) sin depender del orden. La regla por defecto, para los bordes y anillos sin color, no pesa nada (`:where`), así cualquier clase de color le gana. Solo una entrada de selectores simples y sin clases puede llevar `!important`, que es la única forma de ganar a un estilo en línea; hoy es la franja de estado.
- **Manifiesto** (`src/styles/occLegacyBridgeMap.js`):
  - `OCC_LEGACY_BRIDGE`: 43 entradas `{ id, declarations, classes, inside?, pairs?, selectors?, important? }`, en orden:
    - texto y superficies (panel, losa, fondo, campo y panel flotante);
    - fondos tenues, rellenos con su tinta y puntos de estado. La acción principal es la tecla clara. Entre los estados, el ámbar y el rojo quedan solo para `status-warning` y `status-danger`. Los demás estados (`info`, `active`, `success` y `neutral`) y el naranja de marca `signal-500` (antetítulos, numeraciones, contadores y puntos) no llevan tono: el estado activo y los contadores son un relleno claro con su tinta, `success` es un punto del color del texto, e `info` y `neutral` van en el secundario. El naranja conserva el cian solo donde marcaba la fila elegida (`border-signal-500` y `ring-signal-500`);
    - velo, juntas, bordes de control, anillos y contornos;
    - el borde rojo de un campo inválido, por encima de cualquier otro borde;
    - la franja de estado que `FlightCard` (Planificación), `FlightListItem` (Monitoreo de vuelos) y `PositionListItem` (Mapa de posiciones) pintan en línea con `STATUS_COLORS` pasa a junta (`--occ-line`), con `!important`; la insignia ya dice el estado;
    - pares, como el texto rojo sobre el fondo rojo tenue, que pasa a texto normal;
    - plano: sin desenfoque, y las sombras se anulan con `--tw-shadow` para que sobrevivan los anillos de foco;
    - radios por papel (6 px los paneles y 4 px los controles);
    - `font-sans` vuelve a Manrope, y `bg-occ-panel/90` y `/95` pasan a `--occ-panel-float`, porque Tailwind no las generaba.

    Cubre 148 clases de color y 19 de sombra, desenfoque, radio y familia tipográfica.
  - `OCC_BRIDGE_DEFAULTS`: un borde sin color es `--occ-line-strong` y un anillo sin color es `--occ-accent`.
  - `OCC_BRIDGE_UNMAPPED`: clases que un archivo del OCC contiene pero que nunca pintan dentro del marco, cada una con su motivo. Hoy está vacío.
  - `MIGRATED_FOLDERS`: carpetas ya rehechas con tokens y primitivas de `occ-ui`, donde no se admite ninguna clase de color heredada. Hoy está vacío; la primera llega con U3. *Desde U2 ya no está vacío: tiene las dos carpetas del marco, `src/features/admin-occ/shell` y `src/features/admin-occ/live`, y las pantallas entran desde U3, cada una en el PR que la rehace (nota del 13 de noviembre de 2026, punto 11).*
- **Generador.** `src/styles/occLegacyBridge.js` es puro: `bridgeSelector`, `generateOccLegacyBridgeCss` y `findLegacyColourClasses`. Para cambiar la hoja se edita el manifiesto y, desde `frontend/private-web`, se ejecuta `npx vitest run --configLoader runner --config vitest.config.mjs src/styles/occStyleGuard.test.js` con la variable de entorno `UPDATE_OCC_BRIDGE=1`, que reescribe la hoja. La hoja no se edita a mano.
- **Guardas** (`src/styles/occStyleGuard.test.js`). Fallan si:
  - la hoja versionada difiere de la que genera el manifiesto;
  - una regla sale del alcance, selecciona algo fuera del marco o no gana a la utilidad de Tailwind que repinta;
  - un archivo montado bajo `/admin-occ` usa una clase de color heredada que el manifiesto no cubre. El recorrido (`src/styles/occSourceScan.js`) sigue las importaciones desde `app/admin-occ/**` y `AdminOccLayout.jsx`, y se detiene en `src/app/RoleLayout.jsx`, que importa los marcos de los demás departamentos;
  - el manifiesto repite una clase o usa un token que `occ.css` no define;
  - un estado normal o el naranja de marca recibe ámbar, rojo o cian (salvo el contorno de lo elegido), o una clase de `status-warning` o `status-danger` pierde su señal;
  - aparece `!important` fuera de una entrada de selectores simples marcada `important`, o un archivo montado bajo `/admin-occ` pinta en línea una franja de estado que el puente no alcanza (la prueba monta las tarjetas y las filas en jsdom);
  - una regla de las hojas que importa `app/layout.jsx`, o de una hoja montada bajo `/admin-occ`, copia con `@apply` un color heredado y no tiene una regla de `occ.css` que la repinte con más peso dentro de la misma consulta de contenedor, ni un motivo para quedar fuera;
  - una carpeta de `MIGRATED_FOLDERS` usa una clase de color heredada;
  - `occ-ui` usa desenfoque, degradados o un modificador de opacidad sobre `occ-*`;
  - una clase de color `occ-*` de `app/` o `src/`, sin su variante ni su modificador de opacidad, no genera CSS con la configuración del proyecto, como `bg-occ-primary`, cuyo color no está en `colors.occ`;
  - una pareja de la paleta pierde su contraste, o el chat lee una variable que nadie define;
  - el chat dibuja el foco o la selección con un color fijo que `occ.css` no supera, también frente al borde del puente al pasar el cursor.
- **Cómo sale una pantalla del puente.**
  1. Un commit mecánico cambia las clases heredadas de la carpeta por clases `occ-*` y primitivas de `occ-ui`, sin reestructurar el JSX y con los mismos textos, roles, nombres accesibles y `data-testid`. La reestructura, si la hay, va en otro commit.
  2. La carpeta entra en `MIGRATED_FOLDERS`: desde entonces la guarda prohíbe allí las clases de color heredadas.
  3. Se borran del manifiesto las clases que ya no usa ningún archivo montado y se regenera la hoja.
- **Páginas compartidas.** Usuarios (`DepartmentUsersPage`), Mis gastos (`DepartmentExpensesPage`) y los componentes de `src/components/` se quedan en el puente. No se editan para el OCC, porque otros departamentos y sus pruebas dependen de ellos; fuera del OCC no cambian.
- **Lo que repara `occ.css` fuera del puente.** Dos reglas que no salen de una clase del DOM, así que el puente no las alcanza:
  - las tablas apiladas: por debajo de 40rem, `tokens.css` convierte cada fila de una `table-stack` en una tarjeta copiando con `@apply` la tarjeta heredada (blanca o azul marino translúcida), su sombra y su radio de 12 px. Lo usan Usuarios, Mis gastos, Revisión y el tablero de escalas del dashboard. Bajo el OCC esa tarjeta es una losa de panel plana con juntas y radio de panel, y sus rótulos van en el secundario;
  - el chat, hasta que U6 lo rehaga: su hoja dibuja la conversación elegida y el foco del redactor en el azul heredado `#145dc4` (2,4:1 sobre el panel). Bajo el OCC los dos van en cian, con más peso que la hoja del chat y que el borde del puente al pasar el cursor.
- **Lo que el puente no hace.** No cambia el tamaño del texto, las mayúsculas ni la disposición. El texto menor de 12 px y los rótulos en mayúsculas siguen hasta que cada pantalla se migre.
- *Descartado:*
  - cambiar de golpe las clases de más de cien archivos (la lección del #156);
  - redefinir los colores heredados de Tailwind como variables CSS, que no cubre `white` ni `black` y alcanzaría a los demás departamentos.

**5. Regla de leyenda.** Cada mapa y cada tablero con estados muestra su leyenda (pedido de Erick):
- la del mapa lista solo lo que hay en pantalla: estados de posición, tipos de avión, estimado, demo y trazas;
- un tablero la muestra en su encabezado;
- la barra de estado (U2) abre «Leyenda» desde cualquier pantalla.

Las leyendas leen las palabras y los dibujos de `statusVocabulary.js`: un estado se llama y se ve igual en el mapa, la lista, el tablero y la leyenda. U1 no añade leyendas; fija el vocabulario que leerán.

**6. Un solo vocabulario** (`src/features/occ-ui/`, datos puros con su texto en español y en inglés).
- `statusVocabulary.js`:
  - `STAND_STATES`: los siete estados de posición, clave → `{ es, en, fill, outline, dash, extra }`. El archivo guarda cómo se llama y se dibuja cada estado; las reglas de «Cuándo» las aplicará el modelo de posiciones de los mapas. Cada relleno se pinta tal cual, sin una opacidad aparte: el de «Llegando» es translúcido y lleva su alfa en su propio token, así el mapa, el canvas y una leyenda en HTML pintan el mismo color.

    | Clave | Español | Inglés | Cuándo | Relleno | Contorno | Marca |
    |---|---|---|---|---|---|---|
    | `available` | Libre | Free | sin visita | ninguno | 1 px continuo, `line-strong` | código |
    | `planned` | Planificada | Planned | asignada, el vuelo llega en más de 15 min | ninguno | 1,5 px a trazos 4-3, `muted` | vuelo, hora y huella a trazos |
    | `arriving` | Llegando | Arriving | asignada, el vuelo llega en 15 min o menos, aterrizó o rueda, y aún no está en la posición | `--occ-arriving-fill` (`panel-raised` al 40 %) | 2,5 px continuo, `text` | línea de entrada resaltada, «en N min» |
    | `occupied` | Ocupada | Occupied | el avión está en la posición, del calzo al push-back | `panel-raised` | 2 px continuo, `text` | huella y barra de avance |
    | `releasing` | Por liberar | Releasing | ocupada y la salida es en 15 min o menos | `panel-raised` | 2 px continuo, `text` | reloj, «sale en N min» |
    | `disabled` | Inhabilitada | Disabled | anulada por una posición combinada | rayado, `line-strong` | 1,5 px a trazos 2-2 | «Anulada por 9A» y la línea de enlace |
    | `unverified` | Sin verificar | Unverified | posición del mapa sin fila en la base | ninguno | 1 px punteado 1-3, `faint` | código atenuado |

    Las superposiciones, sobre cualquier estado: elegida = borde cian de 2 px; atención = triángulo ámbar con su motivo («Sin agente que la cubra», «Pasó su hora de salida»); urgente = octágono rojo («Otra aeronave llega a esta posición»).
  - `TAGS`, las mismas palabras en todas las pantallas:
    - `demo`: «Demo», placa con rayas a 45°;
    - `estimated`: «est.», anillo o contorno a trazos; el bloque de datos dice «Posición estimada: calculada con el horario, no con señal del avión.»;
    - `unofficial`: «No oficial», con contorno;
    - `stale`: «Sin actualizar desde las {time}», atenuado.
  - `SIGNALS`: `attention` (`--occ-warn`, triángulo, «Atención»), `urgent` (`--occ-danger`, octágono, «Urgente») y `notice` (sin color, rombo, «Aviso»).
  - `isInOperation(visit)`: una visita está «En operación» cuando su escala está `InProgress` o su operación está `InProgress` o `Returned`. Acepta un vuelo del mapa, una escala y una escala de Planificación.
- `occShortcuts.js`: la tabla `OCC_SHORTCUTS` y `createOccShortcutHandler(handlers, { isBlocked, document })`.
  - Ocho teclas: `1` Región, `2` Aproximación, `3` Aeródromo, `4` Rampa, `D` 2D/3D, `S` Seguir, `L` Capas y `Esc` Limpiar.
  - Compara `event.key` sin distinguir mayúsculas.
  - Ignora la tecla escrita en un campo editable, con Ctrl, Meta o Alt, repetida por mantenerla pulsada, o ya atendida por otro (`defaultPrevented`).
  - No hace nada con un diálogo modal abierto (`[role=dialog][aria-modal=true]`), ni cuando `isBlocked()` avisa de un cajón abierto.
  - Va en el `keydown` del contenedor del mapa, en fase de burbuja, nunca en `document`.
  - `Esc` cierra primero el cajón o el diálogo abierto, que llama a `preventDefault()`, y solo después limpia la selección.
  - Nada más: la leyenda y la pausa son botones. Pasar de posición en posición, las teclas por panel, `Ctrl K`, las secuencias `g` y el diálogo de atajos quedan aplazados. En U1 ninguna pantalla escucha todavía estas teclas: las conectarán el mapa y la consola.
- `occPalette.js`: ver la sección 3.

**7. Tipo y forma.**
- Manrope, con peso 500 o más, en todo el OCC: U1 la aplica sobre `[data-department='occ']`; antes solo regía dentro de `.occ-dashboard`.
- IBM Plex Mono solo para identificadores, dibujados como «placas»: vuelo, matrícula, posición, IATA y OACI, squawk, relojes y horas en tablas. Las dos fuentes se sirven desde el propio sitio con `next/font`.
- 12 px como mínimo. Rótulos en frase normal, sin mayúsculas espaciadas.
- Losas planas separadas por juntas de 1 px, sin sombras, degradados ni `backdrop-filter`.
- Radios por papel (`--occ-radius-*`): 2 px las placas, 4 px los controles, 6 px los paneles y 8 px lo superpuesto. Los paneles flotantes usan `--occ-panel-float`, casi opaco (0,94) y sin desenfoque.
- Movimiento sobrio: solo se mueven los aviones, y solo parpadea una alerta urgente que nadie recibió. Con «reducir movimiento», las animaciones y transiciones del OCC duran 0,01 ms.
- En U1, `occ.css` ya no tiene degradados, sombras ni desenfoque (lo comprueba una prueba). El puente quita el desenfoque y las sombras de las clases heredadas, y `occ.css` quita la sombra que `tokens.css` pone a las filas de las tablas apiladas (sección 4). El tamaño mínimo y los rótulos se corrigen pantalla por pantalla, de U3 a U6.

### Lo que añadirán U2 a U6

| PR | Qué añade |
|---|---|
| U2 «Marco del OCC» | Un proveedor único con los refrescos agrupados (`useOccResource`); la barra de estado (estación, enlace en vivo, fuentes, alertas, relojes y «Leyenda»); el riel reagrupado en «En vivo», «Planificar», «Revisar» y «Estación», con los mismos 14 módulos; el cajón de alertas y avisos; y el enlace para saltar al contenido. *Además, sus carpetas `src/features/admin-occ/shell` y `src/features/admin-occ/live` entran en `MIGRATED_FOLDERS` (nota del 13 de noviembre de 2026, punto 11).* |
| U3 «Consola» | Las primitivas de `occ-ui`. El mapa a pantalla completa con sus paneles flotantes: «Tablero», «Alertas», «Posiciones», el selector de vistas y el «Inspector». Importar y asignar sin salir del mapa, la pastilla «Llegada nueva» y el respaldo en cuadrícula. Borra el dashboard viejo y el CSS con `nth-child` de `occ.css`, y añade la primera carpeta a `MIGRATED_FOLDERS`. *Ya no es la primera: U2 añade las dos carpetas del marco, y U3, las suyas (nota del 13 de noviembre de 2026, punto 11).* |
| U4 «Pantalla de arranque» | `admin-occ/boot/`: el isotipo y el logo ELEVANT · OCC, el fondo «rutas que se trazan» y una línea de progreso, desde la verificación de la sesión hasta que la consola está lista. *Llegó antes que U3: aparece cuando el cliente conoce la sesión, espera el acceso y después el primer aviso de la consola o del mapa, o 6 s; no precarga datos, y su carpeta entra en `MIGRATED_FOLDERS` (nota del 13 de noviembre de 2026 sobre U4, puntos 2, 3, 8 y 9).* |
| U5 «Pantallas de mapa» | Monitoreo de vuelos, Mapa de posiciones y Planificación con sus plantillas, y las dos vistas nuevas de Planificación. |
| U6 «Resto de pantallas» | Cobertura, Revisión, Notificaciones, Chat, Datos maestros, Tablets, Contratos listos y Reportes con `occ-ui`. Limpia el código muerto y deja el puente solo para las páginas compartidas. |

Cada uno amplía la nota del Vault de Private Web. Un cambio de estas decisiones se añade como nota fechada al final de este ADR, sin reescribirlo.

## Consecuencias

- Todas las pantallas montadas bajo `/admin-occ` pasan a los tokens oscuros, directamente, a través del puente o con las reparaciones de `occ.css`, sin reestructurar el JSX de ninguna, y el chat vuelve a tener fondos y bordes. Quedan los colores en línea que lista «Queda pendiente». Los textos, roles, nombres accesibles y los 26 `data-testid` del OCC no cambian; solo desaparece de la barra el botón de tema, con su nombre accesible.
- Los demás departamentos conservan su tema y su aspecto: los tokens y el puente solo existen bajo `[data-department="occ"]`. Una cuenta con tema claro ve el OCC en oscuro y recupera su tema al salir; desde el OCC nunca se escribe `elevant-theme`.
- Sin cambios fuera de AVIAM Web:
  - no cambian la API, el OpenAPI, el cliente compartido ni la base, y no hay migración;
  - no hay dependencias nuevas ni orígenes nuevos en el navegador: la CSP no cambia y el script de arranque lleva el nonce de la petición;
  - solo se despliega AVIAM Web (`frontend/private-web`): la API, la base, Public Web y la app de la tablet siguen igual.
- El contraste se comprueba por cálculo, en pruebas con mínimos: 10:1 para el texto, 7:1 para el secundario, 4,5:1 para cualquier otro texto y 3:1 para los bordes de control. La revisión visual se hace con capturas de cada pantalla (1440×900 y 1920×1080), no con pruebas automáticas.
- Pruebas nuevas:
  - `occPalette.test.js`, `statusVocabulary.test.js` y `occShortcuts.test.js`;
  - `occTheme.test.js`, `useTheme.test.jsx`, `app/root-layout.test.jsx` y `OccTopbar.test.jsx`;
  - `occStyleGuard.test.js`.

  Además, `ShellFrame.test.jsx` suma un caso, y el caso del botón de tema de `DevPreviewPanel.test.jsx` pasa a comprobar que no lo hay.

**Queda pendiente**
- **Primer pintado.** El script pone la clase `dark` antes de pintar, pero hasta que monta el marco se ve el fondo oscuro de `body`, azul marino (`#0A1220`), y luego la pizarra del OCC (`#161E22`). Lo cubrirá la pantalla de arranque de U4. La certificación de la imagen todavía no comprueba ese primer pintado: lo cubren las pruebas con jsdom. *U4 lo cubre solo en parte: la pantalla de arranque no está en el HTML del servidor y aparece solo en la primera entrada después de iniciar sesión (nota del 13 de noviembre de 2026 sobre U4, punto 10).*
- **La consola actual** conserva su disposición con selectores `nth-child` en `occ.css`, ahora solo con colores de los tokens, hasta que U3 borre el dashboard viejo. Hasta entonces, `--occ-panel-muted` sigue como alias, y las cuatro clases `bg-occ-panel/90` y `/95` de la consola las cubre el puente. Su tablero de escalas pinta todavía en cian el punto de «Planificada», «Programada» y «Confirmada» con `bg-occ-accent`, una clase nativa del OCC que el puente no toca y que U1 no cambia en el JSX.
- **Colores de estado en línea fuera de las franjas.** Las leyendas y el resumen de Monitoreo de vuelos y del mapa de posiciones (`FlightLegend`, `PositionLegend` y `PositionSummary`) y los marcadores de esos mapas (`AircraftMarker` y `positionMarkerIcons.js`) siguen pintando con los colores de `STATUS_COLORS` en línea o en código. Los rehacen el carril de mapas y U5 con `occPalette.js` y `statusVocabulary.js`.
- **Texto menor de 12 px y rótulos en mayúsculas** en las pantallas heredadas, hasta que cada una se migre.
- **El puente depende de los nombres de las clases:** una correspondencia puede verse mal en una página compartida o en un elemento pequeño. Lo mitigan las pruebas de cobertura, las capturas y el interruptor por atributo.
- **Limpieza del manifiesto.** Ninguna prueba avisa todavía de una clase del manifiesto que ya no usa ningún archivo: al migrar una carpeta se borran a mano.
- **Mapas.** El código de los mapas conserva su estilo claro hasta que el carril de mapas deje una sola paleta que lea `occPalette.js` y no cambie de estilo después de arrancar. Dentro del OCC siempre reciben el tema oscuro.

## Nota del 13 de noviembre de 2026: U2 «Marco del OCC»

U2 cambia solo el marco del OCC: el proveedor, la barra de estado, el riel, el cajón de alertas y los toasts. No reestructura ninguna pantalla: cada ruta pasa al proveedor en el PR que la rehace (U3, U5 y U6). El código llegó en cuatro pasos: el proveedor con las lecturas agrupadas (`1afe6820`), la barra de estado (`debecb1e`), el riel con el enlace de salto (`2d30d7fe`) y el cajón de alertas con los toasts (`a7ef7a4f`). Esta nota amplía las decisiones de arriba sin reescribirlas y dice dónde U2 se aparta del diseño; donde el diseño y la página de contratos del plan difieren, manda la página de contratos.

**1. Un proveedor y un observador por pestaña.**
- `src/features/admin-occ/shell/OccShellProvider.jsx` envuelve `AppShell` dentro de `AdminOccLayout` y abre el único observador de cambios del marco en cada pestaña del OCC (`createPrivateWebAccountChangeObserver`), solo con una cuenta válida. Por cada página del cursor avisa una sola vez a cada suscriptor que escucha alguno de sus recursos, y un suscriptor que falla no deja sin aviso a los demás.
- `useOccShell()` devuelve `{ live, subscribe, notices, sources }`:
  - `live`: el enlace en vivo, `{ state, since, lastOkAt }`, con `state` igual a `live`, `reconnecting`, `polling` u `offline`;
  - `subscribe(resources, onChange)`: escucha recursos del feed y devuelve la función que deja de escucharlos;
  - `notices`: los avisos operativos, leídos una sola vez para todo el marco: `{ status, items, hasMore, unreadCount, fetchedAt, refreshFailed, refresh, retry, markRead }`;
  - `sources`: la salud de las fuentes, `{ items, summary, report, remove }`.

  `useOccShellChannel()` da solo la parte estable (`subscribe`, `sources.report` y `sources.remove`): quien solo escucha o informa no se vuelve a pintar cuando cambian el enlace o los avisos. Fuera del marco, `useOptionalOccShell()` y `useOptionalOccShellChannel()` devuelven `null`.
- Pasan al observador del marco:
  - el acceso del departamento: `src/app/RoleLayout.jsx` monta `DepartmentAccessProvider` con `observe={role !== 'adminOcc'}`, y el marco relee el acceso cuando el feed anuncia `department_users` o `access_requests` (`ACCESS_RESOURCES`, ahora exportado);
  - los avisos: `AdminOccLayout` pasa `notificationsEnabled={false}` a `AppShell`, que en el OCC ya no lee avisos ni pinta toasts. Los lee el proveedor, y los toasts los pinta el marco (punto 7);
  - el contador de Revisión: `useOccReviewChangeVersion` escucha `occ_review` en el canal del marco. Fuera de él, en una pantalla aislada o en una prueba, abre su propio observador, como antes.
- `src/services/accountChangeObserver.js` gana el callback opcional `onStatus({ hubs, lastOkAt, lastErrorAt, failingSince })`. Informa cuando termina el arranque de un hub, cuando un hub se reconecta o se cierra, y después de cada conciliación. Sin el callback, el observador se comporta como antes.
- Los módulos puros de `src/features/admin-occ/live/` son `occCadence.js` (la cadencia y los umbrales del enlace, en un solo sitio), `occLive.js` (el reductor del enlace en vivo), `sourceHealth.js` (el almacén de las fuentes y su resumen), `refreshScheduler.js` (cuándo se relee un recurso anunciado) y `occRequestPlan.js` (el plan de peticiones del punto 2). `useOccResource.js` es el hook de lectura del punto 3.
- *Por qué:* la barra, el riel, el cajón y la consola tienen que dar los mismos números en todas las pantallas. Hasta U2, el acceso del departamento, la campana y casi todas las pantallas abrían su propio observador, con dos hubs y un sondeo de 25 s cada uno, y ninguno podía decir si la pantalla estaba en vivo.
- *Descartado:* que cada pantalla conserve su observador e informe hacia arriba.

**2. El presupuesto de peticiones.**
- El presupuesto de una pestaña del OCC es de 40 peticiones por minuto en reposo y 70 durante un minuto de vuelo demo (`OCC_REQUEST_BUDGET` en `live/occRequestPlan.js`). Hoy la API admite 100 peticiones por minuto y dirección en todos los entornos; el PR A3 sube a 600 el límite de Development (`RateLimiting:PermitLimit`). En una presentación, la consola, Superadmin y la tablet comparten la dirección.
- El guion del minuto demo, `OCC_DEMO_MINUTE`, tiene `occ_planning` a los 5, 12, 19, 26, 33, 40, 47 y 54 s (el aterrizaje que marca el worker, la importación, la asignación y cinco toques de la tablet), `notifications` a los 20 y 45 s, y `occ_review` a los 50 s (una entrega para revisión).
- `live/occRequestBudget.test.js` repite ese minuto con el mismo `refreshScheduler` que usa `useOccResource`, después de 60 s de calentamiento y sin las lecturas del montaje. Falla en cinco casos:
  - El marco deja de tener un solo observador: `RoleLayout` vuelve a encender el del acceso en el OCC, o `AdminOccLayout` deja de montar `OccShellProvider` o vuelve a encender los avisos de `AppShell`.
  - La consola planificada pasa del presupuesto. Hoy da 15 peticiones en reposo y 37 en el minuto demo. Cuenta el observador del marco y sus lecturas, que son los avisos y el latido de presencia que ya mantiene cada pestaña, más las lecturas de la consola de U3: la imagen aérea cada 10 s, los vuelos del mapa con `occ_planning`, y planificación, posiciones y cola de revisión con su sondeo de 60 s. La cola relee también con `occ_review`.
  - Una de las 14 pantallas de hoy, con los observadores que le quedan, pasa del presupuesto. La más cargada en reposo es Chat interno, con 22. En el minuto demo son Panorama, con 67 de 70, y Planificación, con 66.
  - Un toque de la tablet relee algo que no escucha `occ_planning`, o relee más de una vez cada 3 s.
  - El inventario `OCC_OBSERVER_SITES` no coincide con el código. Cada archivo montado bajo `/admin-occ` que abre un observador tiene que estar en la lista, con su modo, sus recursos, su sondeo y el PR que lo mueve, y no puede haber nada más.
- Los observadores que quedan y el PR que los pasa al marco:

  | PR | Archivo, bajo `src/features/` |
  |---|---|
  | U3 | `dashboard/useDashboardData.js` (Panorama) |
  | U5 | `flight-monitoring/FlightMonitoringRoute.jsx`, `positions-map/PositionsMapRoute.jsx`, `planning/PlanningRoute.jsx` y `planning/attendance/useAttendanceDraft.js`, este solo con el panel de asistencia abierto |
  | U6 | `position-coverage/CoverageRoute.jsx`, `master-data/MasterDataRoute.jsx`, `devices/DevicesRoute.jsx`, `chat/CanonicalChatRoute.jsx` y `notifications/CanonicalNotificationsRoute.jsx` |

  Las páginas de otros departamentos que monta el OCC conservan el suyo mientras están abiertas: la pestaña de servicios de Notificaciones (`contracts/catalog/ServiceClosurePanel.jsx`), Usuarios (`department-users/useDepartmentGovernance.js` y `human-resources/users/RampProfilesPanel.jsx`) y Mis gastos (`finance/payables/usePayablesWorkspace.js`). Reportes, Contratos listos y Revisión ya no abren ninguno.

**3. Cómo pasa una pantalla a `useOccResource`.** `useOccResource({ key, load, permission, resources, scopeKey, enabled, pollMs, coalesceMs, timeoutMs, isEmpty, sourceId })` devuelve `{ status, data, refreshing, refreshFailed, fetchedAt, refresh, invalidate, retry, setData }`. `refresh()` relee en el acto. `invalidate()` es para un cambio que hizo la propia pestaña y que ningún aviso del feed va a anunciar: relee como un aviso, agrupado y aplazado con la pestaña oculta. El PR que rehace una pantalla sigue cuatro pasos:
1. Cambia el observador de la pantalla y su bloque de foco, conexión y sondeo de 25 s por un `useOccResource` por lectura, con estas opciones:
   - `permission`, el permiso de la lectura: `operations.planning.read` para planificación, `operations.positions_map.read` para posiciones, `operations.review.read` para la cola de revisión y `operations.notifications.read` para los avisos. Sin él no sale ninguna petición y el estado es `forbidden`.
   - `resources`, los recursos del feed con que relee. Los avisos se juntan: la lectura se repite como mucho una vez cada 3 s, y los avisos que llegan durante una lectura se juntan en una sola lectura después de ella. Con la pestaña oculta esperan y se leen una vez al volver. Los paneles secundarios de la consola no escuchan `occ_planning` (contrato 2.7).
   - `pollMs`, el sondeo de seguridad: 60 s por defecto, contados desde la última lectura terminada. Puede ser una función de los datos y también se aplaza con la pestaña oculta.
   - `scopeKey`, el alcance, por ejemplo la estación y la fecha. Un alcance nuevo retira los datos del anterior, también en el primer pintado.
2. Muestra los estados del hook: `loading`, `success`, `empty`, `error`, `timeout`, `forbidden` (un 403 o un 404) y `unauthorized` (un 401). Una lectura se abandona a los 20 s (`timeout`). Tras un 401, un 403 o un 404, el hook retira los datos, deja de sondear y olvida las relecturas que tenía pendientes: la de un aviso que esperaba a la lectura rechazada, la del final de los 3 s y la aplazada con la pestaña oculta. No atiende avisos nuevos hasta que cambia el objeto de acceso o se llama a `retry()`. Una relectura fallida conserva los datos y lo dice con `refreshFailed`.
3. Si la lectura es una de las fuentes de la barra, pasa su `sourceId`, y el hook la informa a la lista de fuentes.
4. Borra su archivo de `OCC_OBSERVER_SITES`: la prueba falla mientras el inventario y el código no coincidan. La prueba solo repite hoy la consola planificada y las pantallas con observador propio, así que el mismo PR añade al plan las lecturas de la pantalla que la consola no tiene, para que se sigan contando.

**4. La barra de estado.** `OccTopbar` es la barra de estado de 48 px de todas las pantallas del OCC. Muestra el menú (por debajo de 640 px), la placa «PUJ» (más «Punta Cana» desde 1280 px), el nombre del módulo, el enlace en vivo, las fuentes, las alertas, los relojes, el idioma, «Leyenda» y la cuenta. No tiene botón de tema, modo muro ni búsqueda.
- El nombre del módulo sale de `occNavLabel`: el texto de `occShellMessages` o, si falta la clave, el nombre del módulo. La barra ya no muestra las claves `nav.master-data` y `nav.devices`, sino «Datos maestros» y «Tablets».
- **Enlace en vivo** (`status/OccLiveIndicator.jsx`, con las reglas de `live/occLive.js`). Cada estado lleva su forma y abre una frase que lo explica:
  - «En vivo», con un punto lleno: hay un hub conectado y ELEVANT respondió hace menos de 60 s. Dice «Los cambios llegan al momento.».
  - «Reconectando», con medio punto: los hubs se conectan o se reconectan, durante 30 s como mucho. Dice «Reintentando la conexión en vivo.».
  - «Sin tiempo real», con el triángulo ámbar: no hay hub, pero las conciliaciones por HTTP responden. Dice «La pantalla se actualiza cada 25 segundos.».
  - «Sin conexión», con el octágono rojo: el navegador no tiene red o ELEVANT no responde desde hace más de 60 s. Dice «Sin respuesta de ELEVANT desde las {hora}.».
- **Fuentes** (`status/OccSourcesButton.jsx`, con `live/sourceHealth.js`): «Fuentes al día», «1 fuente con retraso» o «{count} fuentes con retraso» (con el triángulo ámbar), o «Sin conexión con ELEVANT» (con el octágono rojo). La lista da el estado de cada fuente, su antigüedad («hace 8 s», o la hora pasado un minuto) y sus marcas, dibujadas con su textura. Hoy informan dos fuentes, «Operación ELEVANT» y «Tiempo real». Las demás del catálogo `OCC_SOURCES` llegan con U3 (vuelos del proveedor), M5 (tráfico aéreo y mapa base) y M8 (clima y satélite). Solo cuenta una fuente que debería estar al día y no lo está: nunca cuentan la que la cuenta no puede leer, la que el entorno no tiene ni la que la pantalla no lee.
- **Alertas** (`status/OccAlertsButton.jsx`): «Sin alertas», «1 alerta» o «{count} alertas». Con alertas sin recibir lleva el glifo de la prioridad más alta, y su palabra va como descripción accesible. El número conserva `data-testid="notifications-badge"`. Mientras cargan los avisos dice «Alertas», en neutro, como con el estado `unauthorized` del hook, y sin el permiso de los avisos no aparece. Abre «Alertas y avisos» (punto 6). Dos estados dicen que el conteo no es de fiar. Llevan el triángulo ámbar, salvo que ya se sepa de una alerta urgente, que conserva su octágono:
  - si la primera lectura falla o se agota su tiempo, dice «Alertas: sin datos», sin número;
  - si falla una relectura después de una buena, conserva el último número, atenuado, seguido de «, sin actualizar», y la descripción dice «Sin actualizar desde las {hora}», con la hora de la última lectura buena. «Sin alertas» también lleva el triángulo en ese caso, porque una calma que ya no es actual no se puede asegurar.

  En los dos casos abre igual el cajón, que ofrece «Reintentar». Un 401 de los avisos también cuenta como lectura fallida: `operationalCommunicationService.js` pasa el 401 a la sesión, que se renueva o se cierra, y devuelve un error sin estado. Los avisos no entran en la lista de fuentes: el botón ya lo dice, y la lista nombra solo las fuentes del diseño C.4.
- **Relojes** (`status/OccClocks.jsx`): primero la hora local (AST) y después la UTC, en mono y sin segundos, según el reloj del equipo. Un solo reloj por pestaña avanza al cambiar el minuto y al volver a la pestaña. Los relojes conservan sus nombres accesibles, «Hora local de Punta Cana según el reloj de este equipo» y «Hora UTC según el reloj de este equipo».
- **Cuenta** (`status/OccUserMenu.jsx`): a todos los anchos, una placa con las iniciales abre el nombre, el rol y «Cerrar sesión».
- **Reglas de ancho.** Viven en `status/statusBarLayout.js`, un mapa puro con su prueba, porque jsdom no aplica CSS:

  | Ancho | Qué muestra la barra |
  |---|---|
  | menos de 640 px | el menú, «PUJ», el glifo del enlace en vivo, el glifo y el número de las alertas, la hora local y la cuenta, que guarda «Leyenda» y el idioma |
  | de 640 a 1023 px | sin el menú, porque el riel de iconos está a la vista; suma el nombre del módulo, la palabra del enlace y la de las alertas, y el glifo de las fuentes |
  | de 1024 a 1279 px | suma el reloj UTC, y el idioma y «Leyenda» pasan del menú de la cuenta a la barra |
  | desde 1280 px | suma «Punta Cana» y la palabra de las fuentes |
  | desde 1536 px | suma las palabras que dicen por qué el conteo de alertas no es de fiar: «: sin datos» y «, sin actualizar» |

  Las palabras que no se ven quedan para los lectores de pantalla. Con puntero táctil, cada control mide al menos 44 × 44 px.
- *Diferencias con el diseño C.3:*
  - la palabra de las fuentes aparece desde 1280 px y no desde 1024, porque con el riel desplegado (248 px) no cabía junto al nombre del módulo;
  - por debajo de 640 px las alertas muestran solo su glifo y su número, para que la barra quepa en 320 px;
  - las alertas suman dos estados que C.3 no tenía, la primera lectura fallida y la relectura fallida, porque toda vista remota necesita su estado de error recuperable (`frontend/AGENTS.md`). Su motivo se lee desde 1536 px. Esas palabras llegan cuando ELEVANT falla, a menudo mientras el enlace en vivo y las fuentes muestran sus palabras más largas, y solo desde ese ancho caben todas con el riel desplegado. Por debajo lo dicen el triángulo y el número atenuado;
  - la cuenta sigue en la barra a todos los anchos, porque por debajo de 1024 px guarda «Leyenda» y el idioma.

**5. La regla de la leyenda.** «Leyenda» (`status/OccLegendButton.jsx`) se abre desde la barra en cualquier pantalla, o desde el menú de la cuenta por debajo de 1024 px. Todo lo que muestra sale de `statusVocabulary.js`: los siete estados de posición con su dibujo (`occ-ui/OccStandSwatch.jsx`), las tres señales con su glifo (`occ-ui/OccGlyph.jsx`) y las cuatro marcas con su textura. Lo que significa cada marca está en `occ-ui/occUiMessages.js`, que leerán también las leyendas que añadan los mapas y los tableros. Donde no va una hora, como en una leyenda o en la lista de fuentes, la marca usa `TAGS.stale.short` («Sin actualizar»), que añade U2. Con hora sigue la plantilla `TAGS.stale` («Sin actualizar desde las {time}»). El plan la llamaba «Leyenda y atajos». Como el diálogo de atajos queda aplazado (punto 12), es solo «Leyenda», como dice la página de contratos.

**6. Prioridades de alerta y «Recibido».**
- `src/features/dashboard/noc/alertModel.js` aplica la prioridad de la sección 1 a los avisos que el marco ya leyó, sin otra petición:
  - «Urgente»: toda incidencia (`incident_reported`);
  - «Atención»: `deviation_reported`, `flight_cancelled_by_provider`, `flight_diverted_by_provider`, `agent_released`, `stand_change_unassigned` (la operación quedó sin agente elegible), `agent_document_not_current` y `contract_not_in_force`;
  - «Aviso»: el resto, también un tipo desconocido. Un aviso no pide «Recibido».
- Toda incidencia es «Urgente», sea cual sea la severidad con que se reportó, porque el aviso no la trae. El diseño (D14) dejaba las incidencias leves y medias en «Atención», pero manda la prioridad del plan.
- «Recibido» es el recibo de lectura por cuenta que ya existía, `PUT notifications/{id}/read` (`setOperationalNotificationRead(id, true)`). Un aviso con `readAt` está recibido, y `readAt` es la hora del recibo. Así el conteo es el mismo en todas las pantallas y después de recargar, y nada vive solo en el navegador. U2 no crea comandos nuevos: es la misma escritura que hace la página de Notificaciones.
  - Cada «Recibido» llama una sola vez.
  - Si falla, la fila dice «No se pudo marcar como recibida. Vuelve a intentarlo.».
  - Si sale bien, la fila dice «Recibida a las {hora}», y el foco pasa al siguiente «Recibido» o, si no queda ninguno, al título.
- «Alertas y avisos» (`shell/OccAlertsDrawer.jsx`, con `occ-ui/OccDrawer.jsx` y `occ-ui/OccAlertQueue.jsx`) es un cajón modal a la derecha, y por debajo de 640 px, una hoja inferior. No hace lecturas propias. Tiene tres partes:
  - la sección «Alertas»: primero las que no se recibieron, las urgentes antes que las de atención y la más nueva antes; después, hasta diez recibidas;
  - la sección «Avisos recientes», con hasta diez avisos;
  - el enlace «Ver historial de avisos».

  «Abrir» lleva al destino del aviso y cierra el cajón. Esc lo cierra con `preventDefault`. Mientras está abierto, el foco queda dentro; al cerrarse, vuelve al botón de alertas. Los botones atrás y adelante del navegador también lo cierran. Sus errores son textos fijos en español, como «No se pudieron cargar los avisos.» y «No tienes permiso para ver los avisos.», y nunca muestra el mensaje del servidor.
- El riel pone placas de conteo neutras en tres módulos, con los mismos avisos (`shell/railBadges.js`): en Chat interno, los mensajes de agentes sin leer; en Revisión, las operaciones entregadas sin leer; y en Notificaciones, todos los avisos sin leer.

**7. Los toasts.**
- Un reductor puro, `shell/occToastQueue.js`, gobierna la cola, y `occ-ui/OccToastStack.jsx` la dibuja arriba a la derecha, 8 px bajo la barra de 48 px: nunca tapa los relojes ni el conteo de alertas.
- Se ven tres como mucho. Cada uno dura desde que aparece: un urgente, 15 s; uno de atención, 10 s; un aviso, 8 s. Si no queda sitio, cede el que no es urgente más viejo de una lectura anterior. Si los tres son urgentes, el nuevo espera su turno: nada saca un urgente de la pantalla.
- En una ráfaga de más de tres avisos, los dos más urgentes llevan su toast, y el resto se resume en «Tienes {count} avisos operativos nuevos más.», con «Ver».
- El texto es «{tipo}, {código}», con el código de la operación dibujado como placa, y «Abrir» lleva al destino del aviso. El urgente se anuncia como `alert` y los demás como `status`; ninguno toma el foco.
- Otras reglas:
  - no hay toast de mensajes con el chat abierto;
  - abrir el cajón quita los toasts, y recibir una alerta quita la suya;
  - con el cajón abierto no se dibuja ningún toast. Lo que llega se anuncia dentro del cajón con las mismas palabras (`OccToastAnnouncer`, oculto a la vista y sin controles): el urgente como `alert` y los demás como `status`, porque un cajón modal oculta a los lectores de pantalla todo lo que queda fuera de él. Al cerrarlo, la cola se vacía: lo que llegó ya se vio y se oyó en el cajón, y así ningún toast aparece después con su tiempo recortado;
  - la primera lectura solo aprende qué avisos hay, así que entrar al OCC no repite alertas viejas.
- Los toasts no usan `useToast`, que no limita ni ordena: `src/components/Toast.jsx` sigue igual para los demás departamentos.
- Solo parpadea el glifo de una alerta urgente sin recibir, con `motion-safe:` y la animación `occ-alarm-blink` de `tailwind.config.js`. Con movimiento reducido no parpadea: lleva un contorno doble fijo.

**8. El riel reagrupado y el enlace de salto.**
- `OCC_NAV_SECTIONS` (`src/features/admin-occ/navigation.js`) agrupa los 14 módulos por la jornada del controlador, en español y en inglés:
  - «En vivo»: Panorama, Monitoreo de vuelos, Mapa de posiciones y Chat interno;
  - «Planificar»: Planificación, Cobertura de posiciones y Contratos listos;
  - «Revisar»: Revisión, Reportes y Notificaciones;
  - «Estación»: Datos maestros, Tablets, Usuarios y Mis gastos.

  Los nombres, las rutas y los permisos no cambian: el riel solo ordena los módulos que deja `allowedNavigation`, y un grupo sin módulos no aparece.
- La anatomía de `shell/OccSidebar.jsx` sigue el diseño C.2:
  - los rótulos de grupo miden 12 px y van en frase normal; con el riel plegado son una regla de 1 px;
  - las filas miden 36 px, y 44 px con puntero táctil;
  - el módulo activo lleva la losa elevada, una barra de acento de 2 px y `aria-current="page"`. La barra es un borde, así que se conserva en el modo de colores forzados;
  - las placas de conteo son neutras, con «99+» como tope, y su número llega a los lectores de pantalla como descripción («3 sin leer»), así que el nombre de cada enlace no cambia;
  - el pie lleva las iniciales, el nombre, el rol y «Cerrar sesión», y ya no hay tarjeta de identidad, porque la estación vive en la barra.
- Con el riel plegado (72 px), cada módulo conserva su nombre accesible y lo muestra al pasar el puntero o al recibir el foco; Esc lo descarta. El rótulo se dibuja fijo a la pantalla desde la caja del módulo, y no con `group-hover`, porque el riel se desplaza y su desplazamiento recorta cualquier rótulo con posición absoluta, como les pasaba a los rótulos del riel anterior.
- «Saltar al contenido» (`shell/OccSkipLink.jsx`) es el primer elemento enfocable del marco. Lleva el foco a `#main-content` sin escribir un fragmento en la URL, así la consulta de la pantalla no cambia.

**9. `ShellFrame.mainVariant`.** `ShellFrame` acepta `mainVariant`, con dos valores: `'scroll'`, por defecto e idéntico a lo de siempre, y `'fill'`, sin margen ni desplazamiento, para las pantallas de alto completo. Un valor desconocido lanza un error. El OCC todavía no lo usa: el PR que rehace cada pantalla de alto completo (la consola, Monitoreo de vuelos, Mapa de posiciones y Chat interno) la pasa a `'fill'`. U2 no cambia las cuatro a la vez, como proponía el diseño C.1, porque todavía no reestructura ninguna. `ShellFrame.test.jsx` no cambia, y `ShellFrameVariant.test.jsx` prueba las dos variantes.

**10. Tailwind.** `colors.occ` suma cuatro llaves: `primary`, `primary-hover` y `on-primary`, para la tecla clara de «Recibido», y `scrim`, para el velo bajo el cajón y bajo el menú del riel por debajo de 1024 px. Siguen sin llave, y por tanto sin clase, `--occ-field`, `--occ-arriving-fill`, `--occ-on-accent`, `--occ-on-warn`, `--occ-on-danger`, `--occ-warn-fill` y `--occ-danger-fill`; `OccGlyph` pinta sus señales con la variable en línea, sin clase. Las animaciones suman `occ-alarm-blink`.

**11. `MIGRATED_FOLDERS`.** U2 adopta la guarda antes de lo previsto en la sección 4: el marco entra primero, con `src/features/admin-occ/shell` y `src/features/admin-occ/live`, y allí no se admite ninguna clase de color heredada. `src/features/occ-ui` ya tenía su propia guarda: ninguna clase heredada, ningún desenfoque, ningún degradado y ningún modificador de opacidad sobre `occ-*`. Las pantallas entran desde U3, cada una en el PR que la rehace.

**12. Lo aplazado.** U2 no construye lo siguiente, por decisión del dueño o por la página de contratos del plan:
- el modo muro (diseño C.6), que la decisión 11 deja como extra después de la consola de laptop;
- la búsqueda con `Ctrl K`, las secuencias `g`, la tecla `a` que abre las alertas, y el diálogo de atajos con su interruptor y su entrada en el menú de la cuenta (diseño C.7). Quedan solo las ocho teclas de los mapas de la sección 6;
- `F6` para recorrer las regiones del marco (diseño H.2);
- el aviso de desfase entre el reloj del equipo y el del servidor («El reloj de este equipo difiere {minutes} min del servidor.»), que espera al reloj del servidor de M5 (`src/services/serverClock.js`);
- «{count} recibidas», en neutro, cuando todas las alertas se recibieron: la barra dice «Sin alertas»;
- la severidad de cada incidencia. Llevarla al aviso cambiaría una respuesta que la tablet valida con `hasOnlyKeys` y que no se vuelve a desplegar, y pedirla aparte serían hasta diez lecturas más;
- el acuse compartido por estación, que diría a todos quién recibió una alerta y cuándo. Necesitaría una tabla y una migración, y este plan no tiene migraciones. El acuse sigue siendo por cuenta.

**13. Límites.**
- La lista de avisos trae los 100 más recientes de la cuenta, con `hasMore`. Si hay más, los conteos de la barra, del riel y del cajón son un mínimo, y la interfaz todavía no lo dice.
- Un recibo no se anuncia por el feed.
  - Lo que se marca como leído o no leído en la página de Notificaciones llega enseguida a la barra, al riel y al cajón. Al guardar el recibo, la página pide al marco que relea los avisos (`requestNotificationsRefresh()`), y el marco agrupa esas peticiones como un aviso del feed (`invalidate()`): como mucho, una lectura cada 3 s. La página solo gana esa llamada. No se reestructura y conserva su observador hasta U6.
  - Lo que se marca en otra pestaña de la misma cuenta llega en la siguiente lectura del marco: con el próximo aviso nuevo o, como mucho, a los 60 s. Antes de U2, la campana releía cada 15 s.
  - Marcar un aviso como no leído en Notificaciones lo vuelve a dejar sin recibir.
- La prueba de presupuesto repite el plan de peticiones: no cuenta las peticiones reales del navegador.
- Las pantallas que no se movieron conservan su propio observador (punto 2), con su sondeo.
- Los relojes y la antigüedad de las fuentes usan el reloj del equipo.

**Consecuencias de U2.**
- Para el OCC, la campana desaparece. El botón de alertas cuenta solo las urgentes y las de atención sin recibir, y abre el cajón en lugar de ir a Notificaciones. Antes, la campana contaba todos los avisos sin leer; ahora ese total es la placa de Notificaciones en el riel. Los grupos del riel cambian, y los toasts usan coma, no punto medio.
- Los demás departamentos no cambian. `AppShell`, `ShellFrame` con su variante por defecto, `DepartmentAccessProvider` (que sigue observando fuera del OCC), `useNotificationBadge` y `Toast.jsx` se comportan como antes.
- Sin cambios fuera de AVIAM Web:
  - no cambian la API, el OpenAPI, el cliente compartido ni la base, y no hay migración;
  - no hay dependencias ni orígenes nuevos en el navegador, así que la CSP no cambia;
  - solo se despliega AVIAM Web.
- Pruebas que cambian:
  - `OccTopbar.test.jsx`: el botón «Notificaciones, 3 sin leer» / «Notifications, 3 unread», con su tope «99+», pasa a «3 alertas» / «3 alerts», con `notifications-badge` en el número;
  - `OccSidebar.test.jsx`: el grupo «Operación» / «Operations» pasa a «Estación» / «Station»;
  - `statusVocabulary.test.js` y `accountChangeObserver.test.js` suman casos;
  - `notifications/CanonicalNotificationsRoute.test.jsx` suma uno: con el marco montado, un recibo guardado en la página llega a la barra y al riel sin esperar el sondeo de 60 s.

  Ningún `data-testid` del OCC cambia, ni ningún texto que use el E2E del ciclo.
- Pruebas nuevas, junto a cada módulo:
  - en `live/`: `occLive`, `sourceHealth`, `refreshScheduler`, `useOccResource` y `occRequestBudget`;
  - en `shell/`: `OccShellProvider`, `occShellMessages`, `railBadges`, `occToastQueue`, `OccAlertsDrawer` y las siete de `status/`;
  - en `occ-ui/`: `OccGlyph`, `OccPlate`, `OccPopover`, `OccStandSwatch`, `OccDrawer`, `OccAlertQueue` y `OccToastStack`;
  - además, `alertModel`, `navigation`, `AdminOccLayout`, `RoleLayout`, `useOccReviewQueue` y `ShellFrameVariant`.

## Nota del 13 de noviembre de 2026: U4 «Pantalla de arranque del OCC»

U4 añade la pantalla de arranque del OCC que pidió el dueño (decisión 14). Vive en `src/features/admin-occ/boot/` y no reestructura ninguna pantalla. Fuera de esa carpeta y de las pruebas solo cambian cuatro archivos: el montaje en `src/app/RoleLayout.jsx`, una llamada en Panorama (`src/features/dashboard/DashboardRoute.jsx`), `src/features/auth/authService.js`, que borra la marca de la pantalla, y la lista `MIGRATED_FOLDERS` de `src/styles/occLegacyBridgeMap.js`. El código llegó en dos pasos: el orquestador con su proveedor (`4eda1303`) y el aspecto final, con las rutas que se trazan (`bcfd6fd7`). U4 llega antes que U3 a propósito: la interfaz que necesita está fijada en la sección 2.6 de la página de contratos del plan, y Panorama hace de consola hasta que U3 lo reemplace. El diseño del sistema visual es anterior a la decisión 14 y no tenía pantalla de arranque: la definen la página de contratos y el plan. Esta nota amplía las decisiones de arriba sin reescribirlas y dice dónde U4 se aparta del plan y del diseño; donde difieren, manda la página de contratos.

**1. Una pantalla por pestaña, por encima de las dos compuertas.**
- `RoleLayout` monta `OccBootProvider` (`boot/OccBootProvider.jsx`) solo con `role === 'adminOcc'`, por fuera de `ProtectedRole` y de `DepartmentAccessProvider` con su `AccessGate`. El layout del segmento `/admin-occ` lo monta una vez y sigue montado al cambiar de módulo, así que hay una sola pantalla por pestaña y sobrevive a las dos fases de carga.
- Las dos pantallas de carga siguen debajo, sin cambios: «Comprobando sesión…» y «Cargando permisos…», cada una con su `role="status"`.
- `OccBootAccessSignal`, que `RoleLayout` monta dentro de la compuerta de la sesión y del proveedor del acceso, junto a `AccessGate`, le dice al proveedor por un canal interno que la sesión se comprobó y que el acceso del departamento se cargó o falló. No dibuja nada.
- La raíz de la pantalla lleva `data-department="occ"`, así que pinta con los tokens del OCC aunque quede fuera de `ShellFrame`.
- *Por qué:* dentro de `AdminOccLayout` la pantalla aparecería solo después de los permisos, y una pantalla por compuerta se desmontaría entre una fase y la otra.
- *Descartado:* reemplazar las dos pantallas de carga, que usan las pruebas y el E2E del ciclo, y montarla también desde `AdminOccLayout`, como proponía el plan.

**2. Cuándo aparece.**
- Solo en la primera entrada al OCC de cada pestaña después de iniciar sesión, sea cual sea el módulo. Al decidir mostrarla, `boot/occBootSession.js` guarda la marca `elevant-occ-boot-seen` en `sessionStorage`, con el id de la cuenta. Con la marca de esa cuenta, la pantalla no vuelve al cambiar de módulo ni al recargar la pestaña; otra cuenta en la misma pestaña la vuelve a ver.
- `authService.js` borra la marca al iniciar sesión, al cerrar sesión y cuando la sesión termina por vencimiento o por un 401 que no se renueva. Renovar el token no la borra: es el mismo inicio de sesión.
- La marca es de la pestaña: una pestaña nueva con la sesión recordada («Recordarme») muestra la pantalla una vez más.
- Nunca aparece en el HTML del servidor ni en el render de la hidratación: el proveedor empieza oculto y decide en un efecto, cuando el cliente conoce la sesión. Tampoco aparece en otros departamentos, que no montan el proveedor, ni con una sesión de otro rol.
- Si el navegador no deja usar `sessionStorage`, la pantalla aparece en cada carga de la página. Las funciones de la marca nunca lanzan errores, y la marca no es una frontera de seguridad: solo decide si se muestra la pantalla.

**3. Qué espera y cómo cede.** `boot/occBootMachine.js` es un reductor puro con cinco fases: `hidden`, `waitingAccess`, `waitingReady`, `leaving` y `done`.
- Primero espera el acceso del departamento, sin límite de tiempo: sin acceso no hay marco que mostrar.
- Con el acceso cargado, espera el primer `markReady('console' | 'map')` o 6 s (`OCC_BOOT_READY_TIMEOUT_MS`), lo que llegue antes. Un aviso que llegó antes que el acceso cuenta en cuanto el acceso llega.
- Si el acceso falla, cede al instante, sin transición, y queda a la vista el error de `AccessGate`, con su `role="alert"`.
- Al salir pasa a `leaving` y, a los 400 ms (`OCC_BOOT_EXIT_MS`), a `done`: el proveedor la desmonta. Ese final lo marca un temporizador y no `transitionend`, para que llegue a tiempo aunque nada se anime, con movimiento reducido o con la pestaña oculta.
- La línea de progreso sigue al orquestador (`occBootProgress`): la sesión, el acceso y la espera de la primera pantalla, en la que avanza despacio durante los 6 s que puede durar; al salir se completa.
- *Por qué:* solo el acceso es obligatorio (plan). Si otra lectura tarda o falla, la consola se abre igual y muestra su propio estado de carga o de error.

**4. Quién avisa.** `useOccBoot()` (`boot/occBootContext.js`) devuelve `{ markReady }`, estable mientras vive el proveedor. Cuenta el primer aviso: repetirlo, o avisar con una fuente que no es `console` ni `map`, no hace nada. Fuera del proveedor (otros departamentos, el laboratorio de mapas, pantallas aisladas y pruebas) `markReady` no hace nada. Los contextos viven aparte del proveedor, así que quien avisa no importa ni el proveedor ni la pantalla.
- Hoy avisa solo Panorama: `DashboardRoute` llama `markReady('console')` cuando deja de cargar, con sus datos (aunque el día esté vacío) o con un estado de error, de sesión, de permiso o sin la estación PUJ.
- Según la página de contratos, U3 conservará esa llamada en la consola nueva y M4 añadirá `markReady('map')` en el motor de mapas. Hasta entonces, en los demás módulos la pantalla espera los 6 s completos después del acceso.

**5. Cómo se ve** (decisión 14, «al estilo de Alegra»; `boot/OccBootScreen.jsx` y `boot/OccBootScreen.module.css`).
- Al centro, el isotipo y el logo «ELEVANT · OCC», con una entrada corta (600 ms), y debajo una línea de progreso de 2 px. Sin listas, cifras ni adelantos de datos.
- El isotipo es `public/brand/elevant-mark-dark.png`, la marca blanca y naranja que ya muestra el riel. El proveedor lo pide desde el `<head>` del render del servidor (`preload` de `react-dom`), así la descarga empieza con la página y no espera a que la pantalla aparezca; una sola descarga sirve a la pantalla y al riel.
- El logo es texto en Manrope 600, con el espaciado abierto del logotipo oficial; «· OCC» va en el secundario (`--occ-muted`).
- Detrás, «rutas que se trazan»: ocho arcos SVG finos en `--occ-line-strong`, con opacidades de 0,26 a 0,4, que giran en sentido horario alrededor del logo sin tocarlo. Cada uno se traza desde su origen, se queda y se desvanece, en ciclos de 8 s con inicios escalonados. Los extremos que caen dentro del dibujo son aeropuertos: aparecen cuando la traza sale y cuando llega.
- Es una capa fija con `z-index: 90`, por encima de las capas del OCC (los toasts van en 70).
- Al salir, el fondo se desvanece en 380 ms y el bloque del logo en 240 ms, con una leve reducción. La consola, ya montada debajo, queda a la vista mientras el fondo se va.
- Con movimiento reducido, las rutas se dibujan enteras y quietas, el logo aparece sin moverse y solo avanza la línea de progreso. `occ.css` reduce a 0,01 ms todas las animaciones y transiciones del OCC; el módulo de la pantalla devuelve sus duraciones solo a la línea, con `!important`.
- Con colores forzados, las rutas desaparecen y la línea usa los colores del sistema.
- Pinta solo con tokens `--occ-*` del ámbito del OCC: sin colores hexadecimales ni `rgb()`, sin degradados, sombras ni desenfoque.

**6. Accesibilidad.**
- La pantalla es decorativa y lleva `aria-hidden`; no añade un segundo `role="status"` al de las compuertas.
- El avance se anuncia con un texto aparte, fuera del árbol oculto, con `aria-live="polite"`: «Preparando el centro de operaciones…» mientras espera y «Listo.» al salir («Preparing the operations center…» y «Ready.» en inglés). Un error de acceso no se anuncia: lo dice la alerta de `AccessGate`.
- El proveedor queda por encima del `LanguageScope` de `AdminOccLayout`, así que lee el idioma guardado como `AccessGate` (`boot/occBootMessages.js`, con `es` y `en`) y lo pone en el atributo `lang` del texto.

**7. Al salir, no estorba.** Desde el primer instante de `leaving`, la pantalla deja pasar los clics (`pointer-events: none`, en línea, para que ninguna hoja de estilos lo retrase), y a los 400 ms se desmonta. Mientras espera, en cambio, cubre la página y recibe los clics.

**8. Guardas.** `src/features/admin-occ/boot` entra en `MIGRATED_FOLDERS` (sección 4): allí no se admite ninguna clase de color heredada. En `occStyleGuard.test.js`, la guarda de `occ-ui` (sin desenfoque, sin degradados y sin modificadores de opacidad sobre `occ-*`) cubre también la carpeta de la pantalla, y una guarda nueva exige que su hoja de estilos lea solo tokens que define `[data-department='occ']`, sin colores propios, sombras, degradados ni desenfoque.

**9. Diferencias con el plan y el diseño.**
- *Sin precarga de datos.* El plan pedía precargar en paralelo el acceso, el tiempo real, la operación de hoy, el tráfico, el clima y la cartografía, y guardarlo en memoria para que la consola abriera sin esqueletos. La página de contratos fijó otra cosa: la pantalla espera a que la consola avise que tiene sus datos (`markReady`), o 6 s. La consola lee lo suyo debajo, como siempre, y nada se lee dos veces; `useOccResource` no tiene caché ni datos iniciales. Lo único que se adelanta es el isotipo.
- *Un solo montaje.* El plan la montaba desde `RoleLayout.jsx` y `AdminOccLayout.jsx`; la página de contratos, una sola vez en `RoleLayout`. `AdminOccLayout` no cambia.
- *El logo es texto.* La página de contratos señala `public/brand/` para el isotipo y el logo. Las piezas de esa carpeta traen «ELEVANT» con su lema, sobre blanco o sobre azul marino, y ninguna dice «ELEVANT · OCC»: el isotipo sale de ahí y el logo se escribe.
- *La consola no tiene entrada propia.* La página de contratos dice que el logo se desvanece mientras la consola aparece. La consola ya está montada debajo y aparece porque el fondo de la pantalla se desvanece encima de ella.
- *La marca se borra en más casos.* La página de contratos la borra al cerrar sesión. U4 también la borra al iniciar sesión y cuando la sesión vence o recibe un 401 que no se renueva, y guarda el id de la cuenta: así cada inicio de sesión la muestra una vez, aunque el anterior no haya cerrado bien.
- *Dos anuncios, fuera de la pantalla.* El texto `aria-live` va junto a la pantalla y no dentro, porque un texto dentro de un árbol con `aria-hidden` no se anuncia. Dice «Preparando…» y «Listo.», no cada etapa de la línea.
- *Excepciones al movimiento sobrio (sección 7) y al diseño B.5.* Por la decisión 14, esta es la única pantalla del OCC con un fondo en movimiento. Usa duraciones y fotogramas clave propios (600 ms de entrada, 400 ms de salida, ciclos de 8 s y los 6 s de la línea), no los 120 y 180 ms del diseño, y una capa, `z-index: 90`, por encima de las capas con nombre. Con movimiento reducido, su línea de progreso es la única transición CSS del OCC que conserva su duración por encima de la regla de `occ.css`, como pide la página de contratos.
- *El logo no es un rótulo.* «ELEVANT · OCC» va en mayúsculas espaciadas y con punto medio porque es el logo que pidió el dueño. La frase normal sin mayúsculas espaciadas (sección 7) y la regla de no unir textos con punto medio (diseño H.1) siguen valiendo para los rótulos.
- *Pruebas en la suite única.* El diseño I.1 proponía un script propio de capturas y una comprobación del primer pintado en la certificación de la imagen. La pantalla se prueba en el proyecto `occ` de la única configuración de Playwright (`playwright.occ.config.mjs`), a 1440×900 y a 1920×1080 y solo en oscuro, y la certificación no cambia. Las pruebas de Mapa de posiciones del mismo proyecto abren la página como una entrada posterior de la pestaña, como quien llega desde otro módulo: ponen la marca de la cuenta antes de cargarla, así que la pantalla no sale y su captura muestra el mapa. Fallan si la pantalla está encima cuando el mapa ya está listo.
- *Orden.* El plan ponía U4 después de U3. Se adelantó porque `markReady` no depende de la consola nueva.

**10. Límites.**
- *Primer pintado.* El pendiente de U1 queda cubierto solo en parte. La pantalla no está en el HTML del servidor: en la primera entrada, hasta que el cliente decide, se ve «Comprobando sesión…» sobre el azul marino de `body` (`#0A1220`), y en las entradas siguientes no hay pantalla de arranque.
- Mientras espera, la pantalla cubre la página: en un módulo que no avisa, hasta 6 s después del acceso. El E2E del ciclo inicia sesión como OCC muchas veces y abre módulos directamente: en cada primera entrada, sus clics esperan a que la pantalla se vaya.
- Si Panorama tarda más de 6 s, se abre con su estado de carga.

**Consecuencias de U4.**
- Para el OCC, la primera entrada de cada pestaña después de iniciar sesión pasa por la pantalla de arranque: lo que tarde el acceso y, como mucho, 6 s más. Las demás entradas no cambian.
- Los demás departamentos no cambian: `RoleLayout` solo envuelve al OCC, y borrar una marca que no existe no hace nada.
- Sin cambios fuera de AVIAM Web:
  - no cambian la API, el OpenAPI, el cliente compartido ni la base, y no hay migración;
  - no hay dependencias ni orígenes nuevos en el navegador: el isotipo es un archivo del propio sitio, y la CSP no cambia;
  - solo se despliega AVIAM Web.
- Ningún `data-testid` del OCC cambia, ni ningún texto, rol o nombre accesible que usen las pruebas o el E2E del ciclo. Se añade `occ-boot-screen`.
- Pruebas que cambian:
  - `RoleLayout.test.jsx`: las compuertas simuladas se dibujan como cajas para leer cómo se anidan; suma un caso y amplía el de los demás departamentos;
  - `DashboardRoute.test.jsx` suma dos casos: Panorama avisa con su primer dato, y enseguida cuando no tiene la estación PUJ;
  - `authService.test.js` suma tres: la renovación conserva la marca, y el cierre de sesión, un inicio de sesión nuevo, un 401 y el vencimiento la borran;
  - `occStyleGuard.test.js` amplía una guarda y suma otra.
- Pruebas nuevas:
  - en `admin-occ/boot/`: `occBootMachine`, `occBootSession`, `OccBootProvider` y `OccBootScreen`;
  - `tests/visualBootFixtures.test.js`, que valida las respuestas sintéticas de la suite visual con los validadores estrictos del cliente compartido;
  - en la suite visual, `tests/visual/occ/boot-screen.spec.mjs`, con `fixtures/bootApi.mjs`: la primera entrada a 1440×900 y a 1920×1080, la salida a los 6 s del acceso cuando nadie avisa, una recarga sin pantalla y el movimiento reducido. Como el resto de la suite, corre fuera del CI.

## Nota del 13 de noviembre de 2026: el mapa también avisa a la pantalla de arranque (PR M4)

Lo que la nota de U4 dejó para después ya está: al integrar U4, el PR M4 hace que el motor de mapas (`OccMap`) llame `useOccBoot().markReady('map')` cuando su mapa queda listo o sin cartografía (entonces se ve la lista de respaldo). Mapa de posiciones, Planificación y Monitoreo de vuelos ya no esperan los 6 s del tope. Panorama sigue avisando con `markReady('console')`, y la consola de U3 lo conservará. Los detalles están en la nota de M4 de [ADR-0043](0043-occ-maps-one-engine.md).

## Nota del 14 de noviembre de 2026: U3 «Consola del OCC con el mapa a pantalla completa»

U3 rehace Panorama (`/admin-occ/dashboard`): la consola del OCC es el mapa único a pantalla completa, con paneles que flotan encima y se pliegan. Vive en `src/features/dashboard/noc/`, sobre primitivas nuevas de `src/features/occ-ui/` y sobre los componentes del carril de mapas, que la consola monta sin cambiarlos. El código llegó en tres pasos: las primitivas (`94e60144`, con su revisión `de08535e`), las lecturas de la consola con su presupuesto (`582077b1`) y la consola sobre el mapa (`bc8bc5f5`). El diseño del sistema visual es anterior a la decisión 15 del dueño y dibujaba la consola como una cuadrícula fija (diseño D.2 y D.3); la sección 2.5 de la página de contratos del plan la redefinió. Esta nota amplía las decisiones de arriba sin reescribirlas y dice dónde U3 se aparta del diseño; donde difieren, manda la página de contratos.

**1. Un mapa a pantalla completa con paneles que se pliegan** (decisión 15; contratos 2.5).
- `noc/ConsolePage.jsx` monta `OccMap` bajo la barra de estado, abierto en la vista Rampa. Encima flotan «Tablero» (arriba a la izquierda), «Cifras de la jornada» (arriba al centro), «Alertas» (arriba a la derecha), el «Inspector» (debajo de «Alertas», solo con una selección) y «Posiciones» (a lo largo del borde inferior). Sobre «Posiciones» queda libre la fila del dock del carril de mapas: «Capas», el selector de vistas (Región, Aproximación, Aeródromo y Rampa) y «Leyenda», que en la consola abre plegada.
- `AdminOccLayout` pasa `mainVariant: 'fill'` (punto 9 de la nota de U2) solo en `/admin-occ/dashboard`: la consola llena el espacio sin margen ni desplazamiento. Los demás módulos siguen con `'scroll'`.
- Cada panel se pliega a una pastilla con su propio botón, que es su título, con `aria-expanded`. No hay teclas de panel (contratos 2.2). Cada pliegue se recuerda en la pestaña. Al abrir, «Posiciones» viene plegada; «Cifras de la jornada» también, por debajo de 1600 px, y por debajo de 1280 px también «Tablero» y «Alertas».
- «Ocultar paneles», bajo el mapa, escribe `focus=map` (contratos 2.1): queda solo el mapa, el mismo, sin crearse de nuevo, y «Mostrar paneles» los devuelve.
- Los paneles son hijos de `OccMap` pero nunca del contenedor de MapLibre, que movería el mapa con las flechas de la banda. Las teclas del mapa (sección 6) siguen activas, salvo con el diálogo de importación o el cajón de asignación abiertos.
- *Por qué:* un solo mapa y, por tanto, un solo contexto WebGL mientras el detalle del clima está cerrado (punto 8), donde el panorama anterior montaba tres mapas; el mapa es el protagonista de la presentación, que se hace en una laptop a 1080p (decisión 11). Los paneles casi opacos y sin desenfoque (`--occ-panel-float`) se leen sobre cualquier parte del mapa y no cuestan nada encima de WebGL.
- *Descartado:* la cuadrícula de áreas con nombre del diseño D.2 (escenario, columna lateral, franja de cifras y banda) con su `ConsoleLayout.module.css`, las reglas `nth-child` de la consola anterior y cualquier desenfoque detrás de los paneles.

**2. Las primitivas de `occ-ui`.** La consola es su primer usuario, y U5 y U6 rehacen las demás pantallas con ellas, así que cambian sin romper sus pruebas.
- `OccFloatingPanel.jsx`: una `section` nombrada por su título. El título es el botón que pliega o despliega el panel (`aria-expanded` y `aria-controls`). No es el único de la cabecera: abierto, la cabecera muestra además las acciones del panel (`actions`), como «Importar vuelos» en «Tablero», o la «Ventana de tiempo» («4 h», «8 h», «Día») y las «Posiciones que se muestran» («Con vuelos», «Todas») en «Posiciones». Plegado queda la cabecera, la pastilla; el cuerpo sigue montado y oculto, y `foldedSummary` se ve solo plegado y describe el botón. No responde a ninguna tecla propia ni es un diálogo. Tiene dos disposiciones: `float`, sobre el mapa, en `--occ-panel-float` y con el radio de lo superpuesto, y `grid`, el respaldo, en la losa del panel. La raíz lleva `data-occ-floating-panel` (su `panelId`), `data-folded` y `data-layout`, con los que la consola la mide.
- `occPanelMemory.js`: el pliegue de cada panel por su `panelId`, en `sessionStorage` (`elevant-occ-panel-folds`) y en memoria si el navegador no deja guardar. Ninguna de sus funciones lanza errores.
- `OccPanel.jsx`, con `OccRemoteView` y `panelStateOf(view)`: los cinco estados de una vista remota (carga; datos; vacío; error o tiempo agotado, con «Reintentar»; sin permiso o con la sesión vencida) y el dato viejo, atenuado bajo «La última actualización falló; se muestran los datos consultados a las {hora}.». Los textos son fijos, se reemplazan con `labels` y nunca vienen del servidor. El esqueleto (`OccSkeleton`) solo aparece en la primera carga. `panelStateOf` traduce la vista de `useOccResource`.
- `OccStatTile` y `OccStatList`: una cifra con su definición. Muestra «—» mientras su lectura no responde, nunca un cero que nadie contó; su tono de atención solo se enciende por encima de cero, y «≥» marca un conteo que la lectura cortó.
- `OccSegmented`: un grupo de botones con `aria-pressed` o, como `tablist`, pestañas con teclado. La cifra de cada segmento va en Manrope con cifras tabulares, porque un conteo no es un identificador.
- `OccFlightStrip`, con `flightStripName`: la tira de vuelo, con un orden fijo de campos (sentido, hora con «real», «est.» o «prog.», placa del vuelo, aeropuerto, posición o «Sin posición», estado y cuenta atrás), «Demo» y «est.», y un nombre accesible completo. Es un botón con `aria-pressed`.
- `OccTimeline`, con `occTimelineModel.js`: la banda en HTML, una fila por posición y cada visita un botón con su nombre completo. Lo planificado lleva contorno; lo estimado, trazos; lo que está en la posición, relleno; lo que salió, atenuado; un vuelo demo, rayas; un conflicto, su señal de atención o urgente (sección 1); y la línea «ahora» cruza la banda. Se recorre con las flechas, Inicio y Fin.
- `OccMilestoneStrip`, con `milestonePhases.js`: las cuatro fases del reporte de vuelo (`FLIGHT_REPORT_PHASES`), cada una con su avance («3 de 6»).
- `OccEmptyState`, `EstimatedTag` («est.») y `occTime.js` (horas y cuentas atrás en la zona de la estación), con sus textos en `occUiMessages.js`, en español y en inglés.
- `OccAlertQueue` (U2) suma la variante `panel`: la cola sin título ni «Avisos recientes», para el panel «Alertas».
- `occStyleGuard.test.js` prohíbe en `occ-ui` las sombras, las mayúsculas y el espaciado en los rótulos, el texto de menos de 12 px y los colores literales fuera de `occPalette.js`. `src/features/dashboard/noc` entra en `MIGRATED_FOLDERS` (sección 4).
- *Descartado por ahora:* `OccStatusPill`, `OccTag`, `OccButton`, `OccField`, `OccDataTable`, `OccToolbar`, `OccDialog` y `OccToast` del diseño F. La consola no los necesita; llegan con la pantalla que los use.

**3. Los datos: cada panel lee y falla por su cuenta** (contratos 2.5 y 2.7).
- `noc/useConsoleData.js` hace cuatro lecturas, cada una con su `useOccResource`, sus cinco estados y su último dato mientras relee: la planificación del día de la estación (sin enviar fecha: el día lo decide el servidor), el tablero de posiciones (el día de la estación según el reloj del servidor, nunca el del navegador), la cola de revisión y la disponibilidad de los agentes asignados (los que no pueden operar, regla 2-N25). La disponibilidad depende del día del plan: espera el día que contestó la planificación y vuelve a empezar con un día nuevo. Cada respuesta tiene que nombrar la estación pedida; si no, la lectura falla entera, con un texto fijo. Sin cuenta o sin el alcance PUJ no se lee nada, y la consola lo dice.
- Las lecturas y su ritmo están en una tabla, `noc/consoleReads.js` (`CONSOLE_READS`), que leen el hook y la prueba de presupuesto: cada una con su permiso (`operations.planning.read`, `operations.positions_map.read` u `operations.review.read`) y su sondeo de seguridad de 60 s, nunca con `occ_planning`. Solo la cola de revisión relee además con `occ_review`, como mucho una vez cada 3 s.
- El tablero sale de `useMapSituation`, del carril de mapas: la consola lo llama una sola vez y pasa lo mismo al mapa, al tablero, a la banda y al inspector. Son los mismos vuelos que dibuja el mapa, sin una segunda lectura de `occ/map/flights`; la planificación solo añade los agentes de cada escala y las escalas del día que la ventana del mapa deja fuera.
- La posición de una escala que traen los vuelos del mapa es la de ellos, que se releen con `occ_planning`, y no la de la planificación ni la del tablero de posiciones, que esperan su sondeo de 60 s: el tablero, «Sin recursos» (el filtro de «Escalas» y la cifra), «Pendientes de la jornada» y la banda dicen la misma posición, y la banda dibuja cada escala una sola vez, en esa posición. Si los vuelos del mapa la dan sin posición, la banda la deja en la fila en la que la lista el tablero de posiciones, como el mapa dibuja esa posición.
- Un avión está «En posición» por la regla de los estados de posición (sección 6; `aircraftOnStand`, en `boardModel.js`), la misma en el tablero, los pendientes y la banda: el instante de calzos del vuelo demo, el hito `BLOCK_ON` o la hora de calzos que escribe «Registrar llegada». El «Arrived» del proveedor y la hora de pista solo dicen que aterrizó.
  - **Actualización del 19 de noviembre de 2026 (hallazgo N23).** Las palabras también lo dicen. `bestTime` (`boardModel.js`) conserva el tipo que los vuelos del mapa dan a una hora real (`actualKind`: `Runway` u `OnBlock`), y una llegada cuya hora es la de pista lo dice, por decisión de Erick (D-N23): la cuenta atrás de su tira dice «aterrizó hace 8 min» y su pendiente, «WN9001 sin agente, aterrizó hace 8 min», nunca «llegó». Con la hora de «Registrar llegada», o con una que no dice su tipo, como la del snapshot de planificación, siguen «hace 8 min» y «llegó hace 8 min». La palabra de la hora de la tira sigue siendo «real», porque «aterrizó» no cabe en su columna. El servidor no cambia.
- Los avisos se leen una sola vez, en el marco (`useOccShell().notices`, punto 1 de la nota de U2): la consola los filtra a su estación sin ninguna petición, y «Recibido» es `notices.markRead(id)`, el recibo por cuenta.
- «Pendientes de la jornada» junta cuatro lecturas: la planificación (sin posición, sin agente), la disponibilidad de su día (un agente asignado que no puede operar), los vuelos del mapa (por importar, pasó su hora de salida) y la cola de revisión (por revisar). Cada una apaga solo lo suyo (`pendingCoverage`, en `pendingModel.js`): la que no respondió, falló, fue rechazada o muestra datos viejos deja una línea que lo dice («Cargando la cola de revisión…», «La consulta de la planificación del día falló.» con «Reintentar», «No tienes permiso para ver los vuelos del mapa.»), encima de lo que trajeron las demás, y «No hay pendientes.» se dice solo cuando respondieron todas. Un día sin escalas es una respuesta: no oculta el vuelo demo por importar, y «Cifras de la jornada» lo cuenta con ceros.
  - **Actualización del 19 de noviembre de 2026 (hallazgo N30).** Una operación demo seguía «en curso» ocho horas después de salir su avión, sin ningún aviso, y contaba en «En operación». Ahora una operación que sigue del lado del agente (`Assigned`, `InProgress` o `Returned`) más de 60 minutos después de que su avión dejó la posición es el pendiente `openAfterDeparture`, ámbar y sin acción, a la hora de esa salida: «ZZ9002 con la operación abierta, salió hace 1 h 5 min». El margen es el de Erick (D-N30), y la regla vive en `src/features/operations/openAfterDeparture.js`, que también usa Superadministración ([ADR-0041](0041-demo-flights-and-punta-cana-stands.md)). Cada escala del tablero (`boardModel.js`) suma `operationStatus` y `departedAt`: la primera prueba de la salida que dan sus vuelos del mapa (el `PUSHBACK`, la hora de una salida que despegó o el desbloqueo del reloj demo) y, para una escala que la ventana del mapa ya dejó fuera, la hora real de salida de la planificación. `PendingReview`, `InReview` y `Approved` no son pendientes, y un avión que sigue en su posición sigue siendo «pasó su hora de salida». «En operación» la sigue contando y lo dice debajo de su cifra, con el triángulo ámbar: «1 abierta tras la salida» (`openAfterDeparture` de `buildFigures`, solo entre las escalas que la cifra cuenta; `OccStatTile` suma `detail` y `detailTone`). El servidor no barre ni cierra nada, porque un barrido con aviso y recibo quedó fuera de este cambio: la entrega el agente o, si no puede, OCC la pasa a otro agente. Límites: una escala que OCC planificó a mano no recibe hora real de salida, así que, cuando sus vuelos salen de la ventana de dos horas de los vuelos del mapa, su `PUSHBACK` deja de verse y el pendiente desaparece. Y la consola solo lee el día de la estación (la planificación sin fecha) y los vuelos del mapa de las dos últimas horas: una operación que sigue abierta tras una salida de la noche sale de «En operación» y de su línea a la medianoche de la estación, y de Pendientes a esa medianoche o dos horas después de su salida si eso es más tarde, mientras no exista el barrido del servidor. La API no cambia.
- Un panel que la cuenta no puede leer dice «No tienes permiso para ver esta información.», el texto de `occ-ui`. Solo la planificación, que lee el día de la estación, conserva el del panorama anterior, «No hay una estación OCC autorizada para consultar este panorama.»: una cuenta sin `operations.positions_map.read` ya no lee en «Posiciones» que su estación no está autorizada.
- El clima es `useMdpcWeather`: el METAR de MDPC que el navegador lee de Iowa Environmental Mesonet, como antes de U3.
- Modelos puros, sin React y con sus pruebas, arman lo que se ve con la hora del servidor en milisegundos y la zona de la estación: el tablero (`boardModel.js`, que también da la clave con la que se elige un vuelo, `selectionIdOf`), las cifras (`consoleModel.js`), las alertas del panel (`consoleAlerts`, en `alertModel.js`), los pendientes (`pendingModel.js`), la banda (`standTimeline.js`), los hitos del inspector (`milestoneModel.js`), la llegada nueva (`newArrivals.js`) y las palabras del METAR (`weatherWords.js`).
- Los textos están en `noc/consoleMessages.js`, en español y en inglés, con una prueba de paridad de claves. Los textos de honestidad del panorama anterior se copian palabra por palabra.
- *Por qué:* hasta U3, un `403` o una lectura lenta dejaban todo Panorama sin datos o cargando; ahora cada panel muestra su propio estado. El tablero sale de los vuelos del mapa para que el mapa, el tablero y el inspector hablen del mismo vuelo con la misma clave.
- *Descartado:* las seis lecturas del diseño D.4, cada 25 s y con cada aviso; el tablero desde la planificación y el feed del proveedor (`getOccFlightFeed`, diseño G.1), que exige el permiso de planificación y recalcula el presupuesto de AeroDataBox en cada lectura; y una lectura más por incidencia para su severidad (aplazada en el punto 12 de la nota de U2).

**4. El presupuesto, con la consola real.**
- Una consola en reposo hace 16 peticiones por minuto, y 38 durante el minuto demo de la nota de U2 (punto 2): por debajo de 40 y de 70. En reposo son dos lecturas del cursor del marco, seis imágenes aéreas, una lectura de vuelos del mapa, una de planificación, una de posiciones, una de la cola, una de disponibilidad, una de avisos y dos latidos de presencia. El minuto demo suma ocho relecturas de vuelos (una por cada `occ_planning`), una de la cola con `occ_review`, dos de avisos y once lecturas del cursor, una por aviso.
- `noc/useConsoleData.budget.test.jsx` lo repite con los hooks reales: monta `useConsoleData` sobre adaptadores contados, `useMapSituation` sobre el adaptador simulado del mapa y las lecturas del marco; tras un minuto de calentamiento repite con relojes falsos el guion del minuto demo y falla por encima de 40 o de 70. Comprueba también que `occ_planning` solo relee los vuelos y que veinte toques de la tablet en diez segundos no cambian ninguna lectura propia de la consola.
- `admin-occ/live/occRequestPlan.js` suma la disponibilidad a la consola planificada y el archivo que hace cada lectura (`owner`), y `occRequestBudget.test.js` exige que el plan coincida con `CONSOLE_READS` y con `MAP_SITUATION_READS`, la tabla del mapa. La consola planificada pasa de 15 y 37 peticiones (nota de U2) a 16 y 38.
- La fila «U3» de la tabla de observadores de la nota de U2 (punto 2) queda cumplida: `dashboard/useDashboardData.js` se borró y salió de `OCC_OBSERVER_SITES`, y el sondeo de 120 s del tráfico regional (`dashboard/useRegionalTraffic.js`) salió de `OCC_SCREEN_POLLS`. Panorama ya no abre un observador propio. La pantalla más cargada del minuto demo pasa a ser Planificación, con 66 de 70, hasta U5.

**5. Lo que tapan los paneles, el respaldo y la llegada nueva.**
- `noc/useConsoleInsets.js` mide con un `ResizeObserver` la caja del mapa y cada panel flotante, y `noc/consoleInsets.js`, puro, convierte lo que tapan en los `insets` de `OccMap`. Un panel abierto toma su ancho del borde izquierdo o derecho, o su alto del superior o del inferior, más 8 px. Una pastilla solo toma alto, arriba o abajo, nunca de un costado. Dos márgenes opuestos que dejarían menos de 240 × 160 px de mapa ceden en proporción. Se vuelve a medir al plegar, cuando un panel crece, al cambiar la ventana y después de cada render de la consola, así que un panel que aparece, como el inspector, cuenta enseguida. Con esos márgenes el mapa encuadra sus vistas y coloca sus controles.
- *Lo elegido no queda debajo de un panel* (`noc/consoleCamera.js`, puro, y `ConsolePage.jsx`). Cuando cambian los márgenes, MapLibre cambia el relleno del mapa de un salto: lo dibujado se corre la mitad de lo que crece un margen, y un movimiento de cámara en curso se detiene. El inspector que se abre con la primera selección suma unos 400 px a la derecha cuando «Alertas» está plegada (al abrir, por debajo de 1280 px, o porque la persona la plegó). Por eso la consola mueve la cámara solo con los paneles ya medidos (`measured()`, de `useConsoleInsets`):
  - lo que pide al elegir algo espera a que la URL tenga esa selección y a que el inspector esté medido. Una tira, una escala o un pendiente vuelan a su vuelo, o a su posición si el mapa no dibuja su avión. Un clic en el mapa o una barra de la banda traen al centro del área libre lo elegido, si los paneles lo tapan, con el mismo acercamiento;
  - si después un panel se despliega o se pliega, o cambia la ventana, y eso tapa lo elegido que estaba a la vista, la consola lo trae otra vez al centro del área libre, con el mismo acercamiento. Lo que la persona sacó de la vista se queda donde lo dejó;
  - «a la vista» es el contorno de la posición, o el punto del avión, al menos 20 px dentro del área libre: el anillo de selección del avión mide 18 px más su trazo de 2 px. De un vuelo sin avión en el mapa cuenta su posición. Un avión de un vuelo de ELEVANT vuelve con `flyToFlight` y una posición con `flyToStand`; un avión de otro tráfico, con `jumpTo`, de un salto (punto 9).
- Sin nada elegido, la consola encuadra otra vez la vista inicial cuando cambia el área libre, mientras nadie haya movido la cámara.
- Si el motor informa que no puede dibujar (`unavailable`, por ejemplo sin WebGL2), el mapa deja en su lugar la lista de posiciones de respaldo y los mismos paneles se ordenan debajo, en una cuadrícula simple, en la losa del panel y sin medir nada.
- La pastilla «Llegada nueva: {vuelo}», con la placa «Demo», aparece arriba a la izquierda del área libre, sin pasar de los botones de zoom del mapa (a 1440 px se parte en dos líneas antes que tapar «Alertas»), cuando los vuelos del mapa traen una llegada demo activa que la consola no había visto (`newArrivals.js`). En la primera lectura, la de abrir la consola, recargarla o volver de otro módulo, anuncia la que todavía va hacia su posición según el reloj del servidor (antes de su `demo.onBlockAt`): Superadministración suele dispararla antes de que el OCC abra la consola, como en la guía de presentación. Una que ya está en su posición no es noticia. Después, anuncia la que aparece. Se anuncia como `status`. «Ver y seguir» escribe en la URL el vuelo (`flightId`, con su `flightKey`), `follow=1` y la vista que lo sigue según su fase actual (Aproximación, Aeródromo o Rampa), y cierra la pastilla, como «Cerrar». Con el vuelo en la URL y los paneles medidos, la cámara va a esa vista y, cuando el mapa se asienta, centra el avión del vuelo, si el mapa lo dibuja y nadie movió la cámara entretanto; si el mapa ya mostraba esa vista, va directo al avión. El avión de un vuelo demo se dibuja desde M6: hasta entonces, la cámara se queda en la vista. Una pastilla cerrada no vuelve en la pestaña: `noc/arrivalMemory.js` guarda las llegadas cerradas de la cuenta en `sessionStorage` (`elevant-occ-closed-arrivals`, como mucho 50) y en memoria si el navegador no deja guardar. Una que nadie tocó vuelve mientras su vuelo siga en camino.
- *Por qué:* el mapa necesita saber qué parte de él queda a la vista, y, si no hay mapa, los datos siguen a la vista (la regla del motor del [ADR-0043](0043-occ-maps-one-engine.md)). La pastilla no es un aviso de la campana: ese aviso pediría una migración, y el plan lo deja fuera.

**6. Lo que se borró**, cuando nada lo importaba:
- `dashboard/DashboardPage.jsx` y `dashboard/DashboardRoute.jsx`, con sus pruebas; la carpeta `dashboard/console/` (el panel común, el resumen, el contexto, las fuentes, el tablero de escalas, «Requiere atención», los avisos recientes, el mapa de rampa con su diálogo, el tráfico regional, la meteorología y `format.js`); `useDashboardData.js`, `useRegionalTraffic.js` y `dashboardMessages.js`, con sus pruebas; y `src/services/dashboardService.js`, con su prueba y su párrafo de `src/services/README.md`.
- Del carril de mapas, `maps/RegionalTrafficMap.jsx`, con `regional-map-container`, que la página de contratos (sección 3) asigna a U3 aunque viva en `src/features/maps/**`: su único usuario era el panel del tráfico regional. `maps/core/noSetStyle.test.js` ya no lo nombra entre los mapas viejos, y el comentario de `maps/basemapStyles.js` dice que solo lo usa `GoesCloudMap`. La nota de M2 en el [ADR-0043](0043-occ-maps-one-engine.md) queda como registro: decía que esos mapas seguirían hasta que U3 borrara el dashboard.
- En `src/styles/occ.css`, el bloque que disponía la consola anterior: 174 líneas, con las reglas `nth-child`. Con él se cierran dos pendientes de U1 (sección «Queda pendiente»): la disposición frágil de la consola y el tablero de escalas que pintaba en cian los estados planificados.
- Nada de lo que mostraba se pierde (diseño D.1): el tablero de escalas es la pestaña «Escalas», con los mismos filtros; «Requiere atención» es «Pendientes de la jornada»; el resumen es «Cifras de la jornada»; las alertas sin recibir están en «Alertas», y «Avisos recientes», en el cajón «Alertas y avisos» del marco; el mapa de rampa es el mapa único, y el detalle de meteorología se abre desde la píldora del clima. El mapa regional de OpenSky no tiene sucesor en la consola: el tráfico de la región es la imagen aérea del mapa único (A3 y M5), en la vista Región.
- Se quedan, porque otros los usan: `dashboardModel.js` (la clasificación de escalas que usan las cifras y los pendientes), `dashboardPositions.js` y `positionsData.js` (el catálogo de referencia de las posiciones), `mappers.js`, `statusMeta.js`, `usePreviewControls.js` y `dashboard/components/`.
- Las notas del Vault que citaban los archivos borrados o describían el panorama anterior, y el README de Private Web, se corrigen en el mismo PR.

**7. Diferencias con el diseño.** El diseño del sistema visual (secciones D, F, G, H e I) es anterior a varias decisiones del dueño y a la página de contratos, que mandan:
- *La disposición.* Mapa a pantalla completa con paneles flotantes (decisión 15, contratos 2.5) en lugar de la cuadrícula de D.2 y de las maquetas de D.3 para el puesto de trabajo, el muro 4K y la tableta. Las clases de la disposición son puras (`CONSOLE_OVERLAY_LAYOUT`, en `noc/ConsoleOverlay.jsx`), para que una prueba lea lo que jsdom no aplica, y el mapa coloca sus controles con sus propias variables (`occ-map.css`, del carril de mapas): no hay `ConsoleLayout.module.css` ni `occ-map-chrome.css`.
- *Las vistas.* Región, Aproximación, Aeródromo y Rampa (contratos 2.1 y 2.3), no «Rampa, Aeródromo, Región, Clima»; la consola abre en Rampa. El clima no es una vista: es una píldora bajo el mapa que abre su detalle.
- *La selección.* El almacén único del carril de mapas (`maps/core/useMapSelection.js`), con `flightId`, `stand`, `hex`, `view`, `follow` y `focus` (contratos 2.1): no hay `noc/selection.js`, `?sel=` ni `?wall=1`.
- *El inspector.* Un panel al costado, debajo de «Alertas» (contratos 2.5), y no en el lugar del tablero (D.1). Su contenido es del carril de mapas: el bloque de datos (`FlightDataBlock`) o los datos de la posición (`StandDetailFacts`), más `OccMilestoneStrip`.
- *El tablero.* Sale de los vuelos del mapa (`getOccMapFlights`) y no de la planificación con el feed del proveedor (G.1), y «Por importar» son las propuestas que esos vuelos ya traen. «Importar» abre el diálogo de importación sobre la consola, no `/admin-occ/planning?import=1`, y lo abre con el día entero, no ya en el vuelo de la tira. Su encabezado lleva la leyenda de lo que dibuja la pestaña a la vista (contratos 2.4, «Leyenda del tablero»): el triángulo de «Atención» y el octágono de «Urgente» con su palabra, y «Demo» y «est.» con lo que significan, en las palabras de «Leyenda» de la barra de estado; sin nada que explicar, no hay leyenda. Para eso `OccFloatingPanel` suma `legend`, una línea propia al pie del encabezado que solo se ve abierto.
- *Las lecturas.* Sondeo de 60 s y nunca con `occ_planning` (contratos 2.7), en lugar de 25 s y con cada aviso (D.4).
- *Los hitos.* Salen del campo `milestones` de los vuelos del mapa (contratos 1.3, ajuste 6 del plan), no de `getOccReviewDetail` después de la entrega ni de una lectura nueva de hitos (G.2).
- *Las alertas.* El panel muestra solo las alertas urgentes y de atención de la estación que la cuenta no recibió, y debajo «Pendientes de la jornada». Las alertas recibidas y los avisos simples quedan en el cajón «Alertas y avisos» del marco (U2), que abre la barra de estado.
- *La banda.* «4 h», «8 h», «Día» y «Con vuelos» o «Todas», con su leyenda en el encabezado (sección 5). No tiene «Ahora», ni tres alturas recordadas (`elevant-occ-console-layout`), ni desplazamiento de la ventana. Abre plegada y, plegada, dice las cifras del día y cuántas posiciones hay en cada estado (contratos 2.5).
- *Las cifras.* Siguen en un panel propio, arriba al centro, como pide la sección C del plan, aunque la página de contratos no las nombra; la pastilla de «Posiciones» repite las escalas y las que están en operación. «En operación» usa `isInOperation` (sección 6) y no solo el estado de la escala, y «Llegan en 60 min» sale de los vuelos del mapa.
- *Las pantallas estrechas.* Por debajo de 1280 px los paneles abren plegados sobre el mapa (sección C del plan), en lugar de las pestañas de H.3. No hay modo muro (decisión 11).
- *Sin «Ampliar mapa», «2D/3D» ni «Seguir» propios.* «Ocultar paneles» escribe `focus=map`. El selector de vistas, las capas y la leyenda son del carril de mapas; el seguimiento llega con M6, y el 2D/3D, con M7.
- *La translucidez.* `--occ-panel-float`, casi opaco y sin desenfoque (contratos 2.4).
- *La ruta.* `noc/ConsoleRoute.jsx` reemplaza a `DashboardRoute.jsx`, que el diseño conservaba. La página importa la ruta en su propio trozo, y la ruta carga `ConsolePage`, con el motor de mapas, con `next/dynamic` y sin render en el servidor. Así las lecturas salen enseguida y no esperan al código del mapa: con la ruta entera en un trozo dinámico, como Mapa de posiciones, la consola tardaba más de 6 s en `next dev` y la prueba de la pantalla de arranque fallaba.
- *La pantalla de arranque.* `ConsoleRoute` llama `markReady('console')` cuando la vista está en pantalla y llegaron sus primeros datos, los vuelos del mapa (o su lectura falló), o enseguida sin el alcance PUJ. El mapa de la consola recibe un `markReady` que no hace nada: su propio aviso (`markReady('map')`, PR M4) no termina la espera, para que la pantalla de arranque dé paso a una consola con datos (contratos 2.6). Lo que la nota de U4 dice de `DashboardRoute` vale ahora para `ConsoleRoute`.
- *Un texto de honestidad sin lugar.* «Asignación planificada; no confirma ocupación física.» sigue en `consoleMessages.js`, palabra por palabra y con su prueba, pero ningún panel lo muestra: el mapa ya no dibuja las asignaciones como siluetas, sino cada posición con los siete estados de la sección 6 y su leyenda.
- *Las pruebas.* La consola se fotografía en el proyecto `occ` de la única configuración de Playwright, a 1920×1080 y a 1440×900 y solo en oscuro, como la pantalla de arranque (punto 9 de la nota de U4); no hay un script propio de capturas. `DashboardPage.test.jsx` y `DashboardRoute.test.jsx` pasan a `ConsolePage.test.jsx` y `ConsoleRoute.test.jsx` con las mismas afirmaciones de honestidad y los mismos textos (I.2). Las pruebas de `useDashboardData` y de `dashboardService` se borran con sus archivos; lo que comprobaban lo comprueban ahora las de `useOccResource` y `useConsoleData`.
- *Los documentos.* No hay `docs/design/occ-noc.md` (contratos 4): este ADR y la nota del Vault de Private Web lo reemplazan.

**8. Lo que queda para otros.**
- *Seguir, 2D/3D y pausa (M6 y M7).* «Ver y seguir» ya escribe `follow=1` con el vuelo elegido, lleva la cámara a su vista y centra su avión cuando el mapa lo dibuja, pero el mapa todavía no sigue el vuelo. El seguimiento, «Pausar movimiento», los aviones estimados y demo en la capa de tráfico, la ruta del vuelo elegido hasta su posición y la barra de avance de las posiciones llegan con M6, y el 3D, con M7. La consola dibuja lo que dibuje `OccMap`: nunca dibuja aviones por su cuenta.
- *El clima y el satélite como capas (M8).* La píldora sigue leyendo el METAR de IEM desde el navegador, y su detalle monta `maps/GoesCloudMap.jsx`, un segundo mapa, pequeño, con el estilo publicado de OpenFreeMap, solo mientras está abierto. M8 pasa el clima a `occ/weather` y el satélite a una capa del mapa único.
- *Lo huérfano del carril de mapas.* `maps/AircraftSilhouetteIcon.jsx` ya no tiene quien lo importe, como tampoco `src/services/trafficService.js`, el cliente de `occ/traffic/aircraft`; la página de contratos no se los asigna a U3, así que los retiran su carril o el paso posterior que retire el endpoint viejo. `RegionalTrafficMap` sí se fue con U3 (punto 6). Cuando se vaya también `GoesCloudMap` sobrarán `maps/basemapStyles.js` y `maps/collapseCompactAttribution.js`.
- *La limpieza del puente.* Ninguna clase usa ya `bg-occ-panel-muted`, `bg-occ-panel/90` ni `bg-occ-panel/95`: el alias `--occ-panel-muted`, su llave de Tailwind y esa entrada del manifiesto del puente ya se pueden borrar, en la limpieza de U6.
- *La fuente «Vuelos del proveedor».* La nota de U2 (punto 4) la anunciaba con U3, pero la consola no lee el feed del proveedor: nadie la informa todavía.
- *Lo aplazado en U2* (punto 12): el acuse compartido por estación y la severidad de cada incidencia.

**9. Límites.**
- «Importar» abre el diálogo de importación con todo el día; no lo abre en el vuelo de la tira.
- Los conteos de «Alertas» son los de los 100 avisos más recientes que lee el marco (punto 13 de la nota de U2).
- Si los vuelos del mapa tardan más de 6 s después del acceso, la pantalla de arranque se va por su tope y la consola muestra sus estados de carga.
- Después de importar o asignar desde la consola, la propia pestaña relee una vez la planificación, las posiciones y la disponibilidad: el cambio es suyo. Los avisos del feed siguen sin releerlas. El cajón de asignación relee sus opciones, las incidencias y los agentes relevados solo con esos cambios propios, nunca con el sondeo de 60 s de la planificación: la lista de agentes no se vacía mientras OCC elige.
- Lo elegido vuelve al área libre cuando los paneles cambian el espacio, no cuando se mueve: un avión elegido que vuela hasta quedar debajo de un panel sigue ahí hasta que la persona mueva la cámara o el mapa lo siga con «Seguir» (M6).
- Un avión de otro tráfico, sin vuelo de ELEVANT, vuelve al área libre de un salto, sin animación: el mapa no tiene un centrado animado para él.
- El dibujo de las posiciones en el mapa (sus siete estados y sus señales) y las cuentas de «Posiciones» plegado salen del tablero de posiciones, con su sondeo de 60 s. Una escala movida o liberada en otra pantalla cambia enseguida en el tablero, en «Sin recursos» y en «Pendientes de la jornada», y en el mapa hasta un minuto después; la banda la lleva enseguida a su posición nueva, pero una escala liberada sigue en su fila hasta entonces.
- Las capturas se revisaron en local, con una API simulada; nada de esto acredita un despliegue ni una revisión visual en el VPS.

**Consecuencias de U3.**
- Para el OCC, Panorama es otra pantalla: abre el mapa en Rampa con sus paneles, y ya no muestra la franja de cifras, el mapa de rampa con sus dos mapas auxiliares ni la tabla de escalas. El tráfico de la región y los vuelos de ELEVANT se ven en el mismo mapa. Abrir Panorama, la primera pantalla del OCC, ya pide la imagen aérea: con el tráfico encendido, la API lee la red mientras la consola se ve y hasta 15 minutos después ([ADR-0042](0042-occ-air-picture-and-map-flights.md)).
- Los demás módulos y departamentos no cambian: solo Panorama llena el espacio sin margen.
- Sin cambios fuera de AVIAM Web:
  - no cambian la API, el OpenAPI, el cliente compartido ni la base, y no hay migración;
  - no hay dependencias ni orígenes nuevos en el navegador: la CSP no cambia, y la consola usa los orígenes que ya usaba Panorama (las teselas de OpenFreeMap, IEM y NASA GIBS);
  - solo se despliega AVIAM Web.
- Ningún `data-testid` del OCC que usen las pruebas cambia: se añade `occ-console-provenance`, y se retira `regional-map-container` con su mapa, que ninguna prueba usaba (contratos, sección 6). El E2E del ciclo pasa por Panorama al iniciar sesión como OCC, pero no usa sus textos, roles ni nombres accesibles.
- Nombres estables para las pruebas y para la guía de presentación: las regiones «Tablero», «Alertas», «Cifras de la jornada», «Posiciones» e «Inspector», cada una con su botón del mismo nombre y `aria-expanded`, el que la pliega (abierta, su cabecera tiene también sus acciones: un selector toma el botón por su nombre exacto, no por ser el de la cabecera); las pestañas «Llegadas», «Salidas» y «Escalas» de «Vista del tablero», cuyo nombre termina en su conteo («Llegadas 4»), y la lista «Leyenda del tablero»; «Importar vuelos» e «Importar {vuelo}»; «Recibido» y «Abrir»; la sección «Pendientes de la jornada»; la banda «Posiciones en el tiempo»; la pastilla «Llegada nueva: {vuelo}» con «Ver y seguir» y «Cerrar»; «Ocultar paneles» y «Mostrar paneles»; y la línea de procedencia (`occ-console-provenance`).
- Pruebas que cambian:
  - `occRequestBudget.test.js`: la consola planificada suma la disponibilidad (16 y 38 peticiones), su plan tiene que coincidir con las tablas de los dos hooks, y Panorama sale del inventario de observadores y de los sondeos de pantalla;
  - `AdminOccLayout.test.jsx` suma el marco que llena `main` solo en Panorama, y `occStyleGuard.test.js` acepta los dos marcos;
  - `occUiMessages.test.js` compara el aviso del dato viejo con el de `consoleMessages.js`;
  - `maps/core/noSetStyle.test.js` deja `GoesCloudMap.jsx` como único mapa viejo, sin `RegionalTrafficMap.jsx`;
  - `OccFloatingPanel.test.jsx` suma la leyenda del encabezado;
  - las pruebas de `occ-ui` de la primera parte ya no dejan avisos de `act()`;
  - en la suite visual, `boot-screen.spec.mjs` espera el panel «Tablero» con sus pestañas («Vista del tablero») en lugar de la región «Resumen operacional» del panorama anterior, y `fixtures/bootApi.mjs` responde las lecturas de la consola sobre `fixtures/consoleApi.mjs`; `tests/visualBootFixtures.test.js` sigue a esas respuestas.
- Pruebas nuevas:
  - en `occ-ui/`: las de las primitivas del punto 2;
  - en `dashboard/noc/`: las de los modelos, `consoleMessages`, `consoleFormat`, `consoleInsets`, `consoleCamera`, `useConsoleInsets` (su última medida), `ProvenanceLine`, `arrivalMemory`, `useConsoleData` con su presupuesto, `ConsolePage` y `ConsoleRoute`. `ConsolePage.test.jsx` comprueba también la pastilla de un vuelo demo que ya venía al abrir y que una cerrada no vuelve, los pendientes de cada lectura con la planificación vacía, rechazada o con la cola caída, el texto de permiso de un panel sin su permiso, la leyenda del tablero en cada pestaña, que el sondeo de la planificación no relee las opciones del cajón abierto y el aviso de agente liberado en español y en inglés. Con el MapLibre falso comprueba además lo elegido y los paneles (punto 5): una posición elegida en el mapa donde se abre el inspector vuelve al centro del área libre con el mismo acercamiento, y una que sigue a la vista no mueve la cámara; un panel desplegado sobre lo elegido lo trae de vuelta, pero no lo que la persona sacó de la vista; una tira elegida junto a «Alertas» plegada vuela a su vuelo después de medir el inspector; y «Ver y seguir» encuadra la vista que sigue el vuelo y después centra su avión, salvo que la persona mueva la cámara antes;
  - `tests/visualConsoleFixtures.test.js`, que valida las respuestas sintéticas de la consola con los validadores estrictos del cliente compartido;
  - en la suite visual, `tests/visual/occ/console.spec.mjs`, con `fixtures/consoleApi.mjs`: los paneles al abrir, plegados y abiertos, un vuelo y una posición elegidos, un vuelo demo que ya venía al abrir con la leyenda del tablero y el respaldo sin motor de mapa, a 1920×1080 y a 1440×900; una llegada demo con «Ver y seguir» y «Recibido»; y, con movimiento y a 1440×900, una tira elegida con «Alertas» plegada, cuyo avión queda a la vista junto al inspector (la leyenda del mapa, que solo nombra lo que queda a la vista, lo nombra). Como el resto de la suite, corre fuera del CI.

## Nota del 14 de noviembre de 2026: U6 «Resto de pantallas del OCC»

U6 rehace con las primitivas de `occ-ui` las ocho pantallas del OCC que no tienen mapa ni son de otro departamento: Revisión, Cobertura de posiciones, Notificaciones, Chat interno, Datos maestros, Tablets, Contratos listos y Reportes. Cambia cómo se ven y cómo se recorren, no lo que leen ni lo que escriben. El código llegó en cinco pasos: las primitivas de los registros (`5eb212ac`), Revisión (`fae769ea`), Cobertura y Notificaciones (`1219657d`), Chat, Datos maestros y Tablets (`87daab94`), y Contratos listos y Reportes con la limpieza del código muerto (`2be6c178`). La rama parte de la primera parte de U3, las primitivas de la consola (`94e60144`, con su revisión `de08535e`), y las usa sin cambiar la interfaz de ninguna. El diseño del sistema visual es anterior a varias decisiones del dueño, entre ellas la 16 (el OCC solo en oscuro). Esta nota amplía las decisiones de arriba sin reescribirlas y dice dónde U6 se aparta del diseño y de la página de contratos del plan; donde el diseño y la página de contratos difieren, manda la página de contratos.

**1. Dos plantillas para ocho pantallas** (diseño E.1 y E.2).
- La plantilla C, «Mesa de trabajo», es una barra con el título de la página y, desde 1280 px, la lista y el detalle lado a lado, cada uno con su propio desplazamiento. La usan Revisión, Cobertura de posiciones y Chat interno, y Notificaciones, que no tiene detalle: su historial ocupa el ancho.
- La plantilla D, «Registro», es una barra, una tabla densa y, si los hay, sus diálogos. La usan Datos maestros, Tablets, Contratos listos y Reportes.
- En las dos, `OccToolbar` dibuja el `h1` de la página. No hay antetítulo, ni párrafo bajo el título, ni la insignia de la estación (`OccStationBadge`): la estación vive en la barra de estado (nota de U2, punto 4), y lo que explica un módulo, en su estado vacío.
- Cada lectura muestra los cinco estados de `OccRemoteView` u `OccPanel`, de U3 (carga; datos; vacío; error recuperable, con «Reintentar»; y sin permiso o con la sesión vencida, sin «Reintentar»), con los textos de siempre en `labels`.

**2. Pantalla por pantalla.**
- **Revisión** (`review/CanonicalReviewRoute.jsx`, plantilla C).
  - La barra lleva el `h1` «Revisión OCC» y los filtros «Todas» (por defecto) y «Por revisar», con su cuenta. Debajo, las tres cifras («Pendientes visibles», «Entregas visibles» y «Estación») son `OccStatTile`.
  - La cola es una `OccDataTable` en el panel «Entregas»: el código de la operación en placa, la hora de envío en la zona de la estación, el estado con su glifo y su palabra y «Ver detalle» en cada fila; Enter también elige la fila. El tono de cada estado sale de `review/reviewStatusTone.js`: una entrega devuelta, y una revisión reabierta mientras espera su decisión, piden atención.
  - Si la API corta la cola en 100 entregas, la nota «Hay más entregas fuera de esta vista.» va bajo la lista, fuera de la tabla. Así sigue a la vista cuando «Por revisar» no deja filas, porque más allá de esas 100 puede haber entregas esperando.
  - Desde 1280 px, el «Detalle de entrega» queda acoplado a la derecha; por debajo se apila bajo la cola y se trae a la vista al elegir una entrega. La barra de decisión queda fija al pie del detalle.
  - La decisión, la reapertura y los cambios de recargos se confirman en `OccDialog`, dibujado dentro del detalle.
  - Los textos de «Formularios AVIAM» pasan al archivo de mensajes, con inglés.
- **Cobertura de posiciones** (`position-coverage/CoverageRoute.jsx`, plantilla C).
  - La barra lleva el título, la fecha y la navegación «Terminal y vista», con la terminal y la vista («Cobertura» o «Configuración») como `OccSegmented`.
  - En «Cobertura», el tablero «Posiciones de la terminal» es una `OccDataTable`: la posición en placa, «Puente» y «Estrecho» con glifo y palabra, quién la cubre y «Desactivada». «Coberturas del día» es una lista con placas, el horario en mono, el mentor, el vehículo y «Liberar».
  - Cada uno lleva su leyenda en la cabecera (`OccStatusLegend`, punto 8), porque un tablero con estados muestra su leyenda (sección 5). La leyenda «Atributos y estado», de «Posiciones de la terminal», muestra el círculo hueco de un atributo («Atributo») y el círculo tachado de «Desactivada». La leyenda «Tipo de cobertura», de «Coberturas del día», muestra el círculo hueco de «Refuerzo». Las pastillas y las leyendas toman el tono de cada marca de una sola tabla (`MARK_TONES`), así que dibujan las mismas formas.
  - El formulario «Asignar posiciones» queda a la derecha desde 1280 px, con `OccField`, las condiciones del agente como `OccStatusPill` (lo que bloquea, en atención) y «Asignar posiciones» como tecla clara.
  - En «Configuración», «Atributos de las posiciones» es una tabla de filas editables, cada una con su clave de intento y su versión, junto a «Reglas de la terminal» y «Posiciones combinadas». Los motivos de un rechazo van en una caja de atención.
  - Los textos pasan a `coverageMessages.js`, con inglés.
- **Notificaciones** (`notifications/CanonicalNotificationsRoute.jsx`, plantilla C, «Historial de avisos»).
  - La barra lleva el título, las secciones («Avisos» y «Servicios») y «Actualizar».
  - El panel «Historial de avisos» dice cuántos avisos siguen sin leer y muestra en su cabecera la leyenda «Prioridad», con el glifo y la palabra de cada prioridad: un tablero con estados muestra su leyenda (sección 5).
  - Los filtros «Todo», «Sin leer» y «Alertas» llevan su cuenta, filtran en el navegador y tienen cada uno su estado vacío.
  - Cada aviso lleva el glifo de su prioridad (la de la sección 1, con `alertPriority` de `dashboard/noc/alertModel.js`), con su palabra como nombre accesible, «Sin leer» hasta que la cuenta lo marque como leído, la placa de la operación y la fecha y la hora en mono, en la hora de Punta Cana. Una alerta sin leer se enciende con la losa tenue y la barra de 3 px de su señal, y el recibo la apaga, como en «Alertas y avisos». «Abrir», «Marcar leída» y «Marcar no leída» conservan su texto.
  - La pestaña «Servicios» sigue siendo `ServiceClosurePanel`, de Contratos (punto 6).
- **Chat interno** (`chat/CanonicalChatRoute.jsx`, plantilla C).
  - La barra lleva el título y el estado propio (`PresenceStatusPicker`).
  - «Conversaciones» y «Mensajes» son dos `OccPanel`, lado a lado desde 1280 px. Por debajo se ve uno a la vez: el hilo reemplaza la lista al elegir una operación, y el botón «Conversaciones», con el nombre accesible «Volver a las conversaciones», la devuelve.
  - La conversación abierta es la selección, dibujada con tokens: la losa cian tenue, la junta y el código en cian, con `aria-current`. Los mensajes sin leer se cuentan en una placa neutra, como en el riel, y las horas van en la hora de Punta Cana. La presencia está en el punto 3.
- **Datos maestros** (`master-data/MasterDataRoute.jsx`, plantilla D).
  - Bajo la barra, tres `OccPanel` («Terminales», «Posiciones» y «Tipos de avión»), cada uno con su `OccDataTable` de filas editables (una intención por fila, con su versión) y su formulario de alta con `OccField`.
  - Una fila inactiva se atenúa y lleva la pastilla «Inactiva» o «Inactivo». Cada posición tiene «Ver en el mapa» (punto 5).
  - Los textos pasan a `masterDataMessages.js`, con inglés.
- **Tablets** (`devices/DevicesRoute.jsx`, plantilla D).
  - El panel «Tablets de la estación» es una `OccDataTable`: la tablet, el agente, la última conexión y el estado con `OccStatusPill` («En uso», «Libre» o «Revocada», y «Operación en curso» en atención).
  - Liberar y revocar se confirman en `OccDialog`. Liberar empieza en su motivo, como antes; revocar, que no se deshace, es un `alertdialog` que empieza en «Cancelar».
  - Los textos pasan a `devicesMessages.js`, con inglés.
- **Contratos listos** (`ready-contracts/ReadyContractsRoute.jsx`, plantilla D).
  - El `h1` «Contratos listos para operar» nombra la sección (`ready-contracts-title`), la cuenta del día va en su línea con `role="status"`, y debajo está el campo «Fecha de operación».
  - Los contratos son una `OccDataTable` en lista, que conserva la lista «Contratos listos para operar» con un elemento por contrato: la aerolínea, el contrato con su versión, la vigencia («{desde} a {hasta}» o «Desde {desde}, sin fecha fin»), la renovación y los vuelos del día.
  - Cada fila muestra sus servicios debajo, a la vista al llegar, como los fotografía la guía de presentación (paso 15). «Servicios contratados (n)» los pliega y los vuelve a abrir, y una fila plegada sigue plegada mientras la página está abierta, también en otra fecha. El detalle está siempre montado y queda oculto mientras está plegado.
  - «Planificar vuelos» conserva su texto y su destino.
- **Reportes** (`reports/CanonicalReportsRoute.jsx`, plantilla D).
  - La barra «Reporte y período» lleva el formulario con «Generar», y debajo va la descripción del reporte elegido. Mientras llega la lista de reportes, en la primera lectura y al reintentarla, un esqueleto de dos líneas bajo la barra lo dice («Cargando reportes…»), y la lista «Reporte» y «Generar» esperan desactivados. La lista se puede reintentar si falla.
  - El resultado es un `OccPanel` con «Exportar Excel», «Exportar PDF» y «Exportar CSV» en su cabecera, la tabla densa (los números a la derecha, sin ordenar y sin columnas de más) y las páginas al pie. Desde 1280 px, las filas se desplazan dentro del panel.

**3. La presencia por forma** (diseño D28; sección 1).
- `chat/presenceStatus.js` exporta `PRESENCE_SHAPES` y `PRESENCE_LEGEND`. Cada presencia es un glifo neutro, sin tono, junto a su palabra:
  - «Disponible», lleno;
  - «Ocupado» y «No molestar», lleno con una barra;
  - «Ausente» y «Vuelvo enseguida», a medias;
  - «Desconectado», también quien eligió mostrarse desconectado, hueco;
  - sin información de presencia, a trazos.
- `PresenceDot` (`chat/PresencePeople.jsx`) dibuja el glifo en SVG, con `data-shape`, oculto para los lectores de pantalla, que leen la palabra. `PresenceLegend` lista las cinco formas con su palabra, bajo el título de «Conversaciones»: es la leyenda «Presencia».
- *Por qué:* «Ocupado» en rojo y «Disponible» en verde se distinguían solo por el tono; el rojo es la señal urgente del OCC y el verde no existe en su paleta.
- Las dos hojas del chat (`ChatWorkspace.module.css` y `PresencePeople.module.css`) pintan solo con tokens `--occ-*`: sin el azul `#145dc4` y sin los alias `--occ-ui-*`, sin sombras, con los radios por papel y sin texto de menos de 12 px. Por eso `occ.css` ya no repara el chat (sección 4, «Lo que repara `occ.css` fuera del puente»): sus dos reglas `[data-occ-chat-layout]` se borraron. Los alias `--occ-ui-*` siguen definidos, pero ninguna hoja los lee.

**4. La tira de hitos en el cierre de Revisión.**
- «Cierre de la operación» (`review/components/OperationCloseSection.jsx`) dibuja `OccMilestoneStrip` completa, bajo «Hitos del Reporte de Vuelo»: las cuatro fases con su avance («1 de 6») y los 25 hitos, cada uno con su hora en la zona de la estación o «Pendiente». Sin hitos, dice «Sin hitos registrados.».
- Las fases salen de `buildMilestonePhases` (`occ-ui/milestonePhases.js`) sobre `close.milestones`, que el detalle de la revisión ya traía: no hay lectura nueva.
- El exceso del paquete («Paquete excedido por {n} min») es una `OccStatusPill` de atención, con el triángulo.

**5. «Ver en el mapa» con `stand=`** (contratos 2.1). En Datos maestros, cada posición tiene el enlace «Ver en el mapa», con el nombre accesible «Ver {código} en el mapa», a `/admin-occ/positions-map?stand=<código>`. La consulta la arma `writeSelection` de `maps/core/mapSelection.js`, que normaliza el código. Es solo navegación: no lee nada.

**6. Lo que queda en el puente, y por qué.** Lo que estas pantallas montan pero también dibujan otros departamentos no se edita para el OCC (diseño E.3, regla 4):
- Usuarios (`DepartmentUsersPage`) y Mis gastos (`DepartmentExpensesPage`), que son de Gestión Humana y de Finanzas (diseño E.2).
- `ServiceClosurePanel` (`contracts/catalog/`), la pestaña «Servicios» de Notificaciones. Es de Contratos y conserva su observador mientras está abierta (nota de U2, punto 2).
- `OperationIncidentsPanel` (`src/features/incidents`), que Revisión muestra en el detalle y Planificación en el suyo.
- `notifications/components/*` y `DepartmentNotificationCenter`, que dibujan Gestión Humana, Finanzas, Contratos y la barra de `AppShell`. El ícono de Revisión que todavía usan, `XIcon`, queda solo en `review/components/icons.jsx`.
- Los componentes compartidos de `src/components/` (`Modal`, `StatusBadge`, `EmptyState` y los demás): las pantallas de U6 ya no los dibujan, pero Usuarios y los demás departamentos sí.
- `OccStationBadge`, en `admin-occ/OccQueueState.jsx`. El diseño lo convertía en la placa de la estación, pero ninguna pantalla lo dibuja ya, porque la estación está en la barra de estado. El archivo, con su `OccQueueState`, que ya nadie importaba, conserva sus clases heredadas y queda sin importadores hasta que se borre.
- Las correspondencias de clases del puente no cambian en U6, y tampoco la hoja que se genera con ellas (`occ-legacy-bridge.css`). Del manifiesto (`src/styles/occLegacyBridgeMap.js`) cambian solo las listas: suma carpetas a `MIGRATED_FOLDERS` y crea `MIGRATED_FILES` (punto 7). Las clases del puente las siguen usando el panorama anterior, hasta que U3 lo borre; Monitoreo de vuelos, Mapa de posiciones y Planificación, hasta U5; y las páginas compartidas.

**7. `MIGRATED_FOLDERS` y `MIGRATED_FILES`** (sección 4).
- Entran siete carpetas, cada una en el paso que la rehízo: `src/features/review`, `src/features/position-coverage`, `src/features/chat`, `src/features/master-data`, `src/features/devices`, `src/features/ready-contracts` y `src/features/reports`. Allí no se admite ninguna clase de color heredada.
- `src/features/notifications` no entra. Su ruta es del OCC, pero el resto de la carpeta lo dibujan otros departamentos, y la pestaña de servicios es de Contratos (punto 6). Por eso solo la ruta, `CanonicalNotificationsRoute.jsx`, entra en una lista nueva, `MIGRATED_FILES`, con la misma regla. Una prueba exige que cada archivo de la lista exista, esté montado bajo `/admin-occ`, no esté dentro de una carpeta migrada y no use clases heredadas, y que su carpeta todavía las use.
- Quedan fuera `src/features/incidents` y las páginas compartidas (punto 6).
- Dos guardas nuevas de `occStyleGuard.test.js`:
  - las siete carpetas y los archivos de `MIGRATED_FILES` dibujan como `occ-ui`: sin sombras, sin mayúsculas ni espaciado en los rótulos, sin texto de menos de 12 px, sin colores literales, sin desenfoque y sin degradados;
  - las hojas del chat (punto 3) no pintan colores fijos ni con nombre, sombras, alias `--occ-ui-*`, texto de menos de 12 px, radios fuera de su papel ni un anillo de foco propio. Reemplaza a la guarda que comprobaba que `occ.css` ganaba al azul del chat.

**8. Las primitivas nuevas de `occ-ui`** (diseño F). Siguen el modelo de U3: aceptan `className` y reenvían `data-testid`, sus vocabularios están congelados y lanzan `RangeError` ante un valor desconocido, pintan solo con tokens `occ-*` y sus textos están en `occUiMessages.js`, que suma las secciones `table` y `dialog` en español y en inglés.
- `OccDataTable`, el registro denso, en dos modos:
  - `as="table"`, por defecto: una tabla de verdad, con su `caption`, la cabecera fija, el orden por columna con `aria-sort`, filas de 32 px (44 px con puntero táctil) y, con `onSelectRow`, la elección con el ratón, Enter, Espacio y las flechas;
  - `as="list"`: una lista (`ul`, con un `li` por fila) sobre una cuadrícula de las mismas columnas, para los registros que las pruebas y el E2E del ciclo leen como lista. No ordena ni elige.

  En los dos, `mono` pone en IBM Plex Mono los identificadores y las horas y `align: 'end'` pone los números a la derecha; una fila encendida (`rowTone`: `attention` o `urgent`) lleva la losa tenue, la barra de 3 px y el glifo de su señal; una fila desplegable (`renderExpanded`) está siempre montada y oculta mientras está plegada; los cinco estados son los de `OccRemoteView`; y por debajo de 40 rem cada fila es una tarjeta apilada (`table-stack`).
- `OccToolbar`: el `h1` de la página, con un resumen opcional en su línea y, debajo, una barra con nombre (`role="toolbar"`), con los controles al inicio y las acciones al final. Sin controles no hay barra. `titleId`, opcional, da un id al `h1`, para que una sección se nombre con él.
- `OccButton` y `occButtonClass`: la tecla clara (`primary`, una por vista), `secondary`, `ghost` (texto cian) y `danger`, de 32 px con ratón (28 px en el tamaño `sm`) y 44 px con puntero táctil; ocupado, con `aria-busy` y su texto. `occButtonClass` viste como botón un enlace a otra pantalla.
  - Ocupado no se deshabilita: queda `aria-disabled`, conserva el foco e ignora el clic, Enter y Espacio. Un botón de envío tampoco envía su formulario, ni con Enter en uno de sus campos. *Por qué:* el navegador saca el foco de un control que se deshabilita y lo deja en la página. El teclado perdería su lugar y, en un `OccDialog`, Esc y la trampa del foco dejarían de funcionar si el comando falla y el diálogo sigue abierto.
  - Si recibe a la vez `busy` y `disabled`, manda `busy`.
- `OccField`, con `OccTextField`, `OccSelectField`, `OccTextareaField` y `occControlClass`: la etiqueta con el texto exacto (sin asterisco, porque las pruebas y el E2E buscan los campos por su nombre), una pista opcional y el error. El pozo del control es `--occ-field` (abajo, «`tailwind.config.js`»).
  - El error es un párrafo propio con `role="alert"` (`data-occ-field-error`), en el rojo del OCC.
  - No lleva la clase `form-validation-message`. *Por qué:* `app/layout.jsx` monta en todas las rutas el observador de `src/components/formValidation.js`, que borra cada mensaje de esa clase cuyo id no nombra ninguno de sus propios campos. Borraría el error de React, y React fallaría después al quitarlo.
- `OccDialog`: `dialog`, o `alertdialog` con `tone="danger"`, que empieza en «Cancelar». Se dibuja donde se monta, nunca en un portal: así una región como «Detalle de entrega» sigue conteniendo los botones que el E2E del ciclo busca en ella. Atrapa el foco y lo devuelve al cerrar; se cierra con su botón, con el velo o con Esc, que marca con `preventDefault` (contratos 2.2), y no se cierra mientras trabaja. Mientras trabaja, el foco sigue en su botón de confirmar ocupado (`OccButton`). Por debajo de 640 px es una hoja inferior.
- `OccStatusPill`: el estado de una fila, con su glifo y su palabra, en uno de los seis tonos de `STATUS_TONES` (`statusVocabulary.js`, que también exporta `OCC_STATUS_TONE_KEYS`):
  - `neutral`, un círculo hueco (planificado, programado, libre);
  - `active`, un círculo lleno (en operación, en uso);
  - `done`, una marca, en el secundario (completado, aprobado);
  - `muted`, un círculo tachado, en el tenue (cancelado, revocado);
  - `attention` y `urgent`, con el triángulo y el octágono de `SIGNALS`: son los únicos con losa.

  Admite las marcas «Demo» y «est.». Su glifo también se exporta solo, como `OccStatusGlyph`.
- `OccStatusLegend`: la leyenda de un tablero con estados, para su cabecera (sección 5). Es una lista con nombre (`label`) con una entrada por marca del tablero, en su orden, cada una con el glifo de su tono (`OccStatusGlyph`, el mismo de la pastilla) y su palabra, en el texto secundario, como la leyenda «Prioridad» de Notificaciones. Los glifos van ocultos para los lectores de pantalla, que leen las palabras.
- `classes.js` (`OCC_CLASSES`): las cadenas de clases que Cobertura, Datos maestros, Tablets, Contratos listos y Reportes definían por su cuenta, dibujadas con los tokens. Fueron el primer paso, mecánico, de su migración (diseño E.2).
- `occ.css` suma lo que la tabla necesita fuera de su JSX:
  - en las tarjetas apiladas, rótulos de 12 px en frase normal, altura libre, valores a la izquierda, el detalle plegado oculto y la señal de una fila encendida;
  - también en las tarjetas, la fila elegida, que si no perdería la losa de la tabla: su tarjeta y la de su detalle llevan la losa cian tenue y la junta cian. Como en la tabla, la losa de la elección gana a la de una señal, y una fila elegida y encendida conserva a la izquierda la barra de su señal;
  - el anillo de foco de una fila hacia adentro, para que no lo recorten el desplazamiento ni la cabecera fija;
  - y el mensaje de validación del sistema (`form-validation-message`) en el rojo del OCC.
- `tailwind.config.js`: `colors.occ` suma la llave `field`, para el pozo de `OccField`.
  - Esto corrige la sección «Decisión» de arriba, que cuenta `--occ-field` entre los tokens sin clase, y el punto 10 de la nota de U2.
  - Siguen sin llave, y por tanto sin clase, `--occ-arriving-fill`, `--occ-on-accent`, `--occ-on-warn`, `--occ-on-danger`, `--occ-warn-fill` y `--occ-danger-fill`.
- *No llegan* `OccTag` ni `OccToast` del diseño F, porque estas pantallas no los usan: «Demo» y «est.» ya son `DemoTag` y `EstimatedTag`, y los toasts del OCC los dibuja el marco (`OccToastStack`, nota de U2, punto 7).

**9. Las lecturas, los comandos y los textos no cambian de contrato.**
- Cada pantalla conserva sus lecturas y sus ritmos (contratos 2.7). Cobertura y Datos maestros releen con `occ_planning`; Tablets, con `mobile_devices`; Chat interno, con `operation_messages`, más sus sondeos de 10 s (mensajes), 20 s (conversaciones), 15 s (presencia de los participantes) y 30 s (presencia propia); y Notificaciones, con `notifications` y su sondeo de 20 s. Revisión sigue con `useOccReviewChangeVersion`, sobre el observador del marco.
- Las cinco pantallas de U6 que abrían un observador propio ya no lo abren (contratos 2.7). Escuchan sus recursos en el canal del marco (`useOccShellChannel().subscribe`), sobre el único observador de la pestaña: Cobertura de posiciones y Datos maestros, `occ_planning`; Tablets, `mobile_devices`; Chat interno, `operation_messages`; y Notificaciones, `notifications`. Releen como antes, en el acto y sin agrupar, y Notificaciones vuelve a empezar su sondeo de 20 s con cada aviso.
  - Toman la parte estable del marco, así que no se vuelven a pintar cuando cambian el enlace en vivo o los avisos. Solo se montan dentro del marco, que les da el canal. Notificaciones ya no mira la sesión para escuchar: el observador del marco solo observa con una cuenta válida.
  - El inventario de `admin-occ/live/occRequestPlan.js` las saca de `OCC_OBSERVER_SITES`, donde ya no queda ningún `movesIn: 'U6'`, y las nombra en `OCC_SHELL_LISTENERS`, con el sondeo de Notificaciones. La prueba de presupuesto sigue contando sus relecturas.
  - Sin el observador de la pantalla, la pestaña ya no lee el cursor una vez más con cada aviso y con cada sondeo de 25 s. Por minuto, Cobertura de posiciones y Datos maestros pasan de 7 a 5 peticiones en reposo y de 39 a 26 en el minuto demo; Tablets, de 7 a 5 y de 31 a 18; Chat interno, de 22 a 20 y de 46 a 33; y Notificaciones, de 12 a 10 y de 49 a 36. Las cifras de Notificaciones cuentan la pestaña «Servicios» abierta: `ServiceClosurePanel` es de Contratos y conserva su observador (punto 6).
- Los filtros filtran en el navegador y «Ver en el mapa» solo navega: no hay lecturas nuevas. De las cifras del presupuesto de la nota de U2 (punto 2) solo cambia la de Chat interno en reposo, que baja de 22 a 20 (punto anterior); sigue siendo la pantalla más cargada en reposo.
- Los comandos conservan su recibo de idempotencia: la clave de una intención (`createCommandKeyHolder`) se repite solo con el mismo cuerpo tras un resultado incierto, la versión esperada es la que está en pantalla, y un `409` o un `412` relee antes de formar otra intención.
- Los errores siguen saliendo en español de los servicios (`occReviewService.js`, `occMasterDataService.js`, `deviceProblemMessages.js`, `occCoverageService.js` y `operationalCommunicationService.js`). La interfaz nunca muestra el título del servidor, y U6 no crea códigos.
- Los textos que leen las pruebas, el E2E del ciclo y la guía de presentación del bloque Z se copiaron letra por letra. Cobertura, Datos maestros y Tablets, que no tenían archivo de mensajes, ganan el suyo, con inglés; las otras cinco pantallas ya eran bilingües. Los mensajes de Revisión, Cobertura, Datos maestros, Tablets, Contratos listos y Reportes tienen su prueba de paridad de claves, y la de Notificaciones va en la prueba de su ruta; los del chat no tienen una propia.

**10. La fila «U6» de «Lo que añadirán U2 a U6».** La tabla no cambia; esta nota la completa:
- «Cobertura, Revisión, Notificaciones, Chat, Datos maestros, Tablets, Contratos listos y Reportes con `occ-ui`»: hecho (puntos 1 a 5).
- «Limpia el código muerto»: se borraron `reports/components/ExportButton.jsx` con su prueba, y con ellos la carpeta `reports/components` y el `data-testid` `export-spinner`; los siete íconos sin uso de `review/components/icons.jsx`; las claves `close.source` de `reviewMessages.js`; y `getNotificationFilterOptions` de `notifications/notificationsMappers.js`. Queda `admin-occ/OccQueueState.jsx` (punto 6).
- «Deja el puente solo para las páginas compartidas»: todavía no. Sus correspondencias de clases no cambian (punto 6) y se podan cuando U3 y U5 hayan rehecho lo suyo, junto con la limpieza del puente que la nota de U3 deja para U6: el alias `--occ-panel-muted`, su llave de Tailwind y la entrada de `bg-occ-panel/90` y `bg-occ-panel/95`. En esta rama, el panorama anterior todavía usa esas clases.

**11. Diferencias con el diseño y con la página de contratos.** El diseño (secciones E, F, H e I) es anterior a varias decisiones del dueño y a la página de contratos, que mandan:
- *Los dos temas, a dos anchos.* Al cerrarse, U6 era solo oscuro (decisión 16). La nota del 15 de noviembre revierte esa decisión, y al unirse con ella las ocho pantallas y las primitivas de `occ-ui` que U6 añade se leen en los dos temas: pintan solo con los tokens `--occ-*`, sin colores escritos a mano, así que el bloque claro de `occ.css` las cubre sin reglas propias. Las capturas se toman en oscuro y, con `OCC_VISUAL_THEME=light`, en claro, a 1920×1080 y a 1440×900, y las del chat también a 1024×768: no hay capturas a 1366×768 ni a 768×1024 (diseño I.1). Se toman en el proyecto `occ` de la única configuración de Playwright, con una sesión sintética y la API simulada, y no con un script propio (D29).
- *En el canal del marco, no en `useOccResource`.* La página de contratos (2.7) pasa cada pantalla al observador del marco en el PR que la rehace, y la nota de U2 (puntos 2 y 3) le asignaba a U6 Cobertura de posiciones, Datos maestros, Tablets, Chat interno y Notificaciones, con `useOccResource`.
  - U6 pasa las cinco al observador del marco, como pide la página de contratos: escuchan en su canal (punto 9), y ninguna sigue con un observador propio.
  - No las lleva a `useOccResource`, como pedía la nota de U2 (punto 3). El hook lee solo con el permiso de `useDepartmentAccess()`, agrupa los avisos (como mucho una lectura cada 3 s) y deja de escuchar tras un 401 o un 403, y cada pantalla conserva sus lecturas y sus ritmos (contratos 2.7).
- *El chat no llena el alto.* La nota de U2 (punto 9) pedía pasar Chat interno a `mainVariant: 'fill'` al rehacerlo. Sigue en `'scroll'`, con el margen de `main`: su sección mide el alto que queda, y cada panel se desplaza solo. `AdminOccLayout`, que elige la variante, no cambia en U6.
- *El corte a 1280 px.* El diseño (H.3) apila la lista y el detalle entre 1024 y 1279 px y los separa en dos vistas por debajo de 1024. El chat muestra una vista a la vez por debajo de 1280 px; Revisión y Cobertura apilan el detalle bajo la lista a cualquier ancho menor.
- *`OccStatusPill`* recibe `tone` y `label`, no `domain` y `status`: cada pantalla traduce sus estados a un tono (`review/reviewStatusTone.js`, o `DEVICE_STATUS_TONES` en Tablets). El tono que el diseño B.4 llama `critical` es `urgent`, como en `SIGNALS` y en `OccStatTile`.
- *`OccStatusLegend`* no está en el diseño F, y su fila de Cobertura (E.2) no pide leyenda. La pide la regla de la página de contratos (2.4), a pedido del dueño: cada tablero con estados muestra su leyenda en la cabecera (punto 2).
- *`OccDataTable`* suma el modo lista, la fila desplegable y los estados remotos, y no tiene `density`: las filas miden 32 px con ratón y 44 px con puntero táctil (H.2). Contratos listos no es una tabla con una fila desplegable (E.2), sino una lista con un botón que pliega y despliega los servicios de cada contrato, porque las pruebas y el E2E del ciclo la leen como lista. Los servicios empiezan a la vista: la guía de presentación del bloque Z los promete en su paso 15 sin pulsar nada.
- *La fila elegida* de `OccDataTable`, en la tabla y en la tarjeta, lleva la losa cian tenue (`--occ-accent-soft`), como la conversación abierta del chat: cian es lo elegido (contratos 2.4). No lleva `--occ-panel-raised`, que la tabla de tokens de la sección «Decisión» y el diseño (B.2) le daban.
- *`OccDialog`* se dibuja en su sitio y no en un portal (punto 8).
- *Las alturas* no usan `--occ-control-h` ni una variante `coarse:` (B.5): son `h-8` y `[@media(pointer:coarse)]:h-11`.
- *Una quinta forma de presencia,* a trazos, para la falta de información; D28 tenía cuatro.
- *Reportes* pone sus exportaciones en la cabecera del resultado, no en la barra, y no ordena columnas.
- *Los íconos* (D24) no se unen en un solo juego: U6 solo quita los que Revisión ya no usaba, y los juegos de cada carpeta siguen.
- *El puente* no se reduce a las páginas compartidas (plan, bloque U6; diseño J): ver el punto 10.
- *`?sel=stand:`* (diseño E.2) es `stand=` (contratos 2.1).
- *`OccStationBadge`* no pasa a ser la placa de la estación: sale de las pantallas (punto 6).
- *Los estados fotografiados* son los que tiene la prueba visual de cada pantalla (consecuencias). Del diseño I.1 faltan la pestaña «Servicios» de Notificaciones, que es de Contratos, y el diálogo de Datos maestros, Contratos listos y Reportes, que no tienen diálogos.

**12. Límites.**
- La pestaña «Servicios» de Notificaciones (`ServiceClosurePanel`, de Contratos) abre su propio observador, con dos hubs y su sondeo, mientras está abierta (punto 6).
- `OperationIncidentsPanel` y `ServiceClosurePanel` se ven con el puente dentro de pantallas ya rehechas: conservan su disposición, con los colores de los tokens.
- `admin-occ/OccQueueState.jsx` queda sin importadores y con clases heredadas, y los alias `--occ-ui-*` quedan definidos sin uso, hasta su limpieza.
- Usuarios y Mis gastos siguen con el puente, que no cambia el tamaño del texto ni las mayúsculas (sección 4, «Lo que el puente no hace»).
- Las capturas se revisaron en local, con una API simulada. Nada de esto acredita un despliegue ni una revisión visual en el VPS.

**Consecuencias de U6.**
- Para el OCC, las ocho pantallas se leen como la consola: losas planas, placas para los identificadores, estados con glifo y palabra, el `h1` en la barra y sin subtítulos ni la insignia de la estación. Su texto ya no baja de 12 px ni usa rótulos en mayúsculas (sección 7), y una guarda lo exige (punto 7). Chat interno ya no pinta la presencia en verde y rojo, y Revisión deja de pedir desplazarse entre la cola y el detalle desde 1280 px.
- Los demás departamentos no cambian: los componentes compartidos y las carpetas que dibujan siguen igual (punto 6).
- Sin cambios fuera de AVIAM Web:
  - no cambian la API, el OpenAPI, el cliente compartido ni la base, y no hay migración;
  - no hay dependencias ni orígenes nuevos en el navegador, así que la CSP no cambia;
  - solo se despliega AVIAM Web.
- Ningún `data-testid` de las pantallas cambia ni se añade; con `ExportButton` desaparece `export-spinner`, que solo usaba su propia prueba. Se conservan los textos, roles y nombres accesibles que usan el E2E del ciclo (`fase2-preoperacion.spec.ts`, `fase3-operacion.spec.ts` y `demo-vuelo.spec.ts`) y la guía de presentación del bloque Z.
- Pruebas que cambian:
  - `CoverageRoute.test.jsx`: las filas de «Atributos de las posiciones» se buscan con `closest('tr')`, porque ya son filas de tabla, y el estado sin permiso ya no es `role="alert"`;
  - `MasterDataRoute.test.jsx`: las filas editables también se buscan con `closest('tr')`;
  - `CoverageRoute.test.jsx`, `MasterDataRoute.test.jsx`, `DevicesRoute.test.jsx`, `CanonicalChatRoute.test.jsx`, `CanonicalNotificationsRoute.test.jsx` y `admin-occ/CanonicalReadRoutes.test.jsx` dibujan esas rutas dentro del marco (`OccShellTestProvider`; la prueba del recibo de Notificaciones ya montaba el `OccShellProvider` de verdad), y los casos de `CanonicalReadRoutes.test.jsx` en que el chat y Notificaciones releen con el feed anuncian por el canal del marco y no por un observador propio;
  - `occRequestBudget.test.js`: la lista de observadores que quedan pierde las cinco pantallas de U6, y el minuto de cada pantalla cuenta también las relecturas y el sondeo de `OCC_SHELL_LISTENERS`;
  - `OperationCloseSection.test.jsx`: el hito «Bloqueo · {hora}» pasa a la tira de hitos, con «Bloqueo», su hora y «1 de 6», y el exceso del paquete se lee en su pastilla de atención;
  - `review/components/icons.test.jsx` prueba solo `XIcon`;
  - `occUiMessages.test.js` suma las secciones `table` y `dialog`, y `statusVocabulary.test.js`, los tonos de estado;
  - `occStyleGuard.test.js` cambia la guarda del azul del chat por la de sus hojas, y suma las de las tarjetas apiladas (con la fila elegida), del foco de fila y del mensaje de validación, de `MIGRATED_FILES` y de las pantallas rehechas;
  - las pruebas de las ocho rutas suman casos de la disposición, del inglés y de los estados; fuera de los cambios de esta lista, conservan los que ya tenían;
  - se borra `ExportButton.test.jsx`.
- Pruebas nuevas:
  - en `occ-ui/`: `OccDataTable`, `OccToolbar`, `OccButton`, `OccField`, `OccDialog`, `OccStatusPill`, `OccStatusLegend` y `classes`;
  - la paridad de los mensajes de Revisión, Cobertura, Datos maestros, Tablets, Contratos listos y Reportes, y `review/reviewStatusTone.test.js`;
  - en las pruebas de Cobertura de posiciones, Datos maestros, Tablets, Chat interno y Notificaciones, un caso por pantalla: escucha solo su recurso en el canal del marco, relee con su anuncio y no con el de otro módulo, no abre un observador y deja de escuchar al salir; y en `occRequestBudget.test.js`, la prueba de `OCC_SHELL_LISTENERS`, que exige que estén las cinco, que no quede ningún `movesIn: 'U6'` y que cada una tome el canal, nombre sus recursos y su sondeo, no abra un observador y siga contando sus relecturas;
  - `tests/visualScreensFixtures.test.js`, que valida las respuestas sintéticas de las pantallas con los validadores estrictos del cliente compartido;
  - en la suite visual, ocho pruebas en `tests/visual/occ/` (`review`, `coverage`, `notifications`, `chat`, `master-data`, `devices`, `contracts` y `reports`), sobre `occScreen.mjs` y `fixtures/screensApi.mjs`: los datos, el vacío, el error o la falta de permiso y los diálogos de cada pantalla, a 1920×1080 y a 1440×900, y el chat en su ancho estrecho, a 1024×768. Revisión suma la operación que sigue en rampa sin entrega, con su panel de incidencias dentro del detalle acoplado, y la revisión reabierta; Reportes, la primera carga de su lista de reportes, y Contratos listos, una fila plegada. La sesión sintética es la de un administrador del OCC, que también gestiona incidencias. Como el resto de la suite, corre fuera del CI.

## Nota del 15 de noviembre de 2026: el OCC vuelve a tener tema claro, oscuro por defecto

El dueño lo pidió para la presentación del 16 de noviembre. Esta nota revierte la decisión de U1 «solo oscuro, sin botón de tema» (`91cc9675`); el resto del sistema visual no cambia.

- *Estado del tema.* El OCC usa el mismo tema guardado que los demás departamentos (`elevant-theme`). Si no hay nada guardado, el OCC es oscuro y los demás departamentos siguen la preferencia del sistema. Solo se guarda una elección explícita (`toggleTheme`): el tema por defecto nunca se escribe. El script de arranque de `app/layout.jsx` (`occThemeBootScript`) lee el tema guardado y, en las rutas del OCC, pone o quita la clase `dark` antes del primer pintado. Si el navegador bloquea el almacenamiento, el OCC queda oscuro. La CSP no cambia.
- *Botón.* La barra de estado vuelve a tener un botón de tema desde 1024 px. Es un botón de icono que se llama «Cambiar a tema claro» o «Cambiar a tema oscuro» («Switch to light theme» y «Switch to dark theme» en inglés). Por debajo de 1024 px está en el menú de la cuenta, junto al idioma y la leyenda (`statusBarLayout.js`: `theme`).
- *Tokens.* El bloque oscuro de `occ.css` queda igual. Un bloque claro con cada token de color `--occ-*` se aplica bajo `:root:not(.dark) [data-department='occ']`, con `color-scheme: light`. Pizarra clara: fondo `#E9EEF1`, paneles `#FFFFFF`, losas `#E4EAED`, riel `#E3E9EC`, texto `#11181C`, cian `#054E66`, ámbar `#634000` para textos y `#F2B340` como relleno, y rojo `#B0241A` para textos y `#C62F24` como relleno. Los dos temas cumplen los mismos mínimos de contraste: 10:1 para el texto principal, 7:1 para el secundario, el cian y el ámbar sobre las superficies, 4.5:1 para cualquier otro texto y 3:1 para los bordes de control. `occPalette.test.js` y `occStyleGuard.test.js` los comprueban por tema. El puente de clases heredadas pinta con los tokens, así que sigue el tema sin cambios.
- *Paletas en JavaScript.* `occPalette.js` exporta `OCC_PALETTES = { dark, light }`, `occPaletteFor(theme)` y `occColor(token, theme)`. `OCC_PALETTE` sigue siendo la paleta oscura, para quien ya la lee. `occThemeColor(value, theme)` lleva un color de la paleta oscura al mismo token del tema. Cuando dos tokens oscuros tienen el mismo valor, gana el primero de la paleta, salvo el ámbar y el rojo, que en el mapa se leen como rellenos.
- *Mapa.* `mapTheme.js` añade un mapa base claro: tierra clara, mar azul claro, pavimento más oscuro que la tierra y etiquetas oscuras con halo claro. Al unirse con M6, sus valores salen de la paleta `light` de `mapColors.js` (tierra `#EEF1F3`, mar `#B0D0EE`) y las capas de M6 (altitud, aeropuertos, rellenos de posición) toman la paleta del tema: ver la actualización del 15 de noviembre de 2026 en el [ADR-0043](0043-occ-maps-one-engine.md). `buildOccStyle({ theme })` usa los colores base del tema. Las capas superpuestas siguen escritas con la paleta oscura, y el estilo cambia cada color suyo por el mismo token del tema: pinturas, colores de las etiquetas con formato y las estelas `rgba()`. `createImageResolver({ theme })` hace lo mismo con las imágenes planas. Así, las capas de tráfico y de posiciones no cambian. Las muestras del aeródromo de la leyenda usan el mapa base del tema.
- *Sin `setStyle`.* El contrato 2.4 sigue en pie: el estilo nunca se cambia después de crear el mapa. Cuando cambia el tema, `OccMap` vuelve a crear el mapa: el componente lleva el tema como clave, y el mapa nuevo abre con la cámara que tenía el anterior (se lee antes de destruirlo). La selección vive en la URL y se mantiene. `OccMap` cubre los mapas de Mapa de posiciones, Monitoreo de vuelos y Planificación. Planificación ya no fija `theme="dark"`.
- *Límite.* Hasta esta nota, los demás departamentos guardaban el tema resuelto al montar. Un navegador que ya tiene `elevant-theme=light` guardado así abre el OCC en claro, y basta un clic para volver a oscuro.
- *Pruebas.* Cambian `useTheme.test.jsx`, `occTheme.test.js`, `root-layout.test.jsx`, `OccTopbar.test.jsx`, `statusBarLayout.test.js`, `DevPreviewPanel.test.jsx`, `occPalette.test.js`, `occStyleGuard.test.js`, `mapTheme.test.js`, `occStyle.test.js` y `noSetStyle.test.js`. Hay dos pruebas nuevas: `occStyleTheme.test.js`, que comprueba que ninguna capa del OCC pinta en claro un color que solo existe en el tema oscuro, y `OccMap.theme.test.jsx`, que comprueba que el mapa se vuelve a crear sin `setStyle` y conserva la cámara.

## Nota del 16 de noviembre de 2026: U5 «Pantallas de mapa del OCC»

U5 rehace con las primitivas de `occ-ui` las tres pantallas del OCC que trabajan sobre un mapa: Monitoreo de vuelos, Mapa de posiciones y Planificación. Cambia cómo se ven y cómo se recorren; no cambia la API, ni lo que leen, ni su cadencia, ni sus comandos. El código llegó en tres pasos, Monitoreo de vuelos (`10e0fb82`), Mapa de posiciones (`5d0e24ad`) y Planificación (`87fd5186`), después de unir Development (consola, M4 a M8, tema claro) y U6. Los mapas son del carril de mapas (`FlightMap.jsx`, `PositionMap.jsx`, `PlanningMap.jsx`, `maps/**`): U5 los aloja con las mismas props y no los edita. Donde el diseño y la página de contratos difieren, manda la página de contratos; esta nota amplía las decisiones de arriba sin reescribirlas. Las tres pantallas funcionan en los dos temas: solo pintan con tokens `--occ-*`.

**1. Dos plantillas** (diseño E.1 y E.2).
- La plantilla B, «Mapa de trabajo», es el mapa a toda la altura con una lista a la izquierda y el inspector del elemento elegido acoplado, nunca encima del mapa: así no tapa el avión ni la posición elegidos y el mapa no necesita márgenes. La usan Monitoreo de vuelos y Mapa de posiciones. Sus rutas ocupan el alto del marco, así que la página no se desplaza.
- La plantilla C, «Mesa de trabajo», es la barra con el título y la página debajo. La usa Planificación.
- Una sola selección, la de la URL (contratos 2.1, `useMapSelection`): `flightId` y `hex` en Monitoreo; `stand`, `flightId` y `hex` en Mapa de posiciones. La lista, la banda y el mapa leen y escriben la misma.

**2. Pantalla por pantalla.**
- **Monitoreo de vuelos** (`flight-monitoring/FlightMonitoringPage.jsx`).
  - «Tablero de vuelos» es una lista de tiras (`OccFlightStrip`) con «Llegadas», «Salidas» y «Todos» con su cuenta, la búsqueda, la leyenda del tablero en la cabecera y los estados remotos de `OccPanel`. El modelo puro es `flightBoardModel.js`, con las palabras de estado de la consola. Cada tira conserva `flight-list-item`; el mapa conserva `flight-map-container`.
  - El inspector del vuelo (`components/FlightInspector.jsx`, un `aside` sin velo ni trampa de foco) muestra las horas programada, estimada y real, la posición, el avión, la matrícula, los agentes, los servicios, la tira de hitos de su operación y enlaces a Planificación y a Mapa de posiciones que conservan `stationId`. Los hitos salen de los vuelos del mapa que `FlightMap` ya lee: su nueva prop `onSelectionFlights({ flight, flights })` le da a la página el vuelo elegido tal como lo conocen y esos vuelos, después de cada lectura, sin una lectura más de `occ/map/flights` (contratos 2.7); la página los pasa por `inspectorMilestones` de la consola.
  - La tarjeta de conexión se va: el estado de las fuentes vive en la barra de estado, y un fallo de lectura deja los vuelos bajo un aviso en línea de datos sin actualizar. El texto dice «fuente de vuelos», nunca «FlyAware».
  - Los avisos van en `OccToastStack`, abajo a la derecha del área de trabajo (prop `placement`, compatible). Por debajo de 1024 px el tablero se abre en `OccDrawer` desde «Ver vuelos».
- **Mapa de posiciones** (`positions-map/PositionsMapPage.jsx`).
  - La barra (`OccToolbar`) lleva el `h1`, la estación y la cuenta de posiciones, las terminales como `OccSegmented`, «Buscar posición» y «Lista de posiciones» (`aria-pressed`).
  - «Lista de posiciones» es una tabla densa (`components/PositionsTable.jsx`, `OccDataTable`): la posición en placa con «Sin ubicar», la terminal, el estado que dibuja el mapa con su forma y su palabra, el vuelo con «Demo» y quién la cubre (el agente, desde 1536 px). Conserva `positions-side-panel` y `position-list-item` en cada fila (`rowTestId`, nuevo y compatible en `OccDataTable`). Una fila elige su posición y la centra en el mapa. Por debajo de 1536 px la lista se pliega mientras el inspector está abierto, para que el mapa conserve el ancho de su barra, y vuelve al cerrarlo; «Lista de posiciones» sigue pulsado. Por debajo de 1024 px se abre en `OccDrawer`.
  - Un enlace con `stand=` también centra la posición, una vez que el mapa puede dibujar (`focusStandOnStart` de `OccMap`, que `PositionMap` activa con `focusSelectedOnStart`); un mapa que se vuelve a crear por el tema conserva su cámara.
  - `PositionDetailDrawer` pasa a inspector acoplado a la derecha: conserva `position-detail-drawer`, «Cerrar detalle» y Esc, que cierra primero el inspector y después, en el mapa, la selección (contratos 2.2). Muestra los hechos de la posición (`StandDetailFacts`), la escala con la tira de hitos de su vuelo (`StandTurnaround`) y los comandos de siempre: «Registrar llegada», «Asignar posición», «Liberar posición» y «Ubicar en el mapa». Sus textos pasan a `positionsMapMessages.js`, con inglés.
  - Bajo el mapa va la banda de posiciones (`components/PositionsBand.jsx`): `OccTimeline` con el modelo de la consola (`dashboard/noc/standTimeline.js`) y la línea «ahora». Plegada, que es como abre, cuenta las posiciones por estado con su forma; abierta, ofrece 4 h, 8 h y Día, y «Con vuelos» o «Todas». Una barra elige su posición.
- **Planificación** (`planning/PlanningPage.jsx`).
  - La barra lleva el `h1`, la cuenta de escalas y «Nuevo vuelo», «Importar vuelos» y «Actualizar». Las cifras del día son `OccStatTile`.
  - Cuatro vistas reales en `OccSegmented`: «Línea de tiempo» (las tarjetas por hora, con `flight-card`), «Posiciones» (la banda del día, que reemplaza el marcador de «Calendario»), «Tabla» (`components/PlanningTable.jsx`, que reemplaza el otro marcador) y «Mapa» (`PlanningMap`). La banda y la tabla salen del snapshot que la página ya lee (`planningViews.js`): ninguna lectura nueva. En el día de hoy la banda abre en 8 h alrededor de ahora; otro día se ve entero.
  - Lee `?turnaroundId=` e `?import=1` como antes. El cajón y los tres diálogos conservan su lógica y sus textos.

**3. Lo que se borró.** En Monitoreo, doce componentes sin uso con sus pruebas (entre ellos `FlightListItem`, `FlightListDrawer`, `FlightToast`, `FlightConnectionStatus` y `FlightDetailPopover`) y `useFlightMonitoringFilters`. En Mapa de posiciones, `PositionsSidePanel`, `PositionListItem`, `PositionsListDrawer`, `PositionSummary` (con su prueba), `PositionToast`, `EmptyPositionsState` y `PositionLegend`; la leyenda del mapa y la banda dicen lo que decía el resumen. Planificación deja de usar `ModulePlaceholder`, que es compartido y se queda.

**4. Una corrección fuera de las tres pantallas.** `standTimeline.js` daba a la barra de una posición su primera señal, aunque fuera un aviso («llegada sin registrar»), que `OccTimeline` no dibuja y por el que lanzaba `RangeError`. Ahora solo toma una señal de atención o urgente. Afectaba también a «Posiciones» de la consola en cuanto una posición tenía un avión sin llegada registrada.

**4 bis. La barra del mapa en un mapa estrecho.** El mapa es un contenedor (`container: occ-map / inline-size` en `occ-map.css`) y su barra de vistas y herramientas tiene dos pasos compactos. Por debajo de 64 rem de mapa se quitan las teclas de cada botón (siguen en `aria-keyshortcuts` y en la tabla de teclas) y los botones se estrechan; por debajo de 48 rem «Aproximación» y «Aeródromo» muestran «Aprox.» y «Aeród.», y la palabra entera sigue siendo el nombre del botón. Así la barra cabe en una fila en Monitoreo a 1440×900 (necesitaba unos 889 px y tenía 748), y la leyenda, que abre sobre su botón, ya no se sale del mapa. Las suites visuales lo comprueban a 1920×1080 y a 1440×900.

**5. Diferencias con el diseño, y por qué.**
- *El inspector de Monitoreo va bajo el tablero hasta 2200 px.* El diseño lo acopla a la derecha, pero con el carril abierto una tercera columna dejaría el mapa demasiado estrecho incluso para la barra compacta. Mapa de posiciones sí lo acopla a la derecha, y pliega la lista por debajo de 1536 px mientras está abierto.
- *El bloque de datos del avión sigue dentro del mapa*, arriba a la izquierda, como en la consola; el inspector de Monitoreo no lo repite.
- *Planificación queda fuera de `MIGRATED_FOLDERS`.* Su cajón, sus tres diálogos, los paneles de asignación, turno y asistencia y las tarjetas de la línea de tiempo siguen en el puente: rehacerlos no era solo de presentación. La barra, las cifras, los filtros, las vistas nuevas y los estados ya pintan con tokens.
- *La selección usa las claves de contratos 2.1*, no el `?sel=stand:` del diseño.

**6. Pruebas.**
- Nuevas: `flightBoardModel`, `FlightBoard`, `FlightInspector` y `flightMonitoringMessages` (paso de Monitoreo); `PositionsTable`, `PositionsBand` y `planningViews`; un caso de `standTimeline` para el aviso, uno de `OccDataTable` para `rowTestId`, uno de `OccMap` para `focusStandOnStart` y uno de la página de Monitoreo para la tira de hitos. `MapPresetSwitcher.test.jsx` comprueba las palabras cortas y `OccMap.test.jsx` las dos reglas `@container` nuevas.
- `positions-map.spec.mjs` (del carril de mapas) pedía que Aeródromo quedara más de un nivel de zoom por debajo de Rampa; con el mapa a toda la altura queda a unos 0,9 a 1440×900. Ahora pide lo que garantizan los umbrales derivados: que quede por debajo del umbral de los códigos de posición, el ajuste de Rampa menos 0,3 (`thresholdsFromFits`).
- Cambian las de las tres páginas y sus componentes, con los mismos textos y `data-testid` que usa el E2E del ciclo. `occStyleGuard.test.js` suma `positions-map` a la regla estricta y deja sin pintores de franja a Monitoreo y a Mapa de posiciones.
- En la suite visual, `flight-monitoring.spec.mjs`, `positions-map.screens.spec.mjs` y `planning.screens.spec.mjs`, a 1920×1080 y a 1440×900, en oscuro y en claro (`OCC_VISUAL_THEME=light`). El diálogo «Importar vuelos» se fotografía con su error recuperable, porque el stub no sirve las propuestas del proveedor. Como el resto de la suite, corre fuera del CI.

## Nota del 24 de noviembre de 2026: CN-32 «Monitoreo OCC más profesional»

Pedido del dueño en la caja negra del 24 de noviembre: «del mapa quiero que dejes lo necesario, lo que hay es necesario pero siento que se puede distribuir mejor y más profesional, refinemos el monitoreo del OCC». Nada de lo que muestran Panorama, Monitoreo de vuelos y Mapa de posiciones se quita: se redistribuye. Las capturas de antes, a 1366×768 (el portátil de la auditoría), 1440×900 y 1920×1080, mostraban:
- en Panorama, cinco paneles flotantes con huecos y esquinas redondeadas que a 1366 px dejaban al mapa unos 300 px; los botones de zoom flotando a media pantalla, porque se colocaban junto a «Alertas»; el «Inspector» cortado bajo «Alertas»; y la leyenda abriéndose encima del inspector;
- en los tres mapas, la barra de vistas, «Capas», 3D, «Seguir», las herramientas de la pantalla, la pausa y «Leyenda» en cinco cajas de alturas distintas abajo al centro, que a 1366 px se salían del mapa de Monitoreo; la escala de altitud y el crédito de los datos de aeronaves a media altura sobre el mapa; la escala náutica asomando bajo la barra;
- en Monitoreo, el bloque de datos del vuelo flotando sobre el mapa y repitiendo lo que decía el inspector bajo el tablero, y la leyenda abierta tapando el resto del mapa.

Esta nota amplía las decisiones de arriba sin reescribirlas. Del [ADR-0043](0043-occ-maps-one-engine.md) reemplaza solo el lugar de la leyenda y del selector de vistas de la decisión 9 («Va abajo, en el centro»); de U5, el punto 4 bis (los pasos compactos de la barra) y la regla de 2200 px del inspector de Monitoreo (punto 5).

**1. Un solo plan para el entorno de los mapas** (`src/styles/occ-map.css`, en todos los mapas del OCC, también el laboratorio y Planificación).
- *La columna de control*, en el borde derecho del área a la vista (dentro de los `insets`): arriba el grupo de zoom y brújula de MapLibre, con el ancho del riel, y debajo el riel (`maps/ui/MapDock.jsx`). El riel lleva, de arriba abajo y cada grupo en una losa: las cuatro vistas una bajo otra con su tecla (`MapPresetSwitcher`, siempre con «Aprox.» y «Aeród.»; la palabra entera sigue siendo el nombre y el título del botón) y 3D; «Seguir»; las herramientas de la pantalla en una fila de iconos; la pausa; «Capas» y «Leyenda». Ocupa el alto del área a la vista y no toma el puntero, solo sus controles. Los controles miden 32 px de alto (44 px con puntero táctil, `--occ-map-control`), como los demás del OCC; sus clases comunes están en `maps/ui/railClasses.js`.
- *Los menús del riel*: «Capas» y «Leyenda» salen a la izquierda del riel, desde la altura del zoom y como mucho hasta el pie de la columna, y se desplazan si son más largos (`.occ-map-flyout`). Comparten lugar: abrir uno pliega el otro. El tope de la leyenda por JavaScript (`useLegendInsideMap`, PR M6) se retira: lo pone la hoja.
- *La clave del mapa*, abajo a la izquierda: el crédito de los datos de aeronaves en la línea de abajo y, encima, la escala de altitud, ahora «Altitud (ft)» en frase normal y a 12 px. *La escala náutica y los créditos de MapLibre*, abajo a la derecha, a la izquierda de la columna y nunca debajo del riel. *Arriba al centro*, solo un estado anómalo (mapa base, tráfico con retraso, vuelos de AVIAM sin leer, 3D en pausa). *Arriba a la izquierda*, lo de la pantalla («Llegada nueva», el bloque de datos de Mapa de posiciones, «Ubicar en el mapa»). El aviso «Dejaste de seguir…» va abajo al centro, sobre la clave.
- La leyenda de Monitoreo abre plegada, como la de la consola: el mapa abre despejado y el botón «Leyenda» está siempre en el mismo sitio. Mapa de posiciones y Planificación la abren como antes.
- *Por qué:* los controles en una columna crecen con el alto y no con el ancho, así que caben en un mapa estrecho sin pasos compactos, y cada cosa tiene un solo sitio en los tres mapas. *Descartado:* una barra horizontal arriba del mapa (no cabe a 1366 px con el inspector abierto) y botones solo con icono para las vistas (ambiguos para quien no conoce la pantalla).

**2. Panorama acoplado** (`dashboard/noc/ConsoleOverlay.jsx`).
- Los paneles siguen siendo hijos de `OccMap` y se miden igual (`useConsoleInsets`), pero van a ras de los bordes del mapa, en la losa opaca del panel y con una junta de 1 px del lado del mapa: la disposición `dock` nueva de `OccFloatingPanel`, sin borde ni radio propios. Plegado, cada panel sigue siendo su pastilla.
- Columna izquierda (24 rem; 26 rem desde 1920 px), a todo el alto: «Tablero» y, debajo, «Alertas» con «Pendientes de la jornada» (como mucho el 40 % del alto). Las listas de trabajo quedan juntas y el borde derecho queda para el detalle.
- «Cifras de la jornada» es una franja de una línea a lo largo del borde superior del mapa (`orientation="row"` de `OccFloatingPanel`; las cifras, un tamaño menores con `compact` de `OccStatTile`); abre desplegada desde 1280 px (antes, plegada por debajo de 1600 px). Por debajo de 1400 px su botón muestra «Cifras» y su nombre sigue siendo «Cifras de la jornada» (`shortTitle`). Como las cifras están siempre a la vista, el resumen plegado de «Posiciones» ya no repite las escalas ni las que están en operación.
- «Posiciones», la banda, a lo largo del borde inferior.
- El «Inspector»: desde 1536 px, una columna propia a la derecha del mapa (22 rem; 24 rem desde 1920 px) entre la franja de cifras y la banda; es el lugar del panel de un vuelo en modo seguimiento. Por debajo de 1536 px se acopla en la columna izquierda bajo «Tablero», y «Alertas» se pliega mientras está abierto (solo con CSS: el panel sigue montado) y vuelve al cerrarlo, como la lista de Mapa de posiciones. Así, a 1366 px y con un vuelo elegido, el mapa conserva unos 730 px de ancho, donde antes le quedaban unos 290.
- Los márgenes del mapa: los paneles de las columnas declaran el borde `side` (`CONSOLE_SIDE_EDGE`, `consoleInsets.js`), que se resuelve por geometría, a la izquierda o a la derecha según dónde cae su centro; una pastilla toma alto del borde superior o del inferior, el más cercano. El resto de la cámara de la consola (`consoleCamera.js`) no cambia.

**3. Monitoreo de vuelos** (`flight-monitoring/`).
- *Tablero más denso y ordenable*: las tiras llevan menos relleno y el tablero, un encabezado de columnas alineado con ellas (Hora, Vuelo, Estado, Ruta, Pos.) que ordena; un segundo clic invierte el orden (`sortBoard` y `nextBoardSort` de `flightBoardModel.js`, puros: lo que no tiene el valor va al final y los iguales conservan el orden por hora). El botón pulsado lleva la flecha y su nombre dice el orden («Ordenado por hora, de menor a mayor»).
- *Inspector acoplado* (`components/FlightInspector.jsx`, sobre `maps/ui/MapSidePanel.jsx`): desde 1536 px, columna propia a la derecha del mapa; de 1024 a 1536 px ocupa la columna del tablero, que se pliega mientras está abierto («Cerrar detalle» lo devuelve y devuelve el foco a su tira); por debajo de 1024 px, bajo el mapa. Antes iba bajo el tablero hasta 2200 px.
- *Un solo panel por vuelo*: el bloque de datos del mapa (`FlightDataBlock`) se dibuja dentro del inspector, en la sección «En vivo», por un portal que conserva el contexto del mapa (`dataBlockSlot` de `FlightMap`, variante `embedded` del bloque: sin título, «Cerrar» ni enlaces propios, con la ruta y la hora, altitud, velocidad y rumbo, posición y pista, la procedencia de su posición y «Seguir»). Ninguna tarjeta flota sobre el mapa. Debajo, «Horarios» (programada, estimada y real, con la demora), «Escala» (posición, agentes, avión, matrícula, servicios y la tira de hitos) y, al pie, «Ver planificación» y «Ver mapa de posiciones». Otro tráfico elegido en el mapa, que la página no conoce, conserva su bloque arriba a la izquierda del mapa.

**4. Mapa de posiciones.** 2D/3D, «Centrar PUJ» y pantalla completa pasan al riel del mapa como una fila de iconos en una losa (`railTools` de `PositionMap`; con puntero táctil, uno bajo otro), y el bloque de datos de un vuelo vuelve a la esquina superior izquierda (12 px). El inspector de la posición usa el mismo `MapSidePanel`, con «Ver vuelo en Monitoreo» al pie. Los rótulos de sus secciones («Próximo cambio», «Características», «Escala en la posición», «Siguiente») dejan las mayúsculas espaciadas (punto 7).

**5. La demora de un vuelo** (`occ-ui/occDelay.js`, `OccDelayChip.jsx`). Son los minutos que su hora real, o si no la estimada, pasa de la programada. Un chip «+N» en Plex Mono desde 5 minutos, sin tono; desde 15 minutos (el límite de puntualidad A15/D15), con el triángulo ámbar de «Atención», nunca solo color. Va en la línea de estado de cada tira, en la consola y en Monitoreo (su nombre lo dice: «Atención: 18 min de demora»), y en el inspector junto a «Horarios». La leyenda de cada tablero lo nombra («+N Minutos de demora») cuando hay uno a la vista; las dos leyendas de tablero son ahora el mismo componente (`occ-ui/OccBoardLegend.jsx`). Es solo una marca: no cambia las alertas, los pendientes ni las cifras.

**6. `MapSidePanel`, el panel acoplado de las pantallas de mapa** (`maps/ui/MapSidePanel.jsx`), para Monitoreo, Mapa de posiciones y el panel de un vuelo en modo seguimiento (CN-29/30):
- Props: `label` (obligatorio, el nombre del landmark), `title`, `subtitle` y `status` (la cabecera; el título va en un `h2`, o en un `h3` con `headingLevel`), `onClose` con `closeLabel` (el «Cerrar» de la cabecera), `actions` (en la cabecera), `footer` (siempre a la vista bajo el cuerpo), `as` (`aside` o `section`), `variant` (`framed`, la losa redondeada de una columna de la página, o `flush`, a ras del mapa con la junta a la izquierda), `className`, `bodyClassName` y cualquier `data-*`.
- `MapSidePanelSection` (`title`, `meta` a la derecha del título y fuera de él, `headingLevel`): las secciones del cuerpo, con el rótulo en frase normal.
- Es un landmark y no un diálogo: sin velo ni trampa de foco, el mapa conserva sus teclas. No se coloca solo: la pantalla lo acopla en su columna derecha (Monitoreo y Mapa de posiciones desde 1536 px), y en la consola el «Inspector» ocupa ese mismo lugar. Un panel de seguimiento debería usar ese hueco, no abrir un segundo panel.

**7. Tipo y forma.** Los rótulos en mayúsculas espaciadas que quedaban en el detalle de una posición y en la escala de altitud pasan a frase normal, a 12 px. Las horas y las cifras siguen en Plex Mono o con cifras tabulares.

**8. Lo que no cambia.** La API, el OpenAPI, el cliente compartido y la base; lo que leen las pantallas y su cadencia (el presupuesto de CN-19 sigue en 16 y 38 peticiones por minuto en la consola); el bucle de cuadros y la escritura del tráfico (CN-18). `core/OccMap.jsx` no se tocó. Siguen las teclas (1 a 4, D, S, L y Esc), los nombres accesibles y los `data-testid` que usan el E2E del ciclo y la guía: «Tablero», «Alertas», «Cifras de la jornada», «Posiciones» e «Inspector» con sus botones de pliegue; «Tablero de vuelos», `flight-list-item` y `flight-map-container`; «Detalle del vuelo {vuelo}» con «Cerrar detalle»; `position-detail-drawer` y `position-list-item`; «Leyenda», «Capas», «Ocultar paneles» y «Mostrar paneles».

**9. Pruebas.** Nuevas: `OccDelayChip.test.jsx` (con `occDelay.js`), `OccBoardLegend.test.jsx`, `MapSidePanel.test.jsx` y `ConsoleOverlay.test.jsx`. Casos nuevos en `OccFloatingPanel` (la fila y `shortTitle`), `consoleInsets` (`side` y las pastillas), `boardModel` (la demora en la leyenda), `flightBoardModel` (el orden y la demora), `FlightBoard` (el encabezado y el chip), `FlightInspector` (la demora), `FlightDataBlock` (la variante `embedded`), `FlightMap` (el portal al panel) y `MapLegend` (el menú del riel y el lugar compartido con «Capas»). Cambian las de `MapPresetSwitcher`, `MapLayersMenu`, `MapControls`, `PositionsMapPage`, `FlightMonitoringPage`, `ConsolePage`, `consoleMessages`, `AltitudeLegend` y la lista de reglas de `occ-map.css` en `OccMap.test.jsx`. En la suite visual, `tests/visual/occ/occ-monitoring.spec.mjs` fotografía las tres pantallas a 1366×768, 1440×900 y 1920×1080 (al abrir, con un vuelo o una posición elegidos y con la leyenda abierta), y cambian `console.spec.mjs` (los paneles a ras y el inspector bajo el tablero a 1440 px) y `flight-monitoring.spec.mjs` (el inspector en la columna del tablero o a la derecha, y el bloque de datos dentro del inspector). Como el resto de la suite, corre fuera del CI.

**10. Límites.** Las capturas se revisaron en local, con la API simulada de la suite visual, en oscuro y en claro; nada de esto acredita un despliegue ni una revisión visual en el VPS. La rama del motor de mapas en curso (CN-29/30, la ruta y «Seguir en 3D») toca `core/OccMap.jsx`, la cinemática y el tráfico, que este cambio no edita; su panel de seguimiento debería montarse sobre `MapSidePanel`, en el hueco derecho del punto 6.
