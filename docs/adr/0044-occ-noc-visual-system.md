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
- **Tailwind.** `tailwind.config.js` expone cada token como `colors.occ.<nombre>: 'var(--occ-…)'` y suma `panel-raised`, `panel-float`, `faint`, `warn-soft` y `danger-soft`. **Nunca se usa un modificador de opacidad sobre una clase `occ-*`**: con un color `var()`, Tailwind no genera la clase. `bg-occ-panel/90` no pintaba nada; para los fondos tenues existen los tokens `-soft`.
- **Para JavaScript.** `src/features/occ-ui/occPalette.js` exporta `OCC_PALETTE` (token → valor, solo los colores) y `occColor(token)`. Es para quien no lee variables CSS: la pintura de MapLibre, los iconos de canvas y el SVG dibujado en código. Una prueba de paridad lo compara con `occ.css`, y un nombre desconocido lanza un error en lugar de pintar `undefined`. Los mapas tomarán de ahí los colores de estado y guardarán en su propio módulo solo los del mapa base.
- **Contraste (WCAG 2), sobre el panel y sobre la losa:**
  - texto, 12,8:1 y 10,9:1; secundario, 8,8:1 y 7,5:1; tenue, 5,7:1 y 4,9:1;
  - cian, 8,9:1 y 7,5:1; ámbar, 9,2:1 y 7,8:1; rojo, 5,4:1 y 4,6:1, el mínimo de la paleta;
  - borde de control, 3,8:1 y 3,2:1;
  - la tinta sobre los rellenos va de 6,6:1 (rojo) a 15,6:1 (tecla).
  - El rojo sobre su propio fondo tenue queda en 4,3:1: sobre ese fondo el texto va en `--occ-text`, y el color queda en el fondo y el borde.

**4. El puente heredado.** `src/styles/occ-legacy-bridge.css` es una hoja generada y versionada que repinta con los tokens oscuros las clases heredadas de las pantallas montadas bajo `/admin-occ`. `app/layout.jsx` la importa justo después de `occ.css`. No cambia ningún JSX, texto, rol, nombre accesible ni `data-testid`.
- **Alcance e interruptor.** Todas las reglas están limitadas a `[data-department="occ"][data-occ-bridge]`. `AdminOccLayout` pone `data-occ-bridge` en la raíz del marco con la prop nueva `rootAttributes` de `ShellFrame`. Quitar ese atributo apaga el puente entero, y fuera del OCC no existe.
- **Peso.** La regla de cada clase pesa al menos dos atributos y una clase: gana a la utilidad simple de Tailwind (una clase) y a la `dark:` (dos clases) sin depender del orden. La regla por defecto, para los bordes y anillos sin color, no pesa nada (`:where`), así cualquier clase de color le gana.
- **Manifiesto** (`src/styles/occLegacyBridgeMap.js`):
  - `OCC_LEGACY_BRIDGE`: 42 entradas `{ id, declarations, classes, inside?, pairs?, selectors? }`, en orden:
    - texto y superficies (panel, losa, fondo, campo y panel flotante);
    - fondos tenues, rellenos con su tinta (la acción principal es la tecla clara) y puntos de estado;
    - velo, juntas, bordes de control, anillos y contornos;
    - el borde rojo de un campo inválido, por encima de cualquier otro borde;
    - pares, como el texto rojo sobre el fondo rojo tenue, que pasa a texto normal;
    - plano: sin desenfoque, y las sombras se anulan con `--tw-shadow` para que sobrevivan los anillos de foco;
    - radios por papel (6 px los paneles y 4 px los controles);
    - `font-sans` vuelve a Manrope, y `bg-occ-panel/90` y `/95` pasan a `--occ-panel-float`, porque Tailwind no las generaba.

    Cubre 148 clases de color y 19 de sombra, desenfoque, radio y familia tipográfica.
  - `OCC_BRIDGE_DEFAULTS`: un borde sin color es `--occ-line-strong` y un anillo sin color es `--occ-accent`.
  - `OCC_BRIDGE_UNMAPPED`: clases que un archivo del OCC contiene pero que nunca pintan dentro del marco, cada una con su motivo. Hoy está vacío.
  - `MIGRATED_FOLDERS`: carpetas ya rehechas con tokens y primitivas de `occ-ui`, donde no se admite ninguna clase de color heredada. Hoy está vacío; la primera llega con U3.
- **Generador.** `src/styles/occLegacyBridge.js` es puro: `bridgeSelector`, `generateOccLegacyBridgeCss` y `findLegacyColourClasses`. Para cambiar la hoja se edita el manifiesto y, desde `frontend/private-web`, se ejecuta `npx vitest run --configLoader runner --config vitest.config.mjs src/styles/occStyleGuard.test.js` con la variable de entorno `UPDATE_OCC_BRIDGE=1`, que reescribe la hoja. La hoja no se edita a mano.
- **Guardas** (`src/styles/occStyleGuard.test.js`). Fallan si:
  - la hoja versionada difiere de la que genera el manifiesto;
  - una regla sale del alcance, selecciona algo fuera del marco o no gana a la utilidad de Tailwind que repinta;
  - un archivo montado bajo `/admin-occ` usa una clase de color heredada que el manifiesto no cubre. El recorrido (`src/styles/occSourceScan.js`) sigue las importaciones desde `app/admin-occ/**` y `AdminOccLayout.jsx`, y se detiene en `src/app/RoleLayout.jsx`, que importa los marcos de los demás departamentos;
  - el manifiesto repite una clase o usa un token que `occ.css` no define;
  - una carpeta de `MIGRATED_FOLDERS` usa una clase de color heredada;
  - `occ-ui` usa desenfoque, degradados o un modificador de opacidad sobre `occ-*`;
  - una pareja de la paleta pierde su contraste, o el chat lee una variable que nadie define.
- **Cómo sale una pantalla del puente.**
  1. Un commit mecánico cambia las clases heredadas de la carpeta por clases `occ-*` y primitivas de `occ-ui`, sin reestructurar el JSX y con los mismos textos, roles, nombres accesibles y `data-testid`. La reestructura, si la hay, va en otro commit.
  2. La carpeta entra en `MIGRATED_FOLDERS`: desde entonces la guarda prohíbe allí las clases de color heredadas.
  3. Se borran del manifiesto las clases que ya no usa ningún archivo montado y se regenera la hoja.
- **Páginas compartidas.** Usuarios (`DepartmentUsersPage`), Mis gastos (`DepartmentExpensesPage`) y los componentes de `src/components/` se quedan en el puente. No se editan para el OCC, porque otros departamentos y sus pruebas dependen de ellos; fuera del OCC no cambian.
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
  - `STAND_STATES`: los siete estados de posición, clave → `{ es, en, fill, outline, dash, extra }`. El archivo guarda cómo se llama y se dibuja cada estado; las reglas de «Cuándo» las aplicará el modelo de posiciones de los mapas.

    | Clave | Español | Inglés | Cuándo | Relleno | Contorno | Marca |
    |---|---|---|---|---|---|---|
    | `available` | Libre | Free | sin visita | ninguno | 1 px continuo, `line-strong` | código |
    | `planned` | Planificada | Planned | asignada, el vuelo llega en más de 15 min | ninguno | 1,5 px a trazos 4-3, `muted` | vuelo, hora y huella a trazos |
    | `arriving` | Llegando | Arriving | asignada, el vuelo llega en 15 min o menos, aterrizó o rueda, y aún no está en la posición | `panel-raised` al 40 % | 2,5 px continuo, `text` | línea de entrada resaltada, «en N min» |
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
- En U1, `occ.css` ya no tiene degradados, sombras ni desenfoque (lo comprueba una prueba), y el puente quita el desenfoque y las sombras de las clases heredadas. El tamaño mínimo y los rótulos se corrigen pantalla por pantalla, de U3 a U6.

### Lo que añadirán U2 a U6

| PR | Qué añade |
|---|---|
| U2 «Marco del OCC» | Un proveedor único con los refrescos agrupados (`useOccResource`); la barra de estado (estación, enlace en vivo, fuentes, alertas, relojes y «Leyenda»); el riel reagrupado en «En vivo», «Planificar», «Revisar» y «Estación», con los mismos 14 módulos; el cajón de alertas y avisos; y el enlace para saltar al contenido. |
| U3 «Consola» | Las primitivas de `occ-ui`. El mapa a pantalla completa con sus paneles flotantes: «Tablero», «Alertas», «Posiciones», el selector de vistas y el «Inspector». Importar y asignar sin salir del mapa, la pastilla «Llegada nueva» y el respaldo en cuadrícula. Borra el dashboard viejo y el CSS con `nth-child` de `occ.css`, y añade la primera carpeta a `MIGRATED_FOLDERS`. |
| U4 «Pantalla de arranque» | `admin-occ/boot/`: el isotipo y el logo ELEVANT · OCC, el fondo «rutas que se trazan» y una línea de progreso, desde la verificación de la sesión hasta que la consola está lista. |
| U5 «Pantallas de mapa» | Monitoreo de vuelos, Mapa de posiciones y Planificación con sus plantillas, y las dos vistas nuevas de Planificación. |
| U6 «Resto de pantallas» | Cobertura, Revisión, Notificaciones, Chat, Datos maestros, Tablets, Contratos listos y Reportes con `occ-ui`. Limpia el código muerto y deja el puente solo para las páginas compartidas. |

Cada uno amplía la nota del Vault de Private Web. Un cambio de estas decisiones se añade como nota fechada al final de este ADR, sin reescribirlo.

## Consecuencias

- Todas las pantallas montadas bajo `/admin-occ` pasan a los tokens oscuros, directamente o a través del puente, sin reestructurar el JSX de ninguna, y el chat vuelve a tener fondos y bordes. Los textos, roles, nombres accesibles y los 26 `data-testid` del OCC no cambian; solo desaparece de la barra el botón de tema, con su nombre accesible.
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
- **La consola actual** conserva su disposición con selectores `nth-child` en `occ.css`, ahora solo con colores de los tokens, hasta que U3 borre el dashboard viejo. Hasta entonces, `--occ-panel-muted` sigue como alias, y las cuatro clases `bg-occ-panel/90` y `/95` de la consola las cubre el puente.
- **Texto menor de 12 px y rótulos en mayúsculas** en las pantallas heredadas, hasta que cada una se migre.
- **El puente depende de los nombres de las clases:** una correspondencia puede verse mal en una página compartida o en un elemento pequeño. Lo mitigan las pruebas de cobertura, las capturas y el interruptor por atributo.
- **Limpieza del manifiesto.** Ninguna prueba avisa todavía de una clase del manifiesto que ya no usa ningún archivo: al migrar una carpeta se borran a mano.
- **Mapas.** El código de los mapas conserva su estilo claro hasta que el carril de mapas deje una sola paleta que lea `occPalette.js` y no cambie de estilo después de arrancar. Dentro del OCC siempre reciben el tema oscuro.
