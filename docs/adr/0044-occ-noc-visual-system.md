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
| U4 «Pantalla de arranque» | `admin-occ/boot/`: el isotipo y el logo ELEVANT · OCC, el fondo «rutas que se trazan» y una línea de progreso, desde la verificación de la sesión hasta que la consola está lista. |
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
- **Primer pintado.** El script pone la clase `dark` antes de pintar, pero hasta que monta el marco se ve el fondo oscuro de `body`, azul marino (`#0A1220`), y luego la pizarra del OCC (`#161E22`). Lo cubrirá la pantalla de arranque de U4. La certificación de la imagen todavía no comprueba ese primer pintado: lo cubren las pruebas con jsdom.
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
