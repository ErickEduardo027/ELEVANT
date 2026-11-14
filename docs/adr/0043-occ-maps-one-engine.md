# ADR-0043: Mapas del OCC: un solo motor, un lienzo por página y un estilo NOC propio

## Estado

Accepted — 2026-11-13.

## Contexto

El plan «OCC a nivel NOC», aprobado el 12 de noviembre de 2026, lleva el Centro de Operaciones a la estética y la utilidad de un centro de monitoreo. Avanza en tres carriles con archivos separados (API, mapas y estilo visual), y cada carril registra sus decisiones en su propio ADR: el de mapas, en este. El carril de mapas son ocho PR, de M1 a M8. M1 (`b6c02817`) fijó `maplibre-gl` en la versión exacta 6.16.0. Este ADR recoge lo que fija M2 «Motor único y estilo NOC» y las reglas que seguirán M3 a M8. M2 deja las mismas pantallas sobre un solo motor: las posiciones siguen siendo puntos, y todavía no llegan el conjunto de datos del aeropuerto, el tráfico, la cinemática ni el 3D. Su código llegó en cuatro pasos: la base del motor y del estilo (`314c124b`); `OccMap` con las vistas, la selección en la URL, las teclas y la leyenda (`323189b2`); los adaptadores de las pantallas y lo que se retiró (`5d759557`); y el laboratorio de mapas con la suite visual (`c0b20127`).

Antes de M2 (`d41a84f1`, con M1 y U1 ya integrados), en `frontend/private-web`:
- **Siete ciclos de vida de mapa.**
  - Cinco componentes creaban cada uno su mapa de MapLibre y repetían a su manera el constructor, el worker, los controles, la atribución y la limpieza: `PositionMap.jsx` (Mapa de posiciones, la vista «Mapa» de Planificación y la plataforma de la consola), `FlightMap.jsx` (Monitoreo de vuelos), `AirfieldMap.jsx`, `RegionalTrafficMap.jsx` y `GoesCloudMap.jsx`. El diseño los contó como «seis ciclos de vida duplicados».
  - Dos variantes de Google Maps, `GoogleFlightMap.jsx` y `GooglePositionMap.jsx`, con `googleMapsLoader.js` y la dependencia `@googlemaps/js-api-loader`, solo se alcanzaban desde sus pruebas y desde los stubs de dos pruebas de página. `AirfieldMap.jsx` y `dashboard/console/AirfieldPanel.jsx` no tenían quien los importara.
- **Estilos remotos y `setStyle` en cada cambio de tema.**
  - Cada mapa cargaba un estilo publicado por URL y llamaba a `setStyle` al cambiar el tema: volvía a descargar y armar el estilo, perdía los datos de ejecución y tenía que volver a montar fuentes, capas e imágenes en `style.load`.
  - Monitoreo usaba el estilo de demostración de MapLibre (`demotiles.maplibre.org`), y los demás, los estilos `liberty` y `dark` de OpenFreeMap, con dos huecos de su sprite tapados en tiempo de ejecución (`circle-11` y `wood-pattern`).
  - Cuatro variables públicas, `NEXT_PUBLIC_FLIGHT_MAP_STYLE_LIGHT`, `NEXT_PUBLIC_FLIGHT_MAP_STYLE_DARK`, `NEXT_PUBLIC_POSITIONS_MAP_STYLE_LIGHT` y `NEXT_PUBLIC_POSITIONS_MAP_STYLE_DARK`, podían cambiar esa URL, también por un origen que la CSP no permite.
  - Mapa de posiciones se daba por caído si no llegaba a `idle` en 8 s o si cualquier error ocurría antes: un servidor de teselas lento ocultaba el lienzo.
- **Colores y marcadores fuera de los tokens.** Monitoreo dibujaba los aviones y PUJ como elementos DOM (`AircraftMarker.js` y `AirportMarker.js`), y las posiciones eran íconos de canvas pintados con `STATUS_COLORS` (`positionMarkerIcons.js`). ADR-0044 dejó esos colores pendientes para el carril de mapas.
- **Las lecciones de M1**, comprobadas en Chrome con MapLibre 6.16.0:
  - sin WebGL2 el constructor del mapa lanza `GPUInitializationError`: Monitoreo se caía entero hasta `64c695de`;
  - tras perder el contexto WebGL o reiniciar un worker, MapLibre repone las capas, los datos y las imágenes, pero no las capas personalizadas ni el estado de las entidades (feature state);
  - con `next dev` (doble montaje de React Strict Mode), el «+» de los controles iniciaba un acercamiento que terminaba sin cambiar el zoom, mientras que el build de producción sí acercaba;
  - el clic en un grupo de posiciones pasaba un callback a `getClusterExpansionZoom`, que en MapLibre 6 devuelve una promesa, así que no hacía nada;
  - cada montaje creaba y terminaba sus workers, y un worker terminado mientras carga su script deja esa petición abierta para siempre: la página nunca llegaba a `networkidle`, y Mapa de posiciones volvía a montar su mapa en cada relectura.

Decisiones de Erick del 12 de noviembre de 2026 que este ADR aplica:
- **5. Los mapas son de código abierto (MapLibre)** y se editan a fondo.
- **16. El OCC queda solo en oscuro**: una sola paleta para los mapas y ningún cambio de estilo por tema.
- **17. «Cabina oscura», con su leyenda**: lo normal no lleva color, el cian marca lo elegido y cada mapa muestra su leyenda.
- **18. Tono base de pizarra neutra**, ni negro ni azul marino.

## Decisión

**1. Un motor y un lienzo por página.**
- `src/features/maps/core/mapEngine.js` (`createMapEngine`) es el único módulo que construye un mapa de MapLibre, y `core/OccMap.jsx` es el único componente de mapa del OCC. El motor recibe el módulo `maplibre-gl` como parámetro: sus pruebas le pasan el mapa falso compartido `tests/fakeMapLibre.js`, que reemplaza a los falsos que declaraba cada prueba.
- El motor crea su propio contenedor dentro del elemento que lo aloja, así un doble montaje de Strict Mode nunca reutiliza un `div`. `destroy()` quita los listeners, el temporizador, el mapa y el contenedor, y se puede llamar dos veces. `liveEngineCount()` dice cuántos mapas están vivos: tras un doble montaje queda uno.
- Opciones del mapa: sin el control de atribución por defecto (el motor pone el suyo), `pixelRatio` hasta 2, inclinación hasta 65°, zoom de 4,5 a 19,5, sin copias del mundo, `antialias` (lo necesitará la capa 3D de M7), validación del estilo fuera de producción y 150 ms de fundido. Controles: la navegación, con inclinación, arriba a la derecha; abajo a la derecha, primero la atribución compacta y encima la escala en millas náuticas.
- Los listeners van en el mapa, nunca en una capa (`map.on(evento, capa)`), y lo que hay bajo el cursor se lee con `queryRenderedFeatures`, con 4 px de tolerancia, sobre las capas que declaran `occ:pick`. MapLibre 6.16 no repone los listeners de capa tras reiniciar un worker.
- `OccMap` usa un motor durante toda su vida y lo alimenta con `setData`: datos nuevos nunca crean otro mapa, y una relectura con los mismos datos en objetos nuevos no escribe nada. Las referencias a las props se asignan dentro de efectos, nunca durante el render, y el estado del motor llega por `useSyncExternalStore`: un evento del mapa no es un render y nada se renderiza por cuadro. Su raíz publica `data-occ-engine`, `data-occ-basemap`, `data-occ-view` y `data-occ-zoom`, que lee la suite visual.
- Región, Aproximación, Aeródromo y Rampa son posiciones de cámara del mismo lienzo (decisión 8).
- *Por qué:* un contexto WebGL, una caché de teselas y una selección por pantalla. Las reglas del ciclo de vida (worker, Strict Mode, pérdida de contexto, atribución y limpieza) se escriben y se prueban una sola vez.
- *Descartado:*
  - un componente por mapa con un ayudante compartido: las copias vuelven a separarse;
  - mapas pequeños por panel, que dan tres contextos y una selección partida en la misma pantalla;
  - un segundo mapa para «Ampliar», que recrea el contexto y pierde la cámara y la selección: el plan maximiza el mismo lienzo.

**2. Listo al cargar el estilo; solo es fatal un constructor que falla o un contexto que vuelve sin WebGL2.**
- El motor está listo (`ready`) en `style.load`, no al cargar las teselas.
- Solo dos cosas dejan el mapa `unavailable`. Una es un constructor que lanza: `GPUInitializationError` lleva el motivo `webgl`, y cualquier otro error, `error`. La otra es un contexto WebGL que vuelve sin WebGL2: MapLibre 6.16 reconstruye el estilo y después dispara `error` con `GPUInitializationError`, en lugar de `webglcontextrestored`. `OccMap` muestra entonces `MapUnavailable` (`role="alert"`, con el título y la descripción de cada pantalla) y la lista de posiciones o de vuelos del mapa para seguir trabajando.
- `unavailable` es definitivo, con el mapa base apagado (`off`), y nada devuelve el mapa a `ready`. Cuando el contexto vuelve sin WebGL2, el motor quita el mapa en ese momento, como hace el constructor de MapLibre ante el mismo error. Así el estilo reconstruido no llega a cargar y ningún cuadro se dibuja con el painter que MapLibre perdió (en Chrome, cada cuadro lanzaba un `TypeError`). Debajo del respaldo no quedan lienzo ni controles, y las llamadas siguientes se descartan, como tras `destroy()`.
- El mapa base se vigila aparte: un error de la fuente `openmaptiles`, o 8 s sin su primera tesela, lo marcan `degraded`. Es un aviso, «No se pudo cargar el mapa base. Los datos de ELEVANT siguen en el mapa.», no un respaldo: las posiciones, los vuelos, las referencias y la selección siguen funcionando. El aviso no nombra lo que se dibuja, porque lo muestran todos los mapas: también Monitoreo de vuelos, que no dibuja posiciones, y las vistas Región y Aproximación, que no las muestran.
- Lo que necesita el estilo (datos, estado de las entidades, visibilidad, rangos de zoom, grupos y capas personalizadas) espera a que cargue y corre en el orden en que se pidió. Una llamada que falla deja su traza y no tapa a las demás.
- *Por qué:* el estilo va en el bundle y las posiciones son datos propios, así que la rampa sirve aunque OpenFreeMap esté lento o caído.
- *Descartado:* el plazo de 8 s hasta `idle` de antes, que convertía un servidor de teselas lento en un mapa muerto.

**3. Workers precalentados y lo que se repone tras perder el contexto.**
- `core/workerUrl.js` exporta la ruta literal `'/assets/maplibre/maplibre-gl-worker.mjs'`, la que `scripts/verify-maplibre-worker.mjs` busca en los chunks del build, y `ensureWorkerUrl()`, que llama a `setWorkerUrl` y después a `prewarm()` una sola vez por módulo. El grupo de workers sobrevive a los mapas: ni un remontaje de Strict Mode ni uno de la página crean y terminan workers.
- Tras `webglcontextlost`, el motor deja de aplicar llamadas al estilo. MapLibre 6.16 reconstruye el estilo con sus datos e imágenes y dispara `webglcontextrestored` antes de que ese estilo cargue: en el `style.load` siguiente, o en el acto si ya cargó, el motor vuelve a poner las capas personalizadas en su slot y el estado de las entidades que recuerda. Lo que recuerda es lo que muestra el mapa: MapLibre no quita una clave del estado sin el id de la entidad (dispara un error y no borra nada), y el motor rechaza esa llamada con un `TypeError` antes de tocar lo que recuerda. La selección es un dato de su propia fuente, no estado de entidad, así que no hay que reponerla.
- *Por qué:* las lecciones de M1. La página no llegaba a `networkidle` en `next dev`, y tras perder el contexto se perderían la capa 3D de M7 y el estado de las posiciones de M4.
- *Descartado:* terminar los workers con cada mapa, que es lo que hace MapLibre si nadie llama a `prewarm()`; crear otro mapa tras perder el contexto, que pierde la cámara y los datos y repite la carga.

**4. El estilo se construye en código.**
- `style/occStyle.js` (`buildOccStyle({ basemap, overlays })`) arma el único documento de estilo:
  - la versión 8, los glifos de OpenFreeMap y la fuente vectorial `openmaptiles` por la TileJSON del planeta (`https://tiles.openfreemap.org/planet`), nunca por la ruta fechada de las teselas, que cambia con cada edición del planeta;
  - las capas del mapa base (`style/basemapLayers.js`) y las de la pantalla, con sus fuentes GeoJSON, que nacen vacías y llena el motor.
- Catorce slots, de abajo arriba, cada uno marcado por una capa `background` invisible `slot-<nombre>`: `base`, `shade`, `weather`, `reference`, `baseLabels`, `airfield`, `stands`, `routes`, `footprints`, `extrusions`, `models`, `standLabels`, `traffic` y `selection`. Una capa personalizada entra debajo de la marca del slot siguiente.
- Cada capa lleva `metadata['occ:group']`, el grupo con el que el menú de capas de M5 la mostrará u ocultará (`setGroupVisibility`). Puede nombrar un umbral derivado (`occ:minThreshold` u `occ:maxThreshold`: `polygons`, `codes` o `threeLine`; decisión 8) y qué se elige con un clic (`occ:pick` y `occ:pickId`). Un slot o un umbral desconocidos, un id repetido o una capa que lee una fuente que no existe hacen fallar el armado.
- El mapa base es mínimo:
  - el fondo como tierra, el agua y la costa, y las fronteras terrestres y marítimas a trazos;
  - las carreteras principales, tenues, desde el zoom 8;
  - los edificios planos desde el zoom 13, y en relieve solo donde la tesela trae su altura, ocultos salvo en el 3D de la plataforma de la consola;
  - rótulos de países, capitales, ciudades y aguas, con el nombre en español cuando la tesela lo trae, y los aeropuertos de la región por su código IATA entre los zooms 7 y 12;
  - el aeródromo como lo dibujan las teselas: plataformas, pistas, calles de rodaje y, desde el zoom 13, el designador de pista («08/26», como lo publica el mapa; nada dice qué pista está en uso).

  Sin puntos de interés, escudos de carretera ni cobertura del suelo. PUJ se dibuja una sola vez, con su punto de referencia, desde la capa de referencias del OCC.
- `basemap: false` arma el estilo sin la fuente vectorial; el laboratorio lo usa con `?basemap=none`.
- La prueba del estilo lo valida, con y sin mapa base, con `validateStyleMin` de `@maplibre/maplibre-gl-style-spec`. Ese paquete ya llega con `maplibre-gl` 6.16.0 (versión 26.4.4) y no se declara aparte.
- *Por qué:* va en el bundle (el propio origen, ninguna petición de estilo y la CSP sin cambios), lee la paleta directamente, se valida en vitest y sus ids son nuestros.
- *Descartado:*
  - reteñir en tiempo de ejecución el estilo `dark` de OpenFreeMap, que puede cambiar sus 47 ids de capa cuando quiera y tiene los dos huecos de sprite;
  - un JSON estático en `public/`, un segundo artefacto que sincronizar;
  - una variable por entorno para la URL del estilo: las cuatro se retiraron de `.env.example` y del código.

**5. Una sola paleta oscura, atada a los tokens.**
- `style/mapTheme.js` (`BASEMAP_COLORS`) guarda solo los colores del mapa base, en pizarra neutra: la tierra (`#1a2125`) cerca de `--occ-canvas` (`#161E22`), el mar (`#0e1417`) más oscuro, y la costa, las fronteras, las carreteras, los edificios, el pavimento y los rótulos en la misma familia, sin azul marino.
- Los colores de estado, la selección y las señales no son del mapa base. Toda capa que los pinta los lee de `occ-ui/occPalette.js` (`occColor`), y una prueba falla si `mapTheme.js` copia el valor de un token:
  - las posiciones se dibujan con los siete estados de `occ-ui/statusVocabulary.js`, y los estados normales no llevan tono;
  - los vuelos van en `--occ-text`, sin un color por estado;
  - lo elegido es el borde de 2 px en `--occ-accent`, en una fuente propia (`occ-selection`) con una entidad como mucho;
  - no hay verde ni naranja.
- Pruebas de la paleta: una pizarra de baja saturación y sin tono azul marino, el mar más oscuro que `--occ-canvas` y la tierra cerca de él, y rótulos con un contraste de al menos 4,5:1 sobre lo que tienen debajo.
- No hay paleta clara, `paintDiff.js`, parámetro de tema ni `setStyle` después de arrancar. `core/noSetStyle.test.js` recorre todo el código de los mapas (`src/features/maps`, `app/map-lab` y los dos adaptadores) y falla con una llamada a `setStyle`. Sus únicas excepciones son `RegionalTrafficMap.jsx` y `GoesCloudMap.jsx`, y la prueba falla cuando una de ellas desaparece, así la lista no las sobrevive. Los adaptadores aceptan la prop `theme` y la ignoran.
- *Por qué:* decisiones 16, 17 y 18. Una paleta reduce a la mitad la revisión, y cambiar solo la pintura exigiría un motor de diferencias para nada.
- *Descartado:* las paletas `dark` y `light` con `paintDiff.js` que proponía el diseño, sin objeto tras la decisión 16; su azul marino (mar `#07111f`, tierra `#101d2e`), el verde para lo normal y el naranja para «demo»; y `setStyle(url)` por tema, como antes.

**6. Sin sprite: íconos SDF propios y solo glifos Noto Sans.**
- El estilo no tiene `sprite`. `style/mapImages.js` dibuja cada ícono cuando el estilo lo pide (`setMissingStyleImageResolver`), a partir de sus propios trazos, y `style/sdf.js` lo convierte en un campo de distancias con la convención de MapLibre (el borde en 0,75). MapLibre lo pinta con el `icon-color` de la capa y un halo opcional.
- Catorce ids fijos, sin tema ni color en el nombre: `stand-frame-solid`, `stand-frame-solid-2px`, `stand-frame-solid-2-5px`, `stand-frame-dash-4-3`, `stand-frame-dash-2-2`, `stand-frame-dot-1-3`, `stand-slab`, `stand-hatch`, `glyph-aircraft`, `glyph-axis`, `glyph-clock`, `stand-selected`, `aircraft-solid` y `airport-arp`. La silueta del avión es la de `maps/aircraftSilhouette.js`.
- Cada contorno de `statusVocabulary.js` tiene su marco, dibujado con su ancho y su trazo: 1 px «Libre» y «Sin verificar», 1,5 px «Planificada» e «Inhabilitada», 2 px «Ocupada» y «Por liberar», y 2,5 px «Llegando». El ancho va en la imagen porque `icon-size` escala toda la posición, y un halo solo engruesa la línea y mantiene su ancho en píxeles de pantalla cuando el zoom o la inclinación cambian el tamaño de la posición.
- Los rótulos del mapa usan solo `Noto Sans Regular`, `Noto Sans Bold` y `Noto Sans Italic`, las tres familias que sirve el servidor de glifos de OpenFreeMap; una prueba falla con cualquier otra. Manrope e IBM Plex Mono quedan para los paneles DOM.
- *Por qué:* ningún archivo binario ni paso de build, una imagen sirve para todos los colores de estado y no hay huecos de sprite que tapar. MapLibre admite una sola URL de glifos por estilo.
- *Descartado:* una hoja de sprites precompilada; marcadores DOM, que saltan, no escalan y cuestan por avión; servir glifos propios de IBM Plex Mono, que obligaría a servir también todos los rangos de Noto; `font-faces`, que MapLibre GL JS no implementa.

**7. Una selección en la URL y las teclas del mapa.**
- `core/mapSelection.js` es puro (`readSelection`, `writeSelection`, `matchFlight` y `relatedEntities`), y `core/useMapSelection.js` escribe con `useAppSearchParams` y `{ replace: true }`, siempre desde la consulta actual. Solo toca sus claves y conserva las demás (`stationId`, `operationId`…):

  | Clave | Valor |
  |---|---|
  | `flightId` | un `flightKey`, un `visitKey`, un id de pierna o un id de escala; los enlaces de hoy, con un id de pierna, siguen sirviendo |
  | `stand` | el código de posición normalizado (`A01` es `A1`) |
  | `hex` | el código ADS-B, en minúsculas, de un avión que no es un vuelo de ELEVANT |
  | `view` | `region`, `approach`, `airfield` o `ramp` |
  | `terminal` | `A`, `B` o `FBO`, solo con `view=ramp` |
  | `follow` | `1` |
  | `focus` | `map` (el mapa maximizado) |

- Una selección a la vez. Una URL escrita a mano con varias claves se lee como la primera de vuelo, posición y avión, y un valor fuera del contrato se lee como nada. Los dos tramos de una visita llevan a la llegada. Hasta que A1 traiga `normalizeStandCode`, los códigos pasan por `mapStandCode`.
- `relatedEntities` queda mínima y lee los vuelos del mapa (las posiciones traerán sus visitas con M4):
  - un vuelo marca su posición: la asignada, o la sugerida de un vuelo demo sin importar;
  - una posición marca su vuelo actual o el siguiente: la primera pierna, por hora, de una visita que sigue contando en ella. La visita se juzga entera, por su `visitKey`, porque una llegada sigue en `arrived` o `landed` cuando el avión ya se fue y la asignación sigue abierta después del PUSHBACK;
  - una visita deja de contar cuando se registra su PUSHBACK, cuando una de sus piernas despegó o se desvió, cuando se cancela su llegada y, en un vuelo demo, desde que el reloj del servidor saca el avión de la posición (`TaxiOut`, `Departed` o `Gone`). Una salida cancelada sola deja el avión donde está: la visita sigue contando por su llegada.
- En M2, `OccMap` lee `view` y `terminal`, y escribe `view` cuando una persona elige una vista en el selector, que tiene las cuatro; la vista de una terminal se abre por ahora desde la URL. El laboratorio escribe la selección. Mapa de posiciones y Monitoreo siguen pasando al mapa su propia selección, hasta que U3 y U5 los lleven al almacén.
- Teclas: el manejador de `occ-ui/occShortcuts.js` escucha `keydown` en la raíz del mapa, en fase de burbuja, nunca en `document`. M2 conecta `1` a `4`, las vistas, que no responden sin motor, y `Esc`, que limpia la selección cuando la hay. `D`, `S` y `L` siguen en la tabla, y las conectan los PR que traen el menú de capas (M5), el seguimiento (M6) y el 3D (M7).
- `Esc` cierra primero el cajón o el diálogo abierto y solo después limpia la selección:
  - el manejador ignora una tecla ya atendida (`defaultPrevented`) y no hace nada mientras hay un `[role=dialog][aria-modal=true]` montado o `isShortcutBlocked()` avisa de un cajón abierto;
  - `PositionDetailDrawer`, `ProviderFlightsDialog` y `useEscapeToClose` llaman a `preventDefault()` al cerrarse con `Esc`;
  - una prueba comprueba que una `Esc` cierra solo el detalle de la posición y que la siguiente limpia la selección.
- *Por qué:* contratos 2.1 y 2.2. El mapa, las listas, los tableros y los cajones leen una sola selección, que sobrevive a una recarga y se comparte como enlace, y las teclas nunca le quitan una tecla a un campo ni a un diálogo.
- *Descartado:* escuchar en `document`, que dispara bajo los diálogos y los campos; una selección solo en un contexto de React, que se pierde al recargar y no deja enlaces; `Ctrl K`, las secuencias `g`, pasar de posición en posición y el diálogo de atajos, que el plan aplaza.

**8. Cuatro vistas y una por terminal, con umbrales derivados del encuadre real.**
- `core/cameraPresets.js` es puro:

  | Vista | Encuadra | 3D |
  |---|---|---|
  | `region` | el anillo de 250 NM alrededor del punto de referencia de PUJ | no |
  | `approach` | el anillo de 40 NM | no |
  | `airfield` | hasta que M3 traiga la caja del aeropuerto, el anillo de 1,5 NM unido a las posiciones, más 300 m | inclinación 40°, rumbo −17° |
  | `ramp` | las posiciones ubicadas más 120 m: sus puntos, hasta los polígonos de M4 | inclinación 55°, rumbo −17° |
  | `ramp` + `terminal` | las posiciones de la terminal A, B o FBO más 120 m | como `ramp` |

  En 2D todas las vistas miran al norte. La vista de una terminal se abre por ahora desde la URL (`view=ramp&terminal=B`), porque el selector tiene las cuatro vistas. Las posiciones que encuadran las vistas salen de la lista corta `stands/standReference.js` (código, terminal y centro de las 41 posiciones del catálogo de referencia, sin la B33), nunca de un plano completo.
- `OccMap` encuadra cada vista en el espacio que dejan libre los paneles (`insets`, con `cameraForBounds` y `absolutePadding`) y vuelve a encuadrar cuando cambia el tamaño del mapa o de los paneles. De esos encuadres salen los umbrales: las posiciones aparecen desde el encuadre de Aeródromo − 0,3 (`polygons`), y sus códigos desde el de Rampa − 0,3 (`codes`), donde el punto de referencia de PUJ se oculta; el umbral de los rótulos de tres líneas, Rampa + 0,8 (`threeLine`), ya se calcula y lo usarán las capas de M4 y M5. El límite entre dos vistas queda a medio camino entre sus encuadres, así el selector marca la vista que la cámara muestra de verdad después de un zoom libre.
- Transiciones: `flyTo`, con curva 1,42, cuando el zoom cambia más de 2,5 niveles, y `easeTo` si no, con una duración explícita de 600 + 220 × |Δzoom| ms, entre 600 y 2 600. Sin `maxDuration`, que convierte un vuelo largo en un salto, y con `essential: false`, así MapLibre las hace instantáneas con «reducir movimiento».
- Vista de entrada: Mapa de posiciones, Planificación y la plataforma de la consola abren en Rampa; Monitoreo, en Región, o en Aproximación cuando el vuelo enlazado está a 40 NM o menos. Manda la vista de la URL y después la cámara que guardó la página. Un mapa que aún no tiene tamaño espera y encuadra en cuanto tiene sitio.
- *Por qué:* la rampa mide 2,2 km de ancho y, con los paneles abiertos, un umbral fijo dejaría sin rótulos la vista por defecto (ajustes del plan). El encuadre cambia con la pantalla (1440 o 1920 px) y con los paneles.
- *Descartado:* números fijos de zoom por vista (el diseño cortaba en 8, 12 y 15); una vista «Clima»: el clima es una capa (M8).

**9. Una leyenda de lo que hay en pantalla.**
- `ui/MapLegend.jsx`, con `ui/legendEntries.js`, lista solo lo que hay en pantalla, en la parte del mapa que dejan a la vista los paneles (`insets`): lo que tapan no cuenta, y la leyenda cambia cuando un panel se abre o se pliega. Lista:
  - primero, el avión de los vuelos dibujados ahí: «Vuelo», que apunta según su rumbo, o al norte si no se conoce (Monitoreo de vuelos);
  - los estados de las posiciones dibujadas una a una, en el orden del vocabulario. Mientras MapLibre agrupa las posiciones, una que no tiene vecinas dentro del radio del grupo se sigue dibujando suelta, con su estado: por eso, en esas vistas, la leyenda lee de lo que el mapa pinta (`queryRenderedFeatures` sobre el marco de cada posición y sobre los grupos) y lo vuelve a leer cuando el mapa queda en reposo (`idle`), porque justo después de un movimiento pueden faltar las teselas del zoom nuevo;
  - «No oficial», cuando una de ellas no la ubicó OCC y está en su ubicación de referencia interna;
  - qué es un grupo, cuando hay un grupo de posiciones en pantalla.
- Cada muestra dibuja lo que dibuja el mapa. La de una posición lleva su relleno, el contorno con el ancho y el trazo del marco de su estado, y el símbolo de dentro, así «Ocupada», «Llegando» y «Por liberar» se distinguen sin color. La de un vuelo es la silueta sólida en el color del texto, con su halo.
- Es la única leyenda del mapa en Mapa de posiciones, Planificación y Monitoreo de vuelos. Mapa de posiciones y Monitoreo ya no montan la suya (`PositionLegend` y `FlightLegend`), que explicaba con colores por estado lo que el mapa ya no dibuja así. La plataforma de la consola conserva su leyenda en línea hasta que U3 retire el dashboard actual, que el carril de mapas no edita.
- Se pliega con su propio botón, que siempre se llama «Leyenda» e indica con `aria-expanded` si está abierta, y no se muestra cuando no hay nada que explicar. Solo cambia cuando cambia lo que hay en pantalla, nunca por cuadro. Va abajo, en el centro, con el selector de vistas (`ui/MapDock.jsx` y `ui/MapPresetSwitcher.jsx`).
- *Por qué:* lo pidió Erick: cada mapa muestra su leyenda. Una leyenda de todo explicaría lo que la pantalla no muestra, y dos leyendas con codificaciones distintas se contradirían.
- *Descartado:* una leyenda fija con los siete estados; abrirla con una tecla, porque es un botón (contratos 2.2); conservar la leyenda de la página junto a la del mapa.

**10. La atribución, escapada y solo con enlaces https.**
- `core/attribution.js` (`buildAttribution(fuentesActivas, { aircraftDataLabel })`) arma los créditos de cada mapa:
  - la parte fija, «© OpenStreetMap contributors · OpenFreeMap · © OpenMapTiles» con sus enlaces, el mismo texto que lleva la fuente vectorial, así MapLibre lo muestra una vez;
  - después, un crédito por cada fuente que nombre la API mientras esté activa, «Datos de aeronaves: {nombre}» enlazado a su página y, si la hay, a su licencia, sin repetirse (decisión 6; llega con M5).
- El texto que viene de la API se escapa, y solo una URL absoluta `https:` se vuelve enlace: `http:`, `javascript:`, `data:` y las rutas relativas quedan como texto. MapLibre vuelve a sanear el resultado.
- El control compacto empieza cerrado y sigue cerrado hasta que la persona lo abre: MapLibre 6.16 lo abre al añadirlo y otra vez cuando llega su contenido.
- *Por qué:* hay que dar el crédito de la red de tráfico, y su nombre y sus URL llegan de la API.
- *Descartado:* concatenar en el HTML el texto de la API y fiarlo todo al saneado de MapLibre.

**11. Un laboratorio de mapas solo para desarrollo.**
- `app/map-lab/page.jsx` importa `MapLabLoader` dentro de `if (process.env.NODE_ENV === 'development')` y, si no, llama a `notFound()`. El cargador abre `src/features/maps/lab/MapLab.jsx` con `next/dynamic` y `ssr: false`, porque el laboratorio dibuja con WebGL y lee la URL y el reloj del navegador.
- El build de producción descarta esa rama con su importación. `scripts/verify-map-chunks.mjs`, el último paso de `npm run build` y por eso listado en `Dockerfile.dockerignore`, falla si un chunk de `.next/static` o de `.next/server` lleva la marca del laboratorio (`data-occ-map-lab`) o el nombre de su cargador; si no, escribe `PRIVATE_WEB_MAP_LAB_ABSENT_OK`. `test:delivery` prueba esa comprobación.
- Siete escenas fijas (`lab/scenes.js`), con datos sintéticos sobre las 41 posiciones de referencia: `ramp-points` (los siete estados), `ramp-selected` (la A5 elegida), `airfield`, `approach`, `region`, `unavailable-fallback` (el navegador rechaza WebGL) y `basemap-degraded` (cada petición del mapa base falla dentro del navegador, sin salir a la red).
- La URL decide qué se ve: `?scene=`, `?basemap=none`, `?t=<ISO>` (el reloj del mapa congelado con `setNow` de MapLibre) y las claves de selección del mapa. `window.__occMapLab` le da a la suite la cámara, el píxel de un punto o de una posición, los mapas vivos y «Releer posiciones». Sin sesión ni API.
- *Por qué:* capturas y comprobaciones deterministas sin iniciar sesión ni levantar la API.
- *Descartado:* una importación estática con un render condicional, como la de `DevPreviewPanel`, que no deja el módulo fuera del bundle; una ruta protegida por una variable de entorno, que también lo empaqueta.

**12. Una suite visual con Playwright.**
- Una sola configuración de Playwright en AVIAM Web:
  - la dependencia de desarrollo que ya existía, `playwright` 1.64.1, con su `playwright/test` y su comando `playwright`;
  - `playwright.occ.config.mjs` y el script `npm run test:visual`;
  - las pruebas en `tests/visual/**`, que importan de `playwright/test`; `vitest` excluye `tests/visual/**`.
- Dos proyectos: `lab`, el laboratorio de mapas, y `occ`, las pantallas del OCC con una sesión sintética y la API simulada (hoy, Mapa de posiciones). Google Chrome a 1440×900, con densidad 1, «reducir movimiento» (las pruebas de cámara lo quitan), `es-DO` y `America/Santo_Domingo`, dibujando por software con SwiftShader. Un worker, sin reintentos, trazas ni informe HTML.
- Sin red (`tests/visual/support/isolate.mjs`). Cada petición a otro origen se responde desde la suite o se aborta, y una prueba falla si una petición salió hacia un origen que la suite no responde o si un rótulo pidió un rango de glifos que los fixtures no tienen:
  - la TileJSON de OpenFreeMap es un fixture sintético, y las teselas vectoriales, un mundo inventado alrededor de Punta Cana (`support/syntheticTiles.mjs`), vacías o fallidas cuando la prueba lo pide;
  - el rango `0-255` de los tres Noto Sans sale de `tests/visual/fixtures/glyphs`, descargado una vez y sin modificar (licencia SIL OFL 1.1; su README guarda el origen y el SHA-256);
  - la API (`https://api.elevant.test`) la responde el stub, con un 404 en Problem Details para lo demás, y sus WebSockets se cierran;
  - la hoja de Google Fonts que importa el CSS del acceso responde vacía.

  Además, el Chrome de la suite no resuelve ningún nombre salvo `localhost`.
- Qué comprueba:
  - los botones de vista y las teclas `1` a `4` escriben `view=`; un clic en una posición escribe `stand=`, y `Esc` lo limpia;
  - la leyenda lista solo los estados en pantalla, y en Mapa de posiciones es la única;
  - la lista de respaldo sin WebGL, y el aviso del mapa base caído con las posiciones todavía clicables;
  - que los botones de zoom y las vistas mueven de verdad la cámara, en `next dev` y en un build de producción (lección 4 de M1);
  - que un doble montaje de Strict Mode deja un solo mapa y la página llega a `networkidle`, y que releer las posiciones conserva el mismo lienzo y pide la TileJSON una sola vez (lección 7);
  - que ninguna petición sale hacia un origen inesperado.
- Las capturas de cada escena, más la terminal B de cerca, la rampa sin mapa base, la rampa a 1920×1080 y Mapa de posiciones, se escriben en `test-results/visual/` para que una persona las revise. No hay líneas base de imagen: cambian con la máquina y la GPU.
- Corre contra `next dev` por omisión y contra un build de producción con `OCC_VISUAL_TARGET=production`; allí el proyecto `lab` solo comprueba que `/map-lab` responde la página de no encontrada. No está en el CI: se corre antes de mergear un cambio de mapas.
- *Por qué:* un mapa WebGL solo se ve en un navegador, y la lección 4 de M1 no aparece en jsdom. Aislar la red cumple la regla de que ninguna prueba llama a un proveedor.
- *Descartado:*
  - añadir `@playwright/test`, como pedía el diseño: `playwright` 1.64.1 ya exporta `./test`;
  - un segundo corredor de Playwright, y líneas base de píxeles;
  - correrla ya en el CI, que pediría Chrome con WebGL por software y tiempo: el recorrido del ciclo de Public Web tampoco está en el CI.

### Lo que añadirán M3 a M8

| PR | Qué añade |
|---|---|
| M3 «Datos de MDPC y aeródromo» | El conjunto de datos versionado `airport/data/mdpc.layout.json` (pistas y umbrales, calles de rodaje con su grafo, plataformas, terminales, puntos de espera y las posiciones como polígonos con rumbo, tamaño y tipo), generado desde OpenStreetMap, OurAirports y los puntos de ELEVANT con una tabla de correcciones, y su revisión manual firmada. Desde el zoom 12 el aeródromo se dibuja con esos datos propios: las capas `aeroway` de las teselas, que hoy dibujan también la rampa, reciben su `maxzoom`, y la vista Aeródromo encuadra la caja del conjunto de datos. |
| M4 «Posiciones en rampa» | Los polígonos de las posiciones con los siete estados, las pastillas por terminal, las posiciones combinadas, la cobertura y «Ubicar en el mapa» con confirmación. Rampa encuadra los polígonos, y las posiciones traen sus visitas a la selección. |
| M5 «Tráfico real en el mapa» | Los aviones de `occ/map/air-picture` con siluetas a escala por categoría, sus etiquetas y estelas, el bloque de datos, el menú de capas (tecla `L`), los anillos de distancia, los ejes de pista, los aeropuertos de la región, el satélite y el viento en el mismo lienzo, el avance de los hitos en las posiciones y el crédito de adsb.fi en la atribución. |
| M6 «Cinemática y vuelo demo en el mapa» | Trayectorias que son funciones de la hora del servidor, el rodaje por el grafo, el vuelo demo ajustado a los instantes del servidor, el relevo entre la señal y la estimación, la ruta del vuelo elegido hasta su posición, el modo seguir (tecla `S`) y la pausa. |
| M7 «Aviones 3D» | three.js 0.187.0 en su propio trozo asíncrono, como capa personalizada sobre el mismo contexto WebGL, con aviones procedurales, luz solar, un regulador y la recuperación del contexto; encendido por defecto en Aeródromo y Rampa (tecla `D`). `verify-map-chunks.mjs` suma su regla: ningún `WebGLRenderer` en la carga inicial de una ruta del OCC. |
| M8 «Capas aeronáuticas y clima» | La FIR aproximada, las radioayudas, el día y la noche, y el clima por la API (`occ/weather`, con el METAR y el TAF en bruto) como capa. |

Cada uno amplía la nota del Vault de Private Web. Un cambio de estas decisiones se añade como nota fechada al final de este ADR, sin reescribirlo.

## Consecuencias

- Las mismas pantallas, sobre un solo motor:
  - Mapa de posiciones, la vista «Mapa» de Planificación y la plataforma de la consola usan `PositionMap.jsx`, y Monitoreo de vuelos usa `FlightMap.jsx`. Los dos quedan como adaptadores finos de `OccMap`, con las mismas props, el mismo manejador imperativo, los mismos `data-testid` (`position-map-container` y `flight-map-container`) y los mismos textos de respaldo, así que sus páginas y las pruebas que los sustituyen no cambian.
  - Las posiciones se dibujan como puntos en el slot `stands`, con lo que significaban sus marcadores y el estado que ya traían, en el vocabulario de los siete estados; «Llegando» y «Por liberar», que las pantallas todavía no derivan, llegan con el modelo de posiciones de M4. Se agrupan hasta que se distinguen. Los vuelos que traen posición son siluetas orientadas en el slot `traffic`, y PUJ se marca con su punto de referencia.
  - La ficha del vuelo de Monitoreo queda fija en una esquina del mapa y ya no sigue al avión.
  - Al releer la misma estación, Mapa de posiciones y Monitoreo conservan sus datos en pantalla mientras llega la respuesta (`usePositionsMapData` y `useFlightMonitoringData`): la página no vuelve al esqueleto y el mapa no se crea de nuevo. Un cambio de estación o de cuenta sí empieza vacío.
  - El clic en un grupo de posiciones acerca el mapa: el motor espera la promesa de `getClusterExpansionZoom`.
- Lo que se retiró:
  - `GoogleFlightMap.jsx`, `GooglePositionMap.jsx` y `googleMapsLoader.js`, con `@googlemaps/js-api-loader`: el lockfile solo pierde esa entrada y su único transitivo, `@types/google.maps`;
  - los huérfanos `AirfieldMap.jsx` y `AirfieldPanel.jsx`, con los mensajes `airfield.*` del dashboard;
  - `AircraftMarker.js`, `AirportMarker.js`, `aerowayLayers.js`, `positionMapLayers.js` y `positionMarkerIcons.js`, cuyo trabajo pasa a capas del estilo en `src/features/maps/`;
  - las cuatro variables `NEXT_PUBLIC_*_MAP_STYLE_*`.

  Con ellos se van los `data-testid` `airfield-map-container`, `google-flight-map-container` y `google-position-map-container`, que ninguna prueba que quede usa. Entran `occ-map`, `occ-map-host`, `map-preset-switcher`, `map-legend` y `map-unavailable`.
- Los marcadores de los mapas ya no pintan con `STATUS_COLORS`: para los mapas se cierra lo que ADR-0044 dejó pendiente. Mapa de posiciones y Monitoreo de vuelos ya no montan su propia leyenda (`PositionLegend` y `FlightLegend`), que explicaba esos colores: la del mapa es la única (decisión 9). Los dos componentes quedan sin montar, y el resumen de Mapa de posiciones (`PositionSummary`) sigue pintando con `STATUS_COLORS`, hasta que U5 rehaga esas pantallas.
- La consola actual conserva tres mapas (la plataforma, la región y la meteorología), y su vista ampliada monta otro mapa en un diálogo, hasta que U3 la rehaga como un solo `OccMap` a pantalla completa.
- Sin cambios fuera de AVIAM Web:
  - no cambian la API, el OpenAPI, el cliente compartido ni la base, y no hay migración;
  - no entra ninguna dependencia, y sale `@googlemaps/js-api-loader`;
  - la CSP no cambia: la TileJSON, las teselas y los glifos siguen en `tiles.openfreemap.org`, que ya estaba permitido, y el worker sigue en el propio origen;
  - solo se despliega AVIAM Web (`frontend/private-web`).
- El riesgo R7 del Vault («Dependencias cartográficas demo») sigue abierto: OpenFreeMap es un servicio público sin acuerdo de servicio. Cambiar de proveedor es ahora un cambio de código (`OPENFREEMAP_TILEJSON` y `GLYPHS_URL`, en `occStyle.js`) y de la CSP, no una variable.
- Pruebas nuevas, junto a cada archivo: las del motor y de `OccMap` (con la de `Esc`), las vistas, la selección, la atribución, el estilo, la paleta, los íconos y el SDF; las capas de posiciones, de referencias, de selección y de vuelos; la leyenda y el selector de vistas; los mensajes en español e inglés; el laboratorio y sus escenas; `noSetStyle.test.js` y el mapa falso compartido. Además, la comprobación de `verify-map-chunks.mjs` en `test:delivery` y la suite visual. Se reescribieron las pruebas de `FlightMap.jsx` y `PositionMap.jsx`, y se borraron las de los archivos retirados. Mapa de posiciones y Monitoreo de vuelos tienen además una prueba con su mapa real, que exige un solo botón «Leyenda».

**Queda pendiente**
- **`demotiles.maplibre.org` en la CSP.** Ningún mapa lo usa desde M2, pero sigue permitido. Retirarlo cambia a la vez los tres archivos que afirman la CSP (`src/config/securityHeaders.mjs`, `scripts/test-development-delivery.mjs` y `frontend/scripts/deployment/csp-tool.mjs`), la prueba de este último (`frontend/tests/deployment/test-csp-tool.mjs`) y las dos notas del Vault que describen los orígenes (Private Web e Integraciones externas). Va en un cambio aparte.
- **El anfitrión que conserva el motor entre rutas** (`core/engineHost.js`, con la cámara entre los módulos del OCC), que el plan aplaza. Hoy cada ruta crea su mapa, sobre el grupo de workers ya precalentado.
- **Mapa de posiciones**: a 1440×900 su resumen (`PositionSummary`) tapa la escala, el botón de los créditos y las posiciones A1 a A5, y todavía pinta sus colores de estado. Lo rehace U5, que también le pasará al mapa la zona que tapan sus paneles (`insets`).
- **`/map-lab` en producción** responde la página de no encontrada con el estado 200, no con un 404: el layout raíz transmite cada página dentro de un `Suspense`, así que Next manda esa página con el 200 ya enviado y la marca `noindex`. El laboratorio no está en el bundle.
- **Los mapas viejos del dashboard** (`RegionalTrafficMap.jsx` y `GoesCloudMap.jsx`) conservan su ciclo de vida, `basemapStyles.js` con los estilos publicados de OpenFreeMap y `collapseCompactAttribution.js`, hasta que U3 borre el dashboard actual.
- **El 3D de M2** es la inclinación de cámara de siempre, más los edificios con altura en la plataforma de la consola. Los aviones 3D, el 3D encendido por defecto en Aeródromo y Rampa, y recordar esa elección llegan con M7.

## Actualización (13 de noviembre de 2026). PR M3: conjunto de datos de MDPC

M3 «Datos de MDPC y aeródromo» trae el plano propio del aeropuerto de Punta Cana y dibuja con él el aeródromo. Las posiciones siguen siendo los puntos de M2: sus polígonos, sus estados y su leyenda llegan con M4. El código llegó en tres pasos: el generador con sus entradas y el plano (`152eb092`), el aeródromo dibujado con el plano (`28640235`) y la escena de revisión del laboratorio (`c14baf17`). Esta nota amplía las decisiones de arriba sin reescribirlas. Donde el diseño y la página de contratos del plan difieren, manda la página de contratos; las diferencias están al final de la nota.

**1. Un JSON generado dentro del bundle.**
- `src/features/maps/airport/data/mdpc.layout.json` (esquema 1; unos 157 KB, 20 KB comprimido) guarda:
  - las dos pistas con sus umbrales y sus marcas, las calles de rodaje y el grafo de rodaje con sus salidas de pista;
  - los puntos de espera, las esperas de plataforma, las plataformas y las terminales;
  - las 42 posiciones (41 activas y la B33 retirada), cada una con su caja, su rumbo, su letra, su entrada, su procedencia y sus marcas de revisión;
  - la pista habitual.
- `airport/airportLayout.js` lo importa (`MDPC_LAYOUT`, congelado en profundidad, con `indexLayout` y `matchStand`), así que quien lo lee lo tiene de forma síncrona. Va con el código del mapa, que las pantallas cargan de forma diferida. `airport/data/region.context.json` guarda los aeropuertos de la región y las radioayudas PNA y PCA; ninguna pantalla lo lee todavía.
- Lo escribe `scripts/maps/build-mdpc-layout.mjs`, con la función pura y determinista de `scripts/maps/lib/buildLayout.mjs`, a partir de cuatro entradas versionadas: el extracto de OpenStreetMap, las filas de OurAirports, los 42 puntos de `positionsData.js` y la tabla manual `stand-overrides.json`. No usa la red ni el reloj: dos corridas dan los mismos bytes. `airport/mdpcLayout.generated.test.js` reconstruye el plano y exige que sea idéntico al versionado, y `--check` hace lo mismo desde la consola. Los módulos que el generador comparte con el mapa (`geo.js`, `taxiGraph.js` y `standGeometry.js`) son puros y también se importan desde Node.
- `core/cameraPresets.js` recibe el plano como parámetro y solo importa `airport/layoutBounds.js`, así que `core/mapSelection.js`, que lo importa, no arrastra el plano. La lista corta `stands/standReference.js` sigue saliendo de `positionsData.js`: los servicios nunca cargan el plano.
- *Por qué:* la cinemática de M6, el modelo de posiciones de M4 y las pruebas lo necesitan de forma síncrona, y va versionado con el código. No pide nada a nadie: ni fetch, ni caché, ni un origen nuevo, ni un cambio de la CSP. El aeródromo se dibuja aunque OpenFreeMap no responda.
- *Descartado:*
  - un archivo en `public/` pedido en tiempo de ejecución, que da estado asíncrono y un fetch simulado en cada prueba;
  - la base de datos: las migraciones no llevan datos de negocio, la geometría no es dato maestro y «Cargar posiciones de Punta Cana» no escribe coordenadas ([ADR-0041](0041-demo-flights-and-punta-cana-stands.md));
  - un endpoint de la API, que no aporta nada del servidor;
  - generarlo en cada build, que pediría red o un paso más del build.

**2. Las fuentes se extraen a mano una vez, y nada las llama en tiempo de ejecución.**
- `scripts/maps/fetch-mdpc-osm.mjs` manda una consulta a la API de Overpass: las vías `aeroway` de pista, calle de rodaje (`taxiway` y `taxilane`), plataforma, posición, terminal y punto de espera, y los nodos de puerta, posición y punto de espera, a 4 km del punto de referencia (18.5674, −68.3634). Usa un User-Agent genérico, respeta las respuestas 429 y 504, y guarda en `scripts/maps/input/mdpc.osm.json` solo las etiquetas que lee el generador. El extracto versionado es la base de OSM del 2026-11-13T17:33:17Z.
- `scripts/maps/fetch-ourairports-mdpc.mjs` baja cuatro tablas del espejo de OurAirports en GitHub y guarda en `scripts/maps/input/ourairports.mdpc.json` las filas de MDPC (sus pistas con los umbrales y sus frecuencias), las radioayudas PNA (VOR-DME 112,7) y PCA (NDB 425) y los 32 aeropuertos grandes y medianos a 300 NM o menos. Se bajaron el 2026-11-13T17:35:18Z.
- Los dos scripts se corren a mano: no los corren las pruebas, el CI ni `npm run build`, y `Dockerfile.dockerignore` deja `scripts/maps` fuera de la imagen, porque solo admite los scripts que lista. Las pruebas del generador usan entradas sintéticas, y la prueba de igualdad solo lee archivos versionados.
- La fuente GeoJSON del aeródromo lleva el crédito «© OpenStreetMap contributors (ODbL) · OurAirports», con sus enlaces (`AIRFIELD_ATTRIBUTION`, en `core/attribution.js`), y MapLibre lo muestra solo mientras el aeródromo está en pantalla.
- Las licencias, cómo se regenera el plano y su revisión están en `src/features/maps/airport/data/README.md`. El extracto y el plano se ofrecen bajo la ODbL 1.0, y la mezcla con los puntos propios puede hacer de todo el plano una base de datos derivada. OurAirports es de dominio público. Ninguna coordenada sale del AIP ni de las cartas del aeropuerto.
- *Por qué:* el navegador no gana ningún origen, la CSP no cambia y el plano se reproduce desde lo versionado.
- *Descartado:* consultar Overpass u OurAirports desde el navegador o desde la API en tiempo de ejecución, que suma un origen o una dependencia, con sus reglas de uso, por datos que cambian muy poco.

**3. El punto de cada posición es su centro (decisión 20 de Erick).**
- Cada uno de los 42 puntos de `positionsData.js` es el centro de su posición. El plano lo copia en `center` (`provenance.center: 'elevant'`) y centra allí la caja, con el fondo a lo largo del rumbo hacia donde apunta la nariz. La entrada va de la calle de rodaje al centro.
- La caja sale de la letra OACI del avión más grande: C 41 × 50 m, D 60 × 66 m, E 73 × 80 m y F 88 × 82 m, ancho por fondo. Con un polígono cerrado de OSM sería la letra más pequeña que lo contiene, pero en MDPC las marcas de posición de OSM son líneas abiertas, sin tamaño: es D, y C en FBO. La caja se estrecha donde la fila no deja sitio (`narrowed`).
- El rumbo sale de la tabla manual; si no, de la línea de posición de OSM casada (a 40 m o menos); si no, de la vecina más cercana de su fila que lo tiene de OSM (a 150 m o menos); y si no, del eje de la fila (`headingAssumed`). La nariz de una posición de contacto mira a su puerta de OSM o a la terminal más cercana. Una remota o de FBO deja la calle de rodaje detrás: de los dos sentidos del eje toma aquel cuya cola mira en línea recta a una calle a 150 m o menos (la más cercana, si las dos lo hacen); si ninguna, el que se aleja de la calle más cercana a la propia posición, siempre que esa calle no corra a lo largo de su fila (a menos de 30° de su línea). Si nada cerca decide, una posición del eje de su fila mira como la más cercana de esa fila que estaciona en paralelo y sí está decidida (`provenance.headingFrom`): B34 y B35 siguen a B36.
- La entrada llega siempre por detrás, a lo largo del rumbo: recta desde la calle que corta la cola a 150 m o menos; si no hay ninguna, el avión se alinea detrás de su caja, a media caja de fondo más media de ancho del centro (63 m en una D), y la entrada va desde la calle más cercana a ese punto, así que no cruza su fila. Si hasta esa calle queda delante de la posición, la entrada sale recta de ella y se marca `leadInNotBehind`.
- `airport/airportLayout.test.js` comprueba que el centro de cada posición es su punto de `positionsData.js`. La lista corta `stands/standReference.js` lee el mismo archivo y no cambia: sus centros son los del plano. M4 decide si pasa a leer el plano.
- *Por qué:* los puntos no dicen si son el centro o la parada de la rueda de nariz, y el centro deja una sola caja posible. La revisión manual lo comprueba.

**4. Las equivalencias nunca se infieren.**
- `matchStand(code, index)` compara con `normalizeStandCode` ([ADR-0041](0041-demo-flights-and-punta-cana-stands.md)): `A01`, `a-1` y `A1` son la misma posición. «1», «9A», «23A» o «N1» solo casan con una posición o con un alias que liste el plano. Los alias salen de `aliases` en `stand-overrides.json`, que nace vacía y solo se llena con lo que confirme el dueño del producto. El alias de una posición nunca le quita su código a otra.
- Las puertas «1» a «11» y «N1» a «N5» de OSM nunca se toman por A1–A11 ni por AN1–AN5: esas posiciones casan con OSM solo por geometría. Las puertas B20 a B31 sí llevan el código de su posición, y el generador las usa para orientar la nariz y para marcar `ambiguous`.
- *Por qué:* «9A» es otra posición, no «A9». Es la regla que ya probaba `dashboardPositions.test.js`.
- *Descartado:* una heurística «1 → A1».

**5. La ubicación que guarda OCC trasladará la caja sin deformarla, con M4.**
- La base sigue guardando solo la ubicación que OCC coloca (`PUT occ/stands/{standId}/location`, [ADR-0027](0027-occ-ready-contracts-and-stand-locations.md)). Con M4, una posición del plano que OCC ubicó se dibujará con su caja y su entrada trasladadas a ese punto, con la misma forma, el mismo rumbo y el mismo tamaño, y una posición que el plano no conoce, con una caja derivada de sus vecinas. En M3 las posiciones siguen siendo puntos y nada traslada ninguna caja.

**6. La revisión manual y los criterios de aceptación.**
- El plano no se da por bueno hasta que el dueño del producto, con el OCC, lo revisa y lo firma. Para revisarlo hay tres cosas:
  - el informe de `node scripts/maps/build-mdpc-layout.mjs --report`, con una fila por posición: su línea de OSM, las distancias, el rumbo y de dónde sale, la letra, el solape, la entrada y las marcas;
  - la escena `/map-lab?scene=layout-qa` del laboratorio, solo en desarrollo (punto 8 de esta nota);
  - la tabla `stand-overrides.json`, donde va cada corrección con su nota. `reviewedBy` (un rol, nunca un nombre) y `reviewedOn` marcan la posición como revisada (`provenance.qa: 'reviewed'`).
- Las marcas que piden a una persona son `unmatched`, `ambiguous`, `far` (a más de 50 m), `overlap` (más del 15 %), `crossesTaxiway`, `leadInCrosses`, `leadInNotBehind`, `offNetwork` y `noLeadIn`; `narrowed` y `headingAssumed` solo explican la caja.
- `airport/airportLayout.test.js` prueba en cada corrida los criterios de aceptación:
  - 42 posiciones: 41 activas con caja, rumbo y letra, y la B33 retirada; cada centro es su punto;
  - cada posición activa llega a todas las salidas de pista por calles de rodaje, sin tramos de pista, y su entrada empieza a 3 m o menos de una calle;
  - cada entrada sale de la calle por detrás de su posición (a más de 90° de la nariz) y no cruza la caja de otra posición activa;
  - el grafo es una sola pieza, y ningún solape pasa del 15 %;
  - los umbrales quedan a 30 m o menos de los de OurAirports;
  - la pista habitual es la 08, como suposición (decisión 19 de Erick);
  - los códigos se normalizan y nada se infiere.
- Estado al cerrar M3: el plano está sin firmar, con las 42 posiciones en `auto`, y quedan 16 marcadas. 14 no tienen geometría en OSM (B31, B32, B34 a B37 y BN6 a BN13); B29 y B30 son ambiguas; y una calle de rodaje cruza BN9. B31 y B32 llevan un rumbo provisional de 175°, con su nota y sin firma. Los rumbos de B34 a B37 (al este) y de BN6 a BN13 (BN6 a BN9 al norte, BN10 a BN13 al sur) salen de su fila.
- *Por qué:* los datos abiertos no bastan. La revisión en el laboratorio no pudo resolver ninguna marca solo con OSM: le faltan 14 posiciones, y en B29, B30 y B31 contradice los puntos de ELEVANT.
- **Actualización del 13 de noviembre de 2026 (revisión firmada).** El dueño del producto revisó el plano con el informe y las capturas de la escena, lo aprobó tal como estaba y decidió que **su documento de coordenadas manda sobre OpenStreetMap**, que está desactualizado en el aeropuerto. La tabla manual firma las 42 posiciones (`reviewedBy` con su rol y `reviewedOn`), y el plano las marca `provenance.qa: 'reviewed'`. B29 y B30 fijan la línea de OSM que pasa por su punto (`osmWay`) y dejan de ser ambiguas; B31 queda al norte del edificio, junto a B32, como dice el documento; BN9 conserva su punto aunque la calle F de OSM cruce su caja. Quedan 14 posiciones con marcas, como dato y ya revisadas. Ninguna posición se corrige hacia OSM: solo OCC mueve una, al ubicarla en el mapa.

**7. El aeródromo se dibuja con el plano desde un umbral derivado, `airfield`.**
- `THRESHOLD_NAMES` suma `airfield`, el punto medio entre los encuadres de Aproximación y Aeródromo: la misma frontera que usa `presetForZoom` para el selector, así que siempre que el selector dice «Aeródromo» el aeródromo sale del plano. No es el zoom 12 fijo del diseño ni el de la tabla «Lo que añadirán M3 a M8»: cambia con la pantalla y los paneles, como los demás umbrales (decisión 8 de este ADR).
- Desde ese umbral, `style/airfieldLayers.js` dibuja en el slot `airfield`, en el grupo `airfield` y desde la fuente `occ-airfield`, que `OccMap` llena una sola vez con `airport/airfieldFeatures.js`:
  - las plataformas y las terminales, con su contorno;
  - las calles de rodaje, con su nombre tenue;
  - las pistas: su pavimento y una línea de umbral a umbral, con el eje a trazos, las barras de umbral y el designador;
  - los puntos de espera, como barras de 30 m.

  El pavimento usa los colores y los anchos del mapa base, así que el relevo con las teselas no salta. Las marcas van en `--occ-text` y los nombres en `--occ-faint`: ningún tono.
- Por debajo del umbral, las capas `aeroway` de las teselas, con su designador, quedan como contexto: llevan `occ:maxThreshold: 'airfield'`, así que el aeródromo nunca se dibuja dos veces.
- Al pasar el puntero por una pista o una calle de rodaje sale una ficha que no es modal (`ui/MapTooltip.jsx`): «Pista 08/26 · 3100 m × 45 m», «Calle de rodaje A» o «Calle de rodaje sin nombre». Un clic la fija, y un clic en otra parte o un cambio de vista la cierra, así que nada depende solo del puntero. La leyenda suma pista, calle de rodaje, punto de espera, plataforma y terminal, solo cuando están en pantalla (decisión 9 de este ADR).
- Las vistas salen del plano: Aeródromo encuadra su caja más 300 m; Rampa, los polígonos de las posiciones activas más 120 m, ya en M3 y no con M4; y cada terminal, los suyos más 120 m. Sin plano, como en M2, las encuadran los puntos de las posiciones.
- `OccMap` recibe el plano en la prop `layout`, que por omisión es el de MDPC. Con `null` no dibuja un aeródromo propio, deja las teselas a cualquier zoom y encuadra con los puntos. Lo dibujan todos los mapas sobre `OccMap`: Monitoreo de vuelos, Mapa de posiciones, Planificación y la plataforma de la consola. Los dos mapas auxiliares del dashboard no usan `OccMap` y no cambian. Para el laboratorio, `OccMap` suma `overlayData` (los datos de las capas propias de una pantalla, con un `setData` por cambio) y `onPick` (un clic en lo que una capa propia deja elegir).
- *Por qué:* las posiciones, el grafo y el pavimento siempre coinciden, porque salen del mismo archivo. Un zoom fijo dejaría el relevo lejos del límite de la vista, según la pantalla.
- *Descartado:* el zoom 12 del diseño, y dibujar a la vez el aeródromo de las teselas y el propio.

**8. La escena de revisión del laboratorio.**
- La octava escena, `layout-qa` («Revisión del plano de MDPC», solo en desarrollo; `lab/LayoutQaScene.jsx` con `lab/layoutQa.js`), dibuja sobre el aeródromo:
  - cada caja con su código, una flecha hacia donde apunta la nariz y sus marcas;
  - los puntos de ELEVANT, y las puertas y las líneas de posición de OSM (`qa.gates` y `qa.standLines` del plano);
  - una línea al centroide de OSM cuando el punto queda a más de 15 m;
  - el grafo de rodaje según hasta dónde se llega por él, los puntos de espera y las esperas de plataforma;
  - una sonda de rutas: dos clics en nodos del grafo dan la ruta más corta por las calles de rodaje y su largo.

  La lista lateral muestra las 42 posiciones, primero las marcadas, y un clic encuadra cada una con su entrada, su puerta y su centroide.
- `tests/visual/lab/map-lab.layout-qa.spec.mjs` comprueba la sonda y escribe en `test-results/visual/` las capturas del aeródromo, de cada terminal, de cada posición marcada y de una ruta. `verify-map-chunks.mjs` sigue dejando el laboratorio fuera del build de producción.

**Dónde M3 se aparta del diseño o de lo que anunciaba este ADR** (manda la página de contratos):
- el umbral derivado `airfield`, en lugar del zoom 12 del diseño y de la tabla «Lo que añadirán M3 a M8», y las teselas sin un tramo fijo «z 9–12» (contratos 2.3);
- Rampa encuadra los polígonos ya en M3, y no desde M4, como decía la decisión 8 de este ADR;
- los códigos se comparan con `normalizeStandCode` de A1 (`src/services/standCodes.js`), no con un `airport/standCodes.js` nuevo;
- el punto es el centro (decisión 20 de Erick) y la pista habitual es la 08 (decisión 19), que el diseño dejaba por confirmar;
- siete marcas nuevas: `crossesTaxiway`, `leadInCrosses`, `leadInNotBehind`, `narrowed`, `headingAssumed`, `offNetwork` y `noLeadIn`;
- el sentido de una remota o de FBO sale primero de la calle que su cola corta en línea recta, y solo después de la calle más cercana, que el diseño usaba sola; una posición sin vecina de OSM a 150 m o menos toma el eje de su fila, y si nada cerca decide su sentido, el de la posición decidida más cercana de esa fila (el diseño solo decía «el rumbo de la posición más cercana de la fila»); y donde ninguna calle corta la cola a 150 m o menos, la entrada se alinea detrás de la caja, un caso que el diseño no trataba (decisión 3 de esta actualización);
- la tabla manual pone los alias en un solo mapa, `aliases`; exige una `note` en cada entrada; y admite `kind` `contact`, `remote` o `fbo`, porque las combinadas siguen siendo de OCC ([ADR-0030](0030-position-coverage-per-shift-and-combined-stands.md));
- el plano suma `qa` (las puertas y las líneas de posición de OSM) para la revisión, y `operations.basis: 'owner-decision-19'`;
- el crédito del aeródromo va en su propia fuente, no en `buildAttribution`.

**Consecuencias.** No cambian la API, el OpenAPI, el cliente compartido ni la base; no hay migración, dependencia nueva ni origen nuevo, y la CSP no cambia. Solo se despliega AVIAM Web (`frontend/private-web`).

**Queda pendiente**
- **La firma del plano.** Revisar las 16 posiciones marcadas, el tamaño de cada posición (D por omisión, más estrecha en 27) y las tres esperas de plataforma derivadas, y firmar la tabla, con el dueño del producto y el OCC. La tabla de alias sigue vacía.
- **M4.** Los polígonos con los siete estados y su leyenda, la caja trasladada a lo que OCC ubica, la caja derivada de una posición que el plano no conoce y el origen de la lista corta.
- **La paridad del catálogo en C#** (`DemoStationCatalogParityTests`) sigue comparando con `positionsData.js`. Pasarla a `mdpc.layout.json` es un cambio del carril de la API.
- **`region.context.json`** espera a M5 (los aeropuertos de la región) y a M8 (las radioayudas).

## Actualización (13 de noviembre de 2026). PR M4: posiciones en rampa

M4 «Posiciones en rampa» dibuja cada posición como un polígono con su estado, en lugar de los puntos agrupados de M2 y M3. Lo hace en Mapa de posiciones y en la vista «Mapa» de Planificación, y la plataforma de la consola recibe los polígonos por el mismo adaptador, `PositionMap`. El código llegó en tres pasos: el modelo y la geometría de cada posición (`40597917`), los polígonos con su estado y su leyenda (`3ef22988`), y la ficha, la selección, la cobertura y la ubicación con confirmación (`714dc4a3`). Esta nota amplía las decisiones de arriba sin reescribirlas. Donde el diseño y la página de contratos del plan difieren, manda la página de contratos; las diferencias están al final de la nota.

**1. Siete estados que se leen sin color.**
- `stands/standModel.js` (`deriveDisplayStatus`) decide cómo se lee cada posición, y `stands/standLayers.js` (`standPaint`) la dibuja con lo que dice de cada estado `occ-ui/statusVocabulary.js` (`STAND_STATES`, contratos 2.4), que el carril de mapas importa y no edita. Lo normal no lleva tono: cada estado se distingue por su relleno, por el ancho y el trazo de su contorno y por lo que suma.

  | Estado | Relleno | Contorno | Lo que suma |
  |---|---|---|---|
  | Libre | ninguno | sólido de 1 px, `--occ-line-strong` | el código |
  | Planificada | ninguno | a trazos 4-3 de 1,5 px, `--occ-muted` | el vuelo y, de cerca, su hora |
  | Llegando | un velo: la losa al 40 % (`--occ-arriving-fill`) | sólido de 2,5 px, `--occ-text` | la entrada resaltada y, de cerca, «Llega 14:20 · en 12 min» |
  | Ocupada | la losa (`--occ-panel-raised`) | sólido de 2 px, `--occ-text` | un avión, con la nariz según el rumbo de la posición |
  | Por liberar | la losa | sólido de 2 px, `--occ-text` | el avión, un reloj y, de cerca, «Sale 15:05 · en 8 min» |
  | Inhabilitada | rayas a 45° en `--occ-line-strong` | a trazos 2-2 de 1,5 px, `--occ-line-strong` | «Anulada por A9» y el enlace a la posición que la anula |
  | Sin verificar | ninguno | punteado 1-3 de 1 px, `--occ-faint` | el código, atenuado |

- Cada par de estados difiere en algo que no es el color: `stands/standLayers.test.js` lo comprueba en las capas (el tipo de relleno, la capa del contorno, su ancho y las marcas), y `ui/MapLegend.test.jsx`, en las muestras de la leyenda. Otra prueba lista las capas que llevan tono: el cian solo en lo elegido y en lo que se está ubicando, y el ámbar y el rojo solo en las señales.
- Una capa de contorno por cada trazo del vocabulario (decisión D-1 del diseño), con un `line-dasharray` constante: MapLibre cuenta el trazo en anchos de línea, así que el del vocabulario se divide por el ancho. Los estados de contorno sólido comparten una capa, con el ancho de cada estado.
- Las rayas son un patrón de relleno sin SDF (`stand-hatch-pattern`), pintado en `--occ-line-strong`, porque `fill-pattern` no toma color. Los íconos del estilo pasan de catorce a nueve: `stand-hatch-pattern`, `stand-chip` (la placa estirable de la pastilla), `glyph-aircraft`, `glyph-clock`, `glyph-arriving`, `signal-attention`, `signal-urgent`, `aircraft-solid` y `airport-arp`. Se van los marcos, la losa, el tramado SDF, el eje y el borde de la posición elegida de M2 (decisión 6 de este ADR): los polígonos se pintan con capas de relleno y de línea.
- *Por qué:* decisión 17 de Erick («cabina oscura») y contratos 2.4.
- *Descartado:* los rellenos con tono del diseño (verde, cian, ámbar y rojo en tintes) y un `line-dasharray` que dependa de los datos.

**2. «Llegando» hasta que el avión está en la posición, y la posición libre con el PUSHBACK.**
- La regla de `deriveDisplayStatus` (contratos 2.4 y el punto 3 de los «Ajustes» del plan):
  1. una posición del mapa sin fila en la base es «Sin verificar», y una posición libre anulada por una combinada ([ADR-0030](0030-position-coverage-per-shift-and-combined-stands.md)), «Inhabilitada»;
  2. una visita deja de contar cuando uno de sus tramos la termina (`endsItsVisit`, de `core/mapSelection.js`, la regla de la decisión 7 de este ADR): el PUSHBACK registrado, una salida que despegó, un tramo que se desvió, una llegada cancelada o, en un vuelo demo, el reloj del servidor que ya sacó el avión de la posición. Una llegada en `departed` no la termina: despegó de su origen y viene en camino, porque contratos 1.3 convierte el «Departed» del proveedor en `departed` en los dos tramos. El tablero ya no lista la visita cuyo PUSHBACK está registrado ([ADR-0041](0041-demo-flights-and-punta-cana-stands.md), decisión 23 de Erick), así que la posición pasa a su visita siguiente o queda «Libre»;
  3. con un avión en la posición, «Por liberar» desde 15 minutos antes de su salida y, si no, «Ocupada»;
  4. si no, manda la visita siguiente: «Llegando» cuando su avión aterrizó y todavía no está en la posición, o cuando llega en 15 minutos o menos; si no, «Planificada». Sin visitas, «Libre».
- Si el avión está en la posición lo dice la primera prueba que haya: el instante demo del servidor (ya pasó `demo.onBlockAt`), un `BLOCK_ON` registrado, el avión, en vivo o estimado, dentro de la caja de la posición y, sin ninguna de ellas, la hora real del tramo de llegada solo si es la hora real en posición (`actualKind: OnBlock`, la de «Registrar llegada»): la hora real de pista (`Runway`, la que escriben el feed y el worker de los vuelos demo) solo dice que el avión aterrizó, así que la posición sigue «Llegando». Sin el tramo de llegada decide la hora de llegada del tablero, que es esa misma hora real, sea de pista o en posición. Las cuatro primeras salen de entradas opcionales de la regla (`flightsByTurnaround`, los vuelos de `occ/map/flights` de A3, y `aircraftByTurnaround`, las posiciones de los aviones de M5), y sus pruebas las cubren. Las pantallas de hoy solo le pasan el tablero, así que un vuelo demo importado pasa a «Ocupada» al tocar pista, como antes de M4, hasta que M5 le pase lo demás.
- Los estados y las cuentas regresivas se evalúan en el minuto, redondeado hacia abajo, nunca por cuadro: `stands/useStandDisplay.js` los recalcula con `core/useMinuteClock.js`, que vuelve a pintar la pantalla en cada cambio de minuto con un solo temporizador, sin intervalo ni petición. El laboratorio lo congela con `?t=`. La lista, el resumen y los avisos de Mapa de posiciones siguen con el estado del tablero.

**3. Las señales de atención y de urgencia.**
- Van sobre cualquier estado, encima de la caja de la posición y fuera de su rótulo, con un halo oscuro que llena su «!»; el reloj de «Por liberar» va debajo de la caja. La distancia a la caja crece con el mapa y deja libre un rótulo de dos líneas desde los códigos y uno de cuatro desde las tres líneas, así que nunca tapan el código. Los dos se dibujan siempre, y los rótulos de las demás posiciones les ceden el sitio. El rótulo de una posición con señal se coloca antes que los demás (primero las urgentes y después las de atención), así que su código nunca es el que desaparece:
  - atención, el triángulo ámbar: «Sin agente que la cubra», cuando la lista de cobertura de la posición está vacía (nunca cuando falta: una posición sin fila en la base no sabe quién la cubre) y hay un avión en ella o un vuelo que llega en 60 minutos o menos; y «Pasó su hora de salida», cuando el avión sigue en la posición pasada su hora de salida;
  - urgencia, el octágono rojo: «Otra aeronave llega a esta posición», cuando hay dos aviones en ella, o cuando hay un avión en la posición y otra visita llega antes de que salga: esa visita ya aterrizó, o llega en 15 minutos o menos y antes de la hora de salida del avión que está en la posición. Sin hora de salida, o pasada esa hora con el avión todavía ahí, nadie sabe cuándo se libera, y cuenta como conflicto. Un vuelo que llega a la hora de salida del que está en la posición, o después, no es un conflicto: es lo normal, que no se pinta de rojo, y la posición ya dice «Por liberar».
- El motivo de la señal más urgente va también en el rótulo completo, en la ficha y en el cajón, con su forma y la palabra de `SIGNALS`.

**4. Umbrales derivados del encuadre, nunca un zoom fijo.**
- Las capas de las posiciones nombran los umbrales de la decisión 8 de este ADR (contratos 2.3), que cambian con la pantalla y con los paneles:
  - por debajo de `airfield`, el punto medio entre los encuadres de Aproximación y Aeródromo, nada de las posiciones: Región y Aproximación no las muestran;
  - entre `airfield` y `polygons`, una pastilla por terminal (punto 5);
  - desde `polygons`, el encuadre de Aeródromo − 0,3, así que se ven en Aeródromo: los polígonos con su estado, sus señales, el avión, el reloj, la entrada resaltada de «Llegando», el enlace de las combinadas y los bordes de la selección;
  - desde `codes`, el encuadre de Rampa − 0,3: los códigos y los vuelos (una posición libre, su código; las demás, el código y el vuelo, o «Anulada por …»), todas las entradas, en una línea fina de `--occ-line-strong`, y la caja de fuselaje estrecho;
  - desde `threeLine`, el encuadre de Rampa + 0,8, el rótulo completo: el código; el vuelo, con el tipo de avión cuando lo traigan los vuelos del mapa (M5) y «Demo»; la hora de llegada del vuelo que viene («Llega 14:20 · en 12 min») o la de salida del que está en ella («Sale 15:05 · en 8 min»), sin la cuenta cuando ya pasó, con las iniciales de quien la cubre («MC», «MC +1»); y, donde corresponde, «Anulada por …», el motivo de la señal más urgente y «Solo fuselaje estrecho».
- La plataforma de la consola muestra sus códigos desde `polygons` (`labels: 'dashboard'`), como antes. El rótulo de la posición elegida sale de la fuente `occ-selection`, en cian y delante de los demás, desde `polygons`.
- Los rótulos usan Noto Sans Bold de 12 px (13 en las pastillas) y solo caracteres Latin-1. Suben o bajan desde el centro cuando las vecinas no dejan sitio, y se colocan primero los de las inhabilitadas y las de «Llegando», después los de las ocupadas y las por liberar, y luego los de las planificadas, las libres y las sin verificar.
- *Descartado:* los zooms fijos de las tablas D3 y D4 del diseño (12,5, 14,5, 15,5 y 16,5).

**5. Una pastilla por terminal, en lugar de los grupos.**
- `stands/standFeatures.js` (`buildStandFeatures`) da un punto por terminal en el centro de sus cajas, con el texto «A · 3/16»: las posiciones con un avión («Ocupada» y «Por liberar») sobre las que el mapa dibuja de esa terminal. Va sobre la losa, con una junta de 1 px; una flecha encima avisa que un vuelo llega a una de sus posiciones; y un clic abre la vista de esa terminal (`view=ramp&terminal=A`), como lo haría el selector de vistas.
- Las posiciones ya no se agrupan, y con los grupos se va el clic de M2 que los acercaba; el motor conserva `expandCluster`, que ya no usa ninguna capa.

**6. El puntero, la selección y la URL.**
- Bajo el puntero, `hover`; la posición elegida, `selected`; la del vuelo elegido, `related`; y las que cubre el mismo agente, `sameAgent`. Son estado de entidad (feature state) de los polígonos: `stands/standInteractions.js` (`standFlags` y `featureStatePlan`) escribe solo lo que cambia, así que ni el puntero ni la selección reescriben los datos, y el motor los repone tras perder el contexto (decisión 3 de este ADR). La elegida lleva el borde de 2 px en `--occ-accent`; la que está bajo el puntero, el mismo borde, más tenue; la del vuelo elegido, un borde a trazos en cian; y las del mismo agente, un anillo neutro en `--occ-muted`, separado del contorno, alrededor de las otras posiciones que cubre el agente de la que está bajo el puntero o, si no hay ninguna, de la elegida. Para una posición, la fuente `occ-selection` ya no dibuja un borde: lleva su rótulo (punto 4). Un vuelo elegido conserva su anillo.
- La ficha, `ui/MapTooltip.jsx` de M3, dice «A5 · Ocupada», el vuelo con «Demo», «Cubre M. Castillo y L. Peña» y los motivos de las señales con su forma, «Anulada por …» y «Solo fuselaje estrecho». Se coloca debajo o encima de la caja de la posición, así nunca la tapa a ella ni a su rótulo. Nada vive solo en la ficha: el cajón y, de cerca, el rótulo dicen lo mismo.
- Un clic escribe `stand=` en la URL con `core/useMapSelection.js` (contratos 2.1): Mapa de posiciones y Planificación ya no guardan su propia selección. El cajón de Mapa de posiciones tiene su propio estado de abierto, así que una `Esc` lo cierra solo a él y la siguiente, en el mapa, limpia la selección (contratos 2.2). La cámara solo se mueve, con `easeTo` y el mismo zoom, si la posición elegida queda fuera de la parte segura del área a la vista (`isOutsideSafeArea`: un 3 % hacia dentro de cada lado); en Rampa todas están a la vista, así que elegir una no mueve la cámara.
- El cajón de la posición y el panel junto al mapa de Planificación muestran «Estado en el mapa» (`ui/StandDetailFacts.jsx`, con el `data-testid` nuevo `stand-detail-facts`): el estado, con su muestra y su palabra de `STAND_STATES` (las palabras del tablero no conocen «Llegando» ni «Por liberar»); quién la cubre; las señales, con su forma; «Anulada por …»; «Solo fuselaje estrecho»; y de dónde sale la ubicación: «Ubicada por OCC», «Referencia interna sin verificar», con la etiqueta «No oficial», o «Sin ubicar». En el cajón es la única palabra de estado: su cabecera ya no muestra la del tablero (`dashboard/statusMeta.js`), que contradecía a la del mapa («Planificada» frente a «Llegando», «Ocupada» frente a «Por liberar», «Sin ocupación verificada» frente a «Sin verificar»).

**7. Los refrescos solo mandan lo que cambió.**
- `OccMap` llena las cuatro fuentes de las posiciones (polígonos, líneas, rótulos y pastillas) con un `setData` cada una al arrancar, y después manda un `updateData` por fuente con lo que `diffStandFeatures` dice que cambió: una relectura del tablero que cambia una posición solo manda esa posición, y una que no cambia nada no manda nada. El mapa nunca se crea de nuevo.
- Lección de MapLibre 6.16: un cambio que lleva `removeAllProperties` junto con `addOrUpdateProperties` descarta las segundas, y la entidad se queda sin las propiedades con las que se dibuja; en las capturas de M4, una posición dejaba de dibujarse al refrescarse o al moverse. `diffFeatureCollections` manda solo las propiedades que se van o que cambian, nunca `removeAllProperties`, y el mapa falso compartido (`tests/fakeMapLibre.js`) aplica un cambio igual que MapLibre 6.16.
- No hay lecturas ni sondeos nuevos (contratos 2.7): los estados cambian con el reloj de minutos y con las lecturas que las pantallas ya hacían. La raíz de `OccMap` suma `data-occ-settled`, que dice si el mapa ya dibujó todo lo que se le dio; la suite visual lo espera antes de cada captura.

**8. Dónde se dibuja cada posición: el documento del dueño manda sobre OpenStreetMap.**
- `airport/standGeometry.js` (`resolveStandGeometry`) lo decide, y `stands/standModel.js` (`attachStandGeometry`) lo aplica a las posiciones de la pantalla dentro de `OccMap`, que ya tiene el plano:
  1. una posición del plano sin ubicación guardada: la geometría del plano tal cual, centrada en el punto del documento de coordenadas del dueño (decisión 20 de Erick) y marcada «No oficial»;
  2. una ubicación que OCC guardó a 80 m o menos del centro del plano: la caja y la entrada del plano, trasladadas sin deformarlas hasta ese punto, con la misma forma, el mismo rumbo y la misma letra;
  3. más lejos, o en una posición que el plano no conoce (una combinada como «9A», o una B33 que OCC colocó, porque el plano la tiene retirada): una caja propia en el punto guardado, con el rumbo de la posición activa del plano más cercana a 150 m o menos o, si no hay, perpendicular a la calle de rodaje más cercana, con la nariz alejándose de ella (al norte sin grafo); con la letra del avión más grande que admite (E con fuselaje ancho, C con estrecho, D si no se sabe); y con la entrada pegada al grafo de rodaje, como el generador dibuja las del plano. Solo toma rumbo y entrada de una calle de rodaje a 300 m o menos (`MAX_TAXI_SNAP_M`): una ubicación guardada lejos del aeródromo (otra estación, o un clic desviado en la vista Región) mira al norte y no tiene entrada, en vez de una línea de decenas de kilómetros hasta la calle más cercana de MDPC;
  4. sin ninguna de las dos, la posición no se dibuja: Mapa de posiciones la lista «Sin ubicar» (`unlocatedStands`), con «Ubicar en el mapa» en su cajón.
- El dueño del producto decidió el 13 de noviembre de 2026 que su documento de coordenadas manda sobre OpenStreetMap, que está desactualizado en el aeropuerto. Nada en M4 lee OpenStreetMap ni las tablas `qa` del plano; ninguna posición se mueve, se gira ni cambia de tamaño hacia la geometría de OSM; y una posición solo se mueve cuando OCC la ubica.
- La lista corta de las pantallas y de los servicios sigue saliendo de `positionsData.js`, porque nunca cargan el plano (contratos 3). `airport/layoutIndex.js` (`layoutStandReferences`) da la misma lista desde el plano, y el mapeador de posiciones acepta las dos con el mismo resultado: así queda resuelto el origen de la lista corta que M3 dejaba a M4. `indexLayout` y `matchStand` pasan a ese archivo, que no importa el plano, y `airportLayout.js` los reexporta.
- Las pruebas nunca escriben a mano las coordenadas de una posición: las leen de `MDPC_LAYOUT` o de los fixtures sintéticos de `testing/mapFixtures.js`, así que el plano firmado entra sin romperlas.

**9. «Ubicar en el mapa» pide confirmación.**
- Es la decisión D-2 del diseño, con el mismo comando de [ADR-0027](0027-occ-ready-contracts-and-stand-locations.md). En el cajón de la posición, «Ubicar en el mapa» cierra el cajón y muestra sobre el mapa «Haz clic en el centro de la posición {código}.», con «Guardar ubicación», que espera una ubicación pendiente, y «Cancelar»; el aviso toma el foco. La caja de la posición, a tamaño real, sigue al puntero (a trazos, en cian), una vez por cuadro, y a 15 m o menos de su centro en el plano toma exactamente su contorno del plano (sólida). Un clic deja la ubicación pendiente (un contorno sólido sobre un lavado claro, con su centro) y otro clic la mueve.
- Solo «Guardar ubicación» manda el mismo `PUT occ/stands/{standId}/location`, con seis decimales: el aviso dice «Guardando la ubicación de {código}…» y después «{código} quedó ubicada en el mapa.», y la pantalla relee el tablero. Si falla, la ubicación sigue pendiente y el aviso dice por qué en español (`translatePositionError`), nunca con el título del servidor. «Cancelar» o `Esc`, en el aviso o en el mapa, la descartan antes de limpiar la selección.
- `stands/placing.js` (`placingGhost`, `placedLocation` y `ghostFeatures`): la caja es el contorno de esa posición en el plano, trasladado; solo se ajusta a ese contorno, nunca al de otra posición ni a OpenStreetMap. Una posición que el plano no conoce recibe la caja propia del punto 8 y nunca se ajusta. Su fuente, `occ-stand-ghost`, dibuja en el slot `selection` a cualquier zoom, así que también se ubica desde Aeródromo.
- Las posiciones del tablero que el mapa no dibuja salen en la lista de Mapa de posiciones como «Sin ubicar», y su cajón ofrece «Ubicar en el mapa».
- *Por qué:* hasta M4, un clic guardaba en el acto, y un desliz guardaba un punto equivocado.
- *Descartado:* girar la caja al ubicarla (decisión D-3 del diseño), que pediría guardar un rumbo en la base y una migración: el rumbo sale del plano o de la posición vecina.

**10. La leyenda de lo que hay en pantalla.**
- `ui/MapLegend.jsx`, con `ui/legendEntries.js` (decisión 9 de este ADR), suma, siempre dentro del área que dejan a la vista los paneles:
  - los estados de los polígonos que se ven, desde `polygons`, cada uno como un recorte en SVG de lo que dibuja el mapa (el relleno, el contorno con su ancho y su trazo, el avión, el reloj y la entrada resaltada) y con su palabra de `STAND_STATES`; por debajo de `polygons`, «Posiciones de una terminal», con «Ocupadas del total; acerca el mapa para ver cada una», por las pastillas, y justo después «Llega un vuelo a una posición de la terminal», con la flecha, mientras se ve la pastilla de una terminal con una posición en «Llegando»;
  - las señales que el mapa dibuja en pantalla, con su forma y la palabra de `SIGNALS`: una por posición, la más fuerte (`standSignalOf`, la misma regla que usa la capa de las señales), así que una posición con las dos solo suma «Urgente»;
  - las marcas en pantalla: el enlace de una combinada, la caja de fuselaje estrecho, el anillo del mismo agente y, al ubicar una posición, su caja y la ubicación sin guardar. La entrada del anillo sale del mismo estado de entidad que lo dibuja y dice a qué posición sigue (`sameAgentMark`): «Mismo agente que la posición elegida» o, con el puntero sobre otra posición, «Mismo agente que la posición bajo el puntero». Si esa posición no tiene agente, el mapa no dibuja ningún anillo y la leyenda no explica ninguno, tampoco el de la elegida;
  - «No oficial», como en M2, y los elementos del aeródromo de M3.
- Se va la entrada de M2 que explicaba un grupo de posiciones.

**Lo que pasa a M5.** Necesita la tabla de dimensiones de los aviones y los vuelos de A3 (`occ/map/flights`, con sus hitos y los instantes demo):
- las huellas de los aviones a escala, a trazos en «Planificada» y «Llegando» y sólidas en «Ocupada» y «Por liberar»; hasta entonces, un avión de unos 30 m, con la nariz según el rumbo de la posición, marca las dos últimas;
- la barra de avance de los hitos de la escala;
- «El avión ya está en la posición. Registra la llegada.»;
- pasarle a la regla de estados los vuelos del mapa y las posiciones de los aviones (`useStandDisplay(positions, { flightsByTurnaround, aircraftByTurnaround })`), para que «Llegando» espere la llegada demo, el `BLOCK_ON` o el avión dentro de la caja, y para que el rótulo diga el tipo de avión;
- el reloj del servidor (`src/services/serverClock.js`): hoy el reloj de minutos lee el del navegador.

**Lo aplazado.** Pasar de posición en posición con `[` y `]` (contratos 2.2) y girar una posición al ubicarla (decisión D-3 del diseño).

**Dónde M4 se aparta del diseño o de lo que anunciaba este ADR** (manda la página de contratos):
- los rellenos de la tabla D1 del diseño dan paso a la tabla de contratos 2.4, sin tono para lo normal (punto 1);
- «Llegando» dura hasta que el avión está en la posición, y no solo mientras la posición está planificada y su vuelo llega en 15 minutos o ya aterrizó; «Por liberar» ya no incluye el retroceso registrado, porque la visita con PUSHBACK deja de contar (punto 2); y la regla recibe también la posición de los aviones;
- la decisión 7 de este ADR terminaba la visita con cualquier pierna que despegó; desde M4 solo la termina la salida, porque una llegada en `departed` despegó de su origen y viene en camino (punto 2). Lo mismo vale para el vuelo actual o el siguiente que marca `relatedEntities`;
- la entrada de «Llegando» es fija (contratos 2.4: solo se mueven los aviones), del ancho del contorno y en `--occ-text`; las demás son una línea fina en `--occ-line-strong`, no el amarillo del eje de rodaje, y no hay marca de parada en el centro;
- umbrales derivados, no los zooms de las tablas D3 y D4 (contratos 2.3); entre `polygons` y `codes` no hay códigos, aunque el diseño ponía los de las posiciones no libres, salvo en la plataforma de la consola;
- las huellas, la barra de avance y «El avión ya está en la posición…» pasan a M5, sin la fuente `occ-aircraft-footprints` ni las capas de avance; un avión marca las posiciones ocupadas y las por liberar;
- la caja de «Ubicar en el mapa» tiene su propia fuente en el slot `selection`, no `occ-stand-aux`, y solo se ajusta al contorno de su posición en el plano, no a cualquier contorno conocido (decisión del dueño del 13 de noviembre de 2026);
- el plano no lista posiciones combinadas, que son de OCC (ADR-0030), así que la regla del diseño de dibujar una combinada del plano solo cuando está planificada, ocupada o elegida, encima de las que combina, no tiene a qué aplicarse: una combinada como «9A» aparece cuando OCC la ubica, con su caja propia, como cualquier otra. «Solo fuselaje estrecho» va como texto del rótulo, de la ficha y del cajón, no como insignia, y su caja de letra C solo va dentro de una posición más ancha;
- «Sin agente que la cubra» cuenta también un avión que ya está en la posición, y solo con la lista de cobertura vacía; «Pasó su hora de salida» y «Otra aeronave llega a esta posición» son señales con su forma encima de la posición, fuera de su rótulo (punto 3);
- la pastilla cuenta las posiciones con un avión sobre las que se dibujan, avisa una llegada con una flecha y abre con un clic la vista de su terminal, que el diseño no tenía;
- la ficha suma los motivos de las señales, «Anulada por …» y «Solo fuselaje estrecho», y se coloca debajo o encima de la caja;
- las pantallas no pasan `layoutStandReferences(layout)` al mapeador, como pedía el diseño C5: los servicios nunca cargan el plano (contratos 3), y la geometría se añade dentro de `OccMap`;
- la caja propia concreta «perpendicular a la calle de rodaje más cercana»: la nariz se aleja de ella, mira al norte sin grafo, y su entrada se dibuja como las del plano;
- la posición elegida es estado de entidad de su polígono (diseño D2), y no un dato de la fuente de la selección, como decían las decisiones 3 y 5 de este ADR; esa fuente conserva su rótulo y el anillo de un vuelo;
- Mapa de posiciones y Planificación escriben `stand=` ya en M4, cuando la decisión 7 de este ADR lo dejaba para U3 y U5;
- los íconos del estilo pasan de catorce a nueve (decisión 6 de este ADR);
- el adaptador `PositionMap` conserva sus props, su manejador imperativo y su `data-testid`, y suma tres props opcionales para ubicar una posición: `placingCode`, `pendingLocation` y `onCancelPlacing`;
- las escenas del laboratorio son solo oscuras (decisión 16 de Erick): `ramp-states` reemplaza a `ramp-points`, y llegan `ramp-combined-selected` y `ramp-placing-ghost` (el diseño las llamaba `ramp-dark-states`, `ramp-dark-combined-selected` y `ramp-placing-ghost`).

**Consecuencias.**
- Mapa de posiciones y Planificación pasan sus posiciones a `PositionMap` con `useStandDisplay`. La plataforma de la consola recibe los polígonos por el mismo adaptador, con el estado que ya traía y sin «Llegando», «Por liberar» ni señales, hasta que U3 adopte `useStandDisplay`: M4 no edita `src/features/dashboard/**`.
- El laboratorio tiene diez escenas: `ramp-states` (un tablero sintético a las 11:00 con los siete estados, una pareja combinada y posiciones cubiertas y sin cubrir), `ramp-selected`, `ramp-combined-selected` (la A10, anulada por la combinada A9, elegida), `ramp-placing-ghost` (la B27 a medio ubicar), `airfield`, `approach`, `region`, `unavailable-fallback`, `basemap-degraded` y `layout-qa`. La suite visual suma `tests/visual/lab/map-lab.ramp-states.spec.mjs` (Rampa, las terminales A y B y Aeródromo, a 1440×900 y a 1920×1080) y `tests/visual/occ/positions-map.interactions.spec.mjs` (la ficha, el cajón, el mismo agente, la pareja combinada y la caja antes y después de «Guardar ubicación», con la API simulada guardando la ubicación).
- Cada módulo nuevo o cambiado tiene su prueba al lado, con el mapa falso compartido y fixtures sintéticos.
- No cambian la API, el OpenAPI, el cliente compartido ni la base; no hay migración, dependencia nueva ni origen nuevo, y la CSP no cambia. Solo se despliega AVIAM Web (`frontend/private-web`).

- **Aviso a la pantalla de arranque** (contratos 2.6). Al integrar U4, `OccMap` llama `useOccBoot().markReady('map')` cuando su motor queda `ready` (el estilo cargó: el aeródromo y las posiciones se dibujan aunque falte el mapa base) o `unavailable` (lo que la pantalla muestra es la lista de respaldo). Así, Mapa de posiciones, Planificación y Monitoreo ya no esperan los 6 s del tope después del acceso; fuera del marco del OCC el aviso no hace nada. Lo cubre una prueba de `OccMap.test.jsx`, y las dos pruebas visuales de Mapa de posiciones abren la página como una entrada posterior de la pestaña, sin la pantalla.

**Queda pendiente**
- **Lo vinculado entre vuelos y posiciones.** El borde de la posición del vuelo elegido (`related`) existe, pero ninguna pantalla de M4 dibuja a la vez vuelos y posiciones, así que elegir una posición todavía no marca su vuelo en el mapa, ni un vuelo su posición. Lo usará la consola de U3 con los vuelos de M5.
- **La plataforma de la consola** adopta `useStandDisplay` con U3.
- **Lo que pasa a M5**, arriba.
## Actualización (13 de noviembre de 2026). PR M5: tráfico real en el mapa

M5 «Tráfico real en el mapa» dibuja en el lienzo único los aviones de la imagen aérea y los vuelos de ELEVANT de las tres lecturas de A3 ([ADR-0042](0042-occ-air-picture-and-map-flights.md)), con el bloque de datos del avión elegido, el crédito de la red y el menú de capas. Hoy lo usa Monitoreo de vuelos, dentro del marco del OCC, y el laboratorio lo muestra con tráfico sintético. El código llegó en tres pasos: la situación aérea con su servicio, su modelo y el reloj del servidor (`48ae657e`); los aviones con su silueta, su etiqueta, su estela y el crédito (`585f07d3`); y la selección con el bloque de datos y el menú de capas (`03dda909`). Esta nota amplía las decisiones de arriba sin reescribirlas. M5 entrega menos de lo que anunciaba la tabla «Lo que añadirán M3 a M8», por la fecha de entrega que fijó el dueño del producto (el domingo 15 de noviembre de 2026) y porque M4 se construye a la vez: lo que pasa a M6 y a M8 está en el punto 7. Donde el diseño y la página de contratos del plan difieren, manda la página de contratos; las diferencias están al final de la nota.

**1. Un modelo de la situación sobre las tres lecturas de A3.**
- `src/services/occMapService.js` tiene dos adaptadores con la misma interfaz. El remoto lee con los envoltorios del cliente compartido (`getOccAirPicture`, `getOccMapFlights`, `getOccAircraftTrack` y `getSystemPing`), que validan cada respuesta con sus validadores estrictos; un 401 cierra la sesión, y el código `invalid_map_query` se explica en español, sin mostrar nunca el título del servidor. El simulado responde un escenario sintético sin red, pasa cada respuesta por los mismos validadores y anota cada lectura para la prueba de presupuesto. La página o el laboratorio eligen el adaptador: un componente nunca elige la fuente.
- `traffic/situationModel.js` es el único módulo que conoce la forma de las respuestas. Las pasa a las unidades del mapa (metros, metros por segundo, grados e instantes en milisegundos) y las une en lo que el mapa dibuja (`buildSituation`):
  - un avión cuyo `matchedFlightKey` nombra un vuelo de la ventana es ese vuelo (`f:<flightKey>`), y si no, otro tráfico (`h:<hex>`). También lo es si lo nombra con la clave `p:` vieja de una visita que OCC enlazó a un vuelo planificado (3-N07), que se resuelve por el `proposalId` de la fila: el servidor guarda sus claves de emparejamiento 20 s, y mientras tanto la imagen todavía puede traer la vieja. Un vuelo, un avión: si dos nombran el mismo vuelo, con cualquiera de sus claves, gana la posición más nueva;
  - el estado de la imagen (`Live`, `Stale`, `Warming`, `Unavailable` o `Disabled`) y su motivo son datos, nunca un error;
  - un avión está en vivo hasta `max(30 s, 2 × refreshAfterSeconds)` desde su posición, y sin actualizar después; con la imagen en `Stale`, todos lo están. El umbral sale del ritmo que pide el servidor (contratos 2.3), no de un número fijo;
  - un vuelo de ELEVANT sin posición en vivo no se dibuja: M5 no estima ninguna. El modelo ya acepta las posiciones estimadas que le pase quien llama (`estimates`) y las marca como estimadas; las calculará la cinemática de M6, y hoy solo las pasan el laboratorio y las pruebas.
- `src/services/serverClock.js` es el único reloj del servidor de la app (contratos 2.7). Toma el desfase de la muestra con menor ida y vuelta entre las últimas ocho, del `serverTime` de cada lectura del mapa y del `timestampUtc` de `system/ping`, que no cambia. Los instantes que escribe la API, con hasta siete decimales, se cortan a milisegundos.
- `traffic/trailStore.js` guarda las estelas fuera de React. Nunca une dos puntos separados por más de `max(60 s, 3 × refreshAfterSeconds)`, ni a través de una lectura que llega tras un hueco así (una pestaña oculta), y guarda como mucho 600 puntos por vuelo de ELEVANT o avión elegido y 60 por otro avión. La estela que trae `aircraft/{hex}/track` al elegir un avión reemplaza la parte vieja de la suya.
- `useMapSituation.js` lee con el bucle único del marco, `useOccResource`:
  - la imagen aérea, al ritmo del `refreshAfterSeconds` de su última respuesta (10 s antes de la primera), con `trails=short` hasta tener una y `none` después, y el doble de espera por cada lectura fallida, hasta un minuto;
  - los vuelos, con `occ_planning` (como mucho una lectura cada 3 s) y un sondeo de seguridad de 60 s;
  - el reloj, al arrancar y al volver a la pestaña, nunca dos veces en 30 s; y la estela completa del avión elegido, una vez por elección.

  Las lecturas esperan con la pestaña oculta, y solo se hacen si la cuenta tiene uno de los cuatro permisos que abren el mapa. El hook da los cinco estados de una vista remota y lleva el estado de la imagen aérea a la lista de fuentes del marco (`airTraffic`), con las marcas «Demo» y «est.» de lo que dibuja. Cada lectura falla sola: el estado del mapa lo deciden los vuelos de ELEVANT, y solo una lectura de vuelos fallida es un error. Una imagen aérea que falla (un 503, un 429 o el tiempo agotado) deja el mapa con sus vuelos y sin aviones, y la fuente queda «Sin conexión»; en una estación sin tráfico en vivo la API responde 404 a la imagen y 200 a los vuelos, y la fuente queda «Sin configurar», nunca «Sin permiso», porque las dos lecturas tienen la misma regla de acceso. Esa imagen rechazada no se vuelve a pedir mientras no cambie el acceso.
- El presupuesto de peticiones (contratos 2.7) tiene su prueba, `useMapSituation.budget.test.jsx`: repite el minuto demo de `admin-occ/live/occRequestPlan.js` contra el hook real y el adaptador simulado, con 200 ms por respuesta. El mapa pide 6 imágenes aéreas, como mucho 9 lecturas de vuelos y un ping (16 peticiones en la corrida del PR), y Monitoreo de vuelos tal como está hoy, más su mapa, suma 62: por debajo de las 70 de un minuto con vuelo demo. `MAP_SITUATION_READS` es la única tabla de las dos lecturas, para el hook y para la prueba.
- *Por qué:* contratos 1.3 y 2.7. Un solo módulo que adapta las respuestas deja el resto del mapa ajeno a su forma; el bucle del marco ya pausa, agrupa y respeta los permisos; y un solo desfase con el servidor hace que todas las pantallas cuenten desde el mismo instante.
- *Descartado:* la lectura única `occ/map/situation` y la traza `occ/map/trace` del diseño, que A3 no construyó; un bucle de lectura propio del mapa; y medir la antigüedad con el reloj del navegador.

**2. Siluetas propias, de una sola tabla de dimensiones.**
- `aircraft/types.js` guarda veinte tipos OACI con su largo, su envergadura, su altura, el ancho del fuselaje, la flecha, los motores y el diámetro de sus góndolas, su familia (dónde van los motores y la cola) y su categoría de ícono, y un avión genérico por categoría. `resolveAircraftType` elige, en orden: el designador de la tabla; el tipo que nombra el texto del modelo («737 MAX 8» es B38M); la categoría de un designador conocido fuera de la tabla (cuatrimotores, turbohélices y regionales de motores traseros); la categoría de tamaño del vuelo de ELEVANT; la categoría de emisor ADS-B; y si no, el dardo neutro. Solo las dos primeras dan las medidas propias del tipo; las demás, las del avión genérico, marcado como aproximado.
- `aircraft/silhouette.js` dibuja con esas medidas la planta de cada avión: un polígono simple en metros, con el morro arriba, cuya caja es la envergadura por el largo. De ella salen los íconos, y saldrán las huellas a escala y las alas del 3D, así que el 2D y el 3D coincidirán.
- Nueve íconos, uno por categoría (cuatrimotor, bimotor de fuselaje ancho, fuselaje estrecho, regional, turbohélice, ejecutivo, ligero, helicóptero y desconocido), cada uno lleno y hueco: la planta de su avión genérico ajustada a su cuadro, mayor para los aviones mayores. `style/trafficImages.js` se los da a `style/mapImages.js`, que los dibuja como SDF cuando el estilo los pide, como los demás íconos.
- Los glifos de la etiqueta (llegada, salida y la flecha hacia la posición) y la placa «Demo» son imágenes planas (`sdf: false`) en sus colores OCC, dibujadas por el mismo resolvedor desde trazos propios: MapLibre pinta tal cual una imagen dentro del `format` de un texto, sin el umbral de un SDF, y la placa tiene dos tonos y un marco. Amplía la decisión 6, que solo tenía íconos SDF. Sigue sin haber sprite.
- *Por qué:* una sola tabla para los íconos, las huellas y el 3D, sin archivos ni licencias de terceros.
- *Descartado:* las formas de tar1090 (GPL) y de Plane Watch; un sprite.

**3. Cada avión se lee sin color (decisión 17 de Erick, contratos 2.4).**

| Qué | Cómo se dibuja | Etiqueta |
|---|---|---|
| Llegada de AVIAM | silueta llena en `--occ-text`, 1,25× | siempre: el glifo de llegada y el número (`ZZ161`); en la segunda línea, el tipo, la altitud en cientos de pies y los nudos (`B38M 026 150`), y `→ A5` cuando tiene posición asignada |
| Salida de AVIAM | silueta hueca, 1,25× | siempre: el glifo de salida, el número y la misma segunda línea |
| Otro tráfico en el aire | silueta llena en `--occ-faint`, 0,85× | al pasar el puntero, al elegirlo o con «Etiquetas de todo el tráfico» |
| Otro tráfico en tierra | 0,6×, solo desde el umbral `airfield`; no se dibuja dentro de una posición en la que está un avión de AVIAM o demo | como el otro tráfico |
| Avión elegido | su silueta en cian (`--occ-accent`), 1,4×, con el anillo de la selección | siempre |
| Posición estimada | un anillo discontinuo | «est.» tras el nombre |
| Sin actualizar | a media opacidad | «Sin actualizar desde las 10:59» tras el nombre, con la hora de Punta Cana de su última posición |
| Vuelo demo | la placa «Demo» de rayas a 45°, bajo la silueta | — |

- En tierra la etiqueta dice «GND» en lugar de la altitud, y no da la velocidad de un avión parado. Un avión sin rumbo conocido apunta al norte: no se le inventa una dirección.
- Un avión de AVIAM o demo ocupa su posición asignada desde que está en ella hasta que la deja (contratos 2.4: «a stand owned by an AVIAM or demo aircraft»). Lo dice la primera prueba que haya, en el orden de la regla de estados de las posiciones: en un vuelo demo, que ya pasó `demo.onBlockAt`; si no, un `BLOCK_ON` registrado; si no, el avión, en vivo o estimado, en tierra dentro de la caja de la posición; y si no, la hora real de la llegada cuando es la hora en posición (`actualKind: OnBlock`, la de «Registrar llegada»). Una hora de pista solo dice que aterrizó. Así, la posición de un vuelo que todavía llega, que aterrizó o que rueda hacia ella no oculta nada, y tampoco la sugerida de un vuelo demo sin importar, que espera en la plataforma (contratos 2.3): un avión estacionado donde llega un vuelo se ve, porque es el conflicto que OCC tiene que ver. La visita deja de contar con su `PUSHBACK`, con la salida que despegó, con un desvío o con la llegada cancelada (`endsItsVisit`, de `core/mapSelection.js`); una llegada en `departed` despegó de su origen y todavía viene en camino.
- Las estelas de los vuelos de ELEVANT y del avión elegido se desvanecen hacia la cola, a media opacidad si están sin actualizar, y las estimadas son discontinuas. Las del otro tráfico solo se ven con «Estelas de todo el tráfico», y solo sus últimos 2 minutos. No hay trazos animados.
- `traffic/trafficFeatures.js` arma los aviones y `OccMap` los escribe con un `updateData` por cambio, solo con lo que cambió. `traffic/trafficLayers.js` es el overlay del tráfico, con sus fuentes `occ-traffic`, `occ-trails` y `occ-route`, en los slots `routes`, `traffic` y `selection`.
- La leyenda suma, solo cuando están en pantalla, las cuatro clases de avión, «Demo», «est.», «Sin actualizar», las dos estelas y las dos partes de la ruta del vuelo elegido (`ui/trafficLegend.js`).
- *Por qué:* lo normal no lleva tono, el cian es solo lo elegido, y lo estimado, lo demo y lo viejo se distinguen por la forma y la palabra, nunca solo por el color.
- *Descartado:* un color por estado o por aerolínea, y el verde para lo normal.

**4. Un bloque de datos acoplado.**
- `ui/FlightDataBlock.jsx` es una ficha fija arriba a la izquierda del mapa, nunca un globo sobre el avión (decisión E-1 del diseño). Es un diálogo sin `aria-modal`, así que el mapa conserva sus teclas, y se llama «Vuelo ZZ161».
- Dice:
  - el número (o el *callsign*, o la dirección ADS-B), el tipo y la matrícula;
  - el origen y el destino, con la hora de Punta Cana y su cuenta atrás, sin hablar nunca en futuro de lo que ya pasó ni de una hora vencida: con una hora real, «Aterrizó» o «En posición» (según `actualKind`, o un `BLOCK_ON` registrado) y «Salió»; si el proveedor dice que aterrizó (`landed`, `arrived`) o que salió (`departed`) antes de dar la hora, el mismo verbo con la hora prevista, nombrada así y sin cuenta («Salió · hora prevista 10:45»); si la hora prevista ya pasó, «Debía llegar 10:55 · hace 5 min» o «Debía salir»; y si no, «Llega 11:10 · en 10 min» o «Sale»;
  - la altitud con su tendencia, la velocidad y el rumbo;
  - la posición: la asignada, la sugerida de un vuelo demo sin importar o «Sin posición asignada», con «Pista 08» en un vuelo demo (contratos 2.3);
  - de dónde sale la posición: «En vivo · hace 4 s», «Sin actualizar desde las 10:59» (las mismas palabras que la etiqueta del avión), «Posición estimada: calculada con el horario, no con señal del avión.» o «Sin posición todavía»;
  - «Vuelo demo», «Sin importar», «Cancelado por el proveedor (demo)» y «Otro tráfico», cuando aplican.
- «Ver escala», activo solo para un vuelo importado, abre el vuelo en Planificación, y «Ver posición», su posición en Mapa de posiciones; los dos enlaces conservan la estación.
- La telemetría le llega de `traffic/telemetryStore.js`, un almacén externo que el bloque lee con `useSyncExternalStore` y que late a 4 Hz solo mientras alguien lo mira y la pestaña se ve: la antigüedad de una posición en vivo cuenta sin que el mapa vuelva a renderizar.
- La ruta del vuelo elegido (`traffic/routeFeatures.js`) es lo que voló, en línea sólida (su estela, con la traza del servidor), y una recta discontinua desde el avión hasta su siguiente punto: en una llegada, su posición, o el aeropuerto de la estación si no tiene; en una salida, su destino. Una llegada ya en su posición, un vuelo cancelado o desviado y el otro tráfico no tienen siguiente punto. Mientras se ve la ruta, la estela del elegido cede ante ella, así que no se dibuja dos veces.
- La selección sigue el contrato de la URL (contratos 2.1): `flightId` nombra un vuelo por su `flightKey`, su `visitKey`, su pierna, su escala o la clave `p:` vieja de una visita enlazada, y `hex`, un avión por su dirección y, si la imagen lo emparejó, también su vuelo. Una sola regla (`selectedAircraftId`) decide qué avión va en cian, con el anillo y en el bloque, y el vuelo del bloque y de la ruta es el de ese avión: una `visitKey` o una escala nombran los dos tramos de una visita y, tras la escala, el emparejamiento da el avión a la salida (un vuelo, un avión), así que el bloque, el cian, el anillo y la ruta hablan siempre del mismo tramo. Sin avión, el vuelo es el que encuentra `matchFlight`: de una visita, su llegada.
- *Por qué:* sin estado de React por cuadro, nunca tapa el tráfico, usa las fuentes de los paneles y se prueba con Testing Library.
- *Descartado:* un globo sobre el avión, que se vuelve a proyectar con cada movimiento del mapa.

**5. El crédito de la red, a la vista mientras hay tráfico.**
- Mientras hay aviones en pantalla, `OccMap` pone en su atribución «Datos de aeronaves: {source.name}», con el enlace a `source.homeUrl` y, si lo hay, a `source.licenseUrl` (decisión 10 de este ADR), y lo quita cuando no queda ninguno. Como la atribución empieza plegada, `ui/MapSourceStatus.jsx` da además el mismo crédito, con sus enlaces, en una línea visible abajo a la izquierda de la parte del mapa que dejan libre los paneles.
- El mismo componente dice el estado del tráfico con palabras propias, nunca con las del servidor: «Cargando tráfico…» (también mientras la imagen calienta), «No hay aviones en la zona», «No hay tráfico en vivo en este momento.» con su motivo y «Reintentar», «Tu acceso no incluye el tráfico en vivo.» y «Tráfico con retraso: último dato hace 4 min.». Cada motivo (`not_configured`, `quota_exceeded`, `rate_limited`, `unauthorized` y `provider_error`) tiene su frase, en español y en inglés. Sin imagen aérea, el mapa conserva sus vuelos y el aviso sale del estado de la fuente: si la lectura falló, «No hay tráfico en vivo en este momento.» con «Reintentar»; en una estación sin tráfico en vivo, la misma frase con «La fuente de tráfico no está configurada.», como en un entorno sin la fuente.
- Ese aviso habla solo de la imagen aérea y dice lo mismo que la lista de fuentes del marco (`airTraffic`): un fallo de los vuelos de AVIAM nunca dice que no hay tráfico en vivo ni que llega con retraso. Si falla la primera lectura de los vuelos, el mapa sigue dibujando el tráfico, todavía sin distinguir los aviones de AVIAM, y bajo el aviso del tráfico aparece uno propio, «No se pudieron cargar los vuelos de AVIAM.», con «Reintentar»: es el error recuperable de esa lectura. Si falla una relectura, el mapa conserva los vuelos de la anterior y no avisa. «Tráfico con retraso» cuenta la antigüedad con el reloj del servidor (`src/services/serverClock.js`), segundo a segundo y solo con la pestaña a la vista, nunca desde el instante de la última respuesta: mientras las lecturas fallan, la cifra sigue subiendo.
- *Por qué:* decisión 6 de Erick y contratos 2.5. La licencia de adsb.fi pide citarla con un enlace, y el dueño del producto pidió que su crédito se vea siempre que haya tráfico en pantalla.
- *Descartado:* dejar el crédito solo en la atribución plegada.

**6. Un menú de capas que crece por grupos.**
- `core/layersMenu.js` define los grupos con sus claves, lo que cada vista muestra por omisión y lo que guarda el navegador; `ui/MapLayersMenu.jsx` dibuja el botón «Capas» del dock del mapa y su panel. M5 trae solo el grupo Tráfico: «Vuelos de AVIAM», siempre visible; «Otro tráfico»; «Etiquetas de todo el tráfico» y «Estelas de todo el tráfico», apagadas por omisión; y «Ruta del vuelo elegido». Las etiquetas y las estelas de todo el tráfico siguen a «Otro tráfico»: ocultarlo las oculta también.
- El navegador guarda en `localStorage` (`elevant-occ-map-layers:v1`) solo lo que la persona cambió respecto de lo que trae la vista en pantalla, así que un valor por omisión nuevo llega a quien nunca tocó esa clave. El menú solo lista las claves que tienen capas en el estilo de su mapa.
- La tecla `L` abre y cierra el menú mientras hay uno en pantalla (contratos 2.2). Con el menú abierto, una `Esc` lo cierra y la siguiente limpia la selección.
- Cada PR que traiga capas suma su grupo en `LAYER_GROUPS`, sus valores por omisión y, si sus claves dependen de otra, su línea en `engineGroupsFor`.
- *Por qué:* el diseño agrupa lo que una persona puede mostrar u ocultar, y el mapa lo recuerda sin congelar los valores por omisión.
- *Descartado:* guardar todas las claves, que dejaría a cada navegador con los valores por omisión del día en que las guardó.

**7. Lo que pasa a M6 y a M8.**
- A **M6** «Cinemática y vuelo demo en el mapa»: las trayectorias, el rodaje por el grafo, el perfil demo ajustado a los instantes del servidor, el relevo entre la señal y la estimación, el modo seguir y la ruta completa del vuelo elegido, que reemplazará la recta de M5; el tráfico en Mapa de posiciones y en Planificación; y las posiciones alimentadas por los vuelos: las huellas a escala, la barra de avance de los hitos y «Llegando» desde el vuelo.
- A **M8** «Capas aeronáuticas y clima»: los anillos de distancia, los ejes de pista extendidos y los aeropuertos de la región (de `region.context.json`), junto a la FIR, las radioayudas y el día y la noche que M8 ya traía; y el satélite GOES, la lluvia IMERG y el viento en pista, con el clima. M8 suma al menú de capas sus grupos «Referencias» y «Meteorología»; el grupo Rampa llega con los PR que traen sus capas.
- *Por qué:* la fecha de entrega que fijó el dueño del producto, y M4, que se construye a la vez y se mergea antes. Las posiciones, el Mapa de posiciones y la vista «Mapa» de Planificación son de M4: M5 no toca sus archivos, y el tráfico llega a esas pantallas con M6. El de M5 va en Monitoreo de vuelos y en el laboratorio.

**Dónde M5 se aparta del diseño o de lo que anunciaba este ADR** (manda la página de contratos):
- las tres lecturas de A3, y no la lectura única del diseño (`occ/map/situation`, con `sources`, `flights` y `traffic`) ni `occ/map/trace`; `situationModel.js` las une por `matchedFlightKey` (contratos 1.3);
- el reloj en `src/services/serverClock.js`, y no en `kinematics/serverClock.js` (contratos 2.7);
- el ritmo de contratos 2.7 sobre `useOccResource`, y no una lectura cada 10 s que se repite en el acto con `occ_planning`;
- un avión en vivo o sin actualizar según un umbral derivado del ritmo del servidor, sin el estado de inercia del diseño ni sus 15 y 60 s fijos, y estelas cortadas a `max(60 s, 3 × refreshAfterSeconds)` y no a 60 s (contratos 2.3 y 2.7). El almacén de trayectorias y relevo del diseño (`trackStore.js`) es de M6: M5 tiene `trailStore.js`, que solo guarda estelas;
- «est.» y la placa «Demo» de rayas (contratos 2.4), y no «EST» ni «DEMO». La placa va bajo la silueta, en su propia capa, con la palabra escrita sobre sus rayas, y no delante del número;
- lo sin actualizar dice desde cuándo, con las palabras de contratos 2.4: «Sin actualizar desde las 10:59», la plantilla `TAGS.stale` del vocabulario con la hora de Punta Cana de su última posición (`traffic/stationTime.js`, el mismo reloj de la estación que las horas del bloque), en la etiqueta del avión y en el bloque, y no su antigüedad («· 45 s», «Sin señal desde hace 45 s») como proponía el diseño. La hora no envejece: la etiqueta de un avión sin actualizar no cambia hasta que llega otra posición. La leyenda usa la forma corta del vocabulario, «Sin actualizar», con la pista «Atenuado, con la hora de su última posición». El aviso de la imagen con retraso sigue contando la antigüedad («Tráfico con retraso: último dato hace 4 min.»): es el estado de la fuente, no la marca de un dato, y contratos 2.5 cuenta así también la de la consola («Aviones: {source.name}, hace N s»);
- los glifos de la etiqueta son imágenes planas y no SDF (punto 2), y la llegada de AVIAM no lleva el halo cian del diseño: el cian es solo lo elegido;
- el otro tráfico en tierra, más pequeño, solo desde el umbral `airfield` y oculto dentro de una posición ocupada (contratos 2.4 y los ajustes del plan), que el diseño no trataba;
- el anillo del avión elegido no va en la fuente de la selección (decisión 5): como en el diseño, es una capa del tráfico en el slot `selection` (`occ-traffic-selected-ring`, con el mismo trazo de 2 px en cian que `occ-selection-ring`), bajo el avión que se vuelve a dibujar en cian, y las dos se leen de la entidad del avión, así que se mueven en la misma escritura que él; `occ-selection` sigue con las posiciones y los vuelos que coloca la pantalla, y `selectionLayers.js` y su efecto en `OccMap` no cambian con M5;
- la ruta del vuelo elegido es lo volado observado y una recta hasta su siguiente punto, en el cian de la selección; el tramo estimado desde el origen, el resto de la ruta hasta la posición y sus marcas llegan con M6. La estela del avión bajo el puntero no se dibuja;
- el bloque de datos no tiene «Seguir», «Demo acelerada ×N» ni la pista en uso de un vuelo real, que llegan con M6 y M8, ni «Importar escala»: importar se abrirá sobre la consola de U3 (contratos 2.5). Suma «Sin posición todavía», para un vuelo de ELEVANT sin señal, y «Otro tráfico». Solo un vuelo demo nombra su pista, la 08 (contratos 2.3);
- el aviso «No hay tráfico en vivo en este momento.» no dice que las posiciones de AVIAM se calculan con el horario, porque M5 no calcula ninguna, y no hay avisos del reloj del equipo ni de un vuelo demo en el mapa;
- los vuelos de AVIAM tienen su propio aviso, «No se pudieron cargar los vuelos de AVIAM.», aparte del aviso del tráfico: el diseño tenía una sola lectura y un solo error, y con las tres lecturas de A3 cada una falla sola (contratos 1.3);
- el crédito va también en una línea visible, y en la atribución, solo mientras hay tráfico en pantalla;
- el menú de capas solo trae el grupo Tráfico (punto 7);
- la tabla tiene veinte tipos y no todos los del diseño: quedan fuera A319, B772, A332, A339, B744, A388 y DH8D, que toman el avión genérico de su categoría, y entra la E195. No hay familia de turbohélice de ala baja;
- M5 no llama a `markReady('map')`, que conecta M4.

**Consecuencias.**
- Monitoreo de vuelos, dentro del marco del OCC, dibuja el tráfico en vivo de PUJ (`flight-monitoring/components/FlightMap.jsx`). La página le pasa todos sus vuelos, y uno que el mapa ya dibuja como tráfico no se dibuja dos veces: un clic en él elige el vuelo de la lista, y uno en otro avión escribe `hex=`. El bloque de datos reemplaza la ficha de la página para los vuelos que el mapa conoce; la ficha sigue para un vuelo que el mapa no conoce y mientras el mapa no puede dibujar. La página ya no muestra el aviso «Sin posición de aeronaves en vivo: el mapa muestra PUJ, no trayectorias simuladas.». Fuera del marco, como en sus pruebas de página, el mapa no lleva tráfico.
- Mapa de posiciones, Planificación y la plataforma de la consola todavía no dibujan tráfico: llega a ellos con M6 y U3.
- Desde M5, abrir Monitoreo de vuelos en el OCC es demanda de la imagen aérea: con la pestaña a la vista el mapa la lee cada 10 s, y la API lee adsb.fi cada 10 s hasta 15 minutos después de la última lectura ([ADR-0042](0042-occ-air-picture-and-map-flights.md)). La comprobación del operador no cambia: el VPS tiene que alcanzar `opendata.adsb.fi`.
- Sin cambios fuera de AVIAM Web: no cambian la API, el OpenAPI, el cliente compartido ni la base, y no hay migración; no entra ninguna dependencia; y la CSP no cambia, porque el navegador lee el tráfico de la API, nunca de la red de tráfico. Solo se despliega AVIAM Web (`frontend/private-web`).
- Entran los `data-testid` `flight-data-block`, `map-source-status` y `map-layers-menu`.
- Pruebas nuevas, junto a cada archivo: el reloj, el servicio, el modelo, las estelas, el hook y su presupuesto, la tabla de tipos y las siluetas, las imágenes del tráfico, sus capas y sus datos, la ruta, la telemetría, la hora de la estación y las palabras de lo sin actualizar, el bloque de datos, el menú de capas, el estado del tráfico, la leyenda y las escenas, con datos sintéticos que pasan los validadores estrictos del cliente; y en la suite visual, `tests/visual/lab/map-lab.traffic.spec.mjs`, sobre siete escenas nuevas del laboratorio.

**Queda pendiente**
- **El dueño de las lecturas del mapa en `OCC_REQUEST_PLAN`.** El plan de peticiones del marco (`admin-occ/live/occRequestPlan.js`, del carril visual) cuenta la imagen aérea y los vuelos de la consola sin dueño, y no cuenta el mapa de Monitoreo de vuelos, que M5 cuenta en su propia prueba con `MAP_SITUATION_READS`. Unir las dos tablas, con `useMapSituation.js` como dueño de esas lecturas, es un cambio del carril visual (U3 y U5).
- **La fuente «Mapa base» del marco.** La lista de fuentes del marco tiene `basemap`, pero el mapa solo informa `airTraffic`: el estado del mapa base sigue solo en el aviso del propio mapa.
- **La verificación de las dimensiones.** Cada medida de `aircraft/types.js` tiene que compararse con el documento de planificación de aeropuertos de su fabricante antes de que las huellas a escala (M6) y el 3D (M7) se apoyen en ella. En M5 nada se dibuja a escala: los íconos son la planta genérica de cada categoría, ajustada a su cuadro.
- **`region.context.json`** sigue sin lector: sus aeropuertos de la región pasan a M8, con las radioayudas.
- **El mensaje `page.noLivePositions` de Monitoreo de vuelos** quedó sin uso; lo puede retirar U5 al rehacer la pantalla.

## Actualización (14 de noviembre de 2026). PR M8 (API): clima del aeródromo por la API

M8 «Capas aeronáuticas y clima» se entrega en dos partes. Esta nota recoge la primera, el PR M8 (API) «Clima del aeródromo por la API (METAR y TAF)»: la lectura `GET occ/weather` con el METAR y el TAF de aviationweather.gov. Es solo API y cliente compartido, y cuenta como un PR de la API (contratos 1.4). El código llegó en dos pasos: la fuente, con su caché y sus esperas (`65f9446f`), y la lectura, con sus contratos, su configuración, el snapshot y el cliente (`eeac6d1e`). Ninguna pantalla cambia: el navegador sigue leyendo el METAR de Iowa Environmental Mesonet hasta la segunda parte, del carril de mapas, que traerá también la FIR aproximada, las radioayudas y el día y la noche. Esta nota amplía las decisiones de arriba sin reescribirlas. Donde el diseño y la página de contratos del plan difieren, manda la página de contratos; las diferencias están al final de la nota.

**1. El clima pasa por la API: un proxy del backend (decisión D-1 del diseño de la API).**
- aviationweather.gov es la Data API del Aviation Weather Center de NOAA, un servicio oficial. Da el METAR y también el TAF, que las pantallas no tienen, en JSON y sin clave. No admite CORS, así que solo puede llamarla el servidor, y con eso el clima queda bajo la regla de que los clientes hablan solo con la API de ELEVANT ([ADR-0004](0004-centralize-external-api-access.md)).
- *Por qué:* un servicio oficial, con el TAF, y un origen menos para el navegador cuando la segunda parte deje de leer Iowa Mesonet.
- *Descartado:* seguir con Iowa Environmental Mesonet desde el navegador. Es una réplica no oficial, no tiene TAF y es un origen del navegador que, cuando nada lo use, se puede retirar de la CSP.

**2. El puerto, el adaptador y la petición.**
- El puerto es `IAerodromeWeatherSource` (`backend/Elevant.Application/Abstractions/Operations/IAerodromeWeatherSource.cs`): el clima de un aeropuerto por su código OACI, con el último METAR (decodificado y en bruto) y el último TAF (en bruto y por periodos), en unidades aeronáuticas: grados verdaderos, nudos, millas terrestres, grados Celsius y hectopascales. Sin servicio configurado responde `null` y no llama a nada (`DisabledAerodromeWeatherSource`, el valor por defecto de todo host). Un fallo del servicio nunca es una excepción: solo se lanza la cancelación del propio llamador.
- El adaptador es `AviationWeatherSource` (`backend/Elevant.Infrastructure/Integrations/AviationWeather/`): `GET {BaseUrl}metar?ids={OACI}&format=json` y `GET {BaseUrl}taf?ids={OACI}&format=json`, enviadas a la vez. Su `HttpClient` no sigue redirecciones, da 10 segundos para la respuesta completa, acepta respuestas comprimidas, lee como mucho 1 MiB y envía `Accept: application/json` y el `User-Agent` genérico de la imagen aérea, `air-traffic-reader/1.0` (la misma constante, `ReadsbAirTrafficProvider.UserAgent`), sin el nombre del proyecto, correos ni direcciones. Un código que no son cuatro letras nunca se envía.
- Un 200 se lee con el parser puro `AviationWeatherParser`. Del aeropuerto toma el último informe legible, acepta los instantes en segundos Unix o en ISO 8601 y deja en `null` el valor que falta o se sale de su rango, en lugar de perder el informe; solo un informe sin su texto o sin su hora es ilegible. Una lista vacía o un 204 es una respuesta: el servicio no tiene informe ahora. Un 429, cualquier otro estado, un tiempo agotado, una respuesta demasiado grande o un JSON ilegible es un fallo. La fuente no escribe en el log, así que ningún mensaje nombra el servicio.

**3. Caché bajo demanda y esperas, nunca un bucle.**
- La fuente llama solo cuando alguien lee el clima de un aeropuerto, nunca al arrancar. Guarda en memoria, por código OACI, lo que respondió el servicio: el METAR 5 minutos y el TAF 30. Mientras un informe se lee, las demás peticiones esperan esa misma lectura, y una que se cancela deja de esperar sin cortar la de las demás.
- Tras un fallo sirve lo que guardó: el METAR hasta 2 horas después de leído, marcado como guardado, y el TAF hasta 12 horas, pero nunca pasado el fin de su validez. Antes de volver a preguntar espera 1, 2, 4 y 8 minutos tras los primeros fallos seguidos, y después 15; un `Retry-After` más largo manda, hasta una hora (`AviationWeatherBackOff`). Es una espera por fallo, nunca un reintento en bucle.
- Con el servicio respondiendo son como mucho 2 llamadas cada 5 minutos por aeropuerto, lean cuantas pantallas lean; tras un fallo, las esperas de arriba. Siempre muy por debajo del límite de 100 consultas por minuto de la Data API.
- Nada se persiste: ni tabla, ni registro de uso, ni migración. Un reinicio empieza vacío, y una segunda instancia tendría su propia caché.

**4. El estado viaja en un 200, siempre con el crédito.** Como en la imagen aérea ([ADR-0042](0042-occ-air-picture-and-map-flights.md), sección 4), un servicio apagado, caído o sin informe es un estado del clima, nunca un error del servidor. `AerodromeWeatherStatus` (`backend/Elevant.Application/Operations/Weather/`) lo resuelve en el instante en que sale la respuesta, el mismo `serverTime` que lleva:

| Estado | Cuándo |
| --- | --- |
| `Live` | El METAR tiene 90 minutos o menos frente a `serverTime` y no es el guardado tras un fallo. |
| `Stale` | El METAR es más viejo, o es el guardado tras un fallo del servicio. |
| `Unavailable` | Hay servicio, pero no hay METAR que mostrar; el TAF puede venir igual. También cuando la fuente falla de forma inesperada. |
| `Disabled` | No hay servicio configurado: sin METAR, sin TAF y sin `retrievedAt`, y nunca se llama a nada. |

- `source` siempre lleva el crédito «NOAA Aviation Weather Center» con `https://aviationweather.gov`, también con el clima apagado, para que cada pantalla lo muestre junto al clima.
- `retrievedAt` es la última vez que el servicio respondió por ese aeropuerto; es `null` antes de la primera.

**5. La lectura `GET occ/weather`.** `backend/Elevant.Api/Controllers/OccWeatherController.cs`, `GET api/v1/occ/weather?stationId=` (`GetOccAerodromeWeather`), con sesión, respuesta privada (`no-store`) y solo lectura.
- La leen los lectores de los mapas (`OccMapAccess`, [ADR-0042](0042-occ-air-picture-and-map-flights.md), sección 10): el personal interno de AVIAM con la estación en su alcance y cualquiera de los cuatro permisos de mapa. A diferencia de la imagen aérea, vale para cualquier estación: el código OACI es el del aeropuerto de la estación (PUJ lee MDPC), que lee `IOccStationAirportStore` (`database/DevelopmentDB/Elevant.Persistence/Operations/EfOccStationAirportStore.cs`), sin migración.
- Errores en Problem Details, con un título en español que la interfaz nunca muestra y un `code` estable: `400 invalid_weather_query` (sin estación o con una mal formada, también cuando falla el enlace del modelo), `401` sin código y con `WWW-Authenticate: Bearer`, `403 forbidden` y `404 not_found` (una estación fuera del alcance, desconocida, inactiva o cuyo aeropuerto no tiene código OACI).
- Los contratos están en `backend/Elevant.Contracts/Operations/OccWeatherContracts.cs`, sin `long` y con los estados como texto: `stationId`, `icaoCode`, `status`, `serverTime`, `retrievedAt`, `source` (`name` y `homeUrl`), `metar` (el texto en bruto, la hora observada, la categoría de vuelo, el viento con su dirección o variable, la ráfaga, la visibilidad, la temperatura, el punto de rocío, el altímetro, el tiempo presente y las capas de nubes) y `taf` (el texto en bruto, la emisión, la validez y los periodos, con el mismo detalle), o `null`.
- El controlador y sus esquemas se registran siempre, así que el OpenAPI no depende de la configuración: el snapshot suma 1 ruta, 6 esquemas y la etiqueta `OccWeather`, y publica 409 operaciones en 357 rutas.
- El cliente compartido suma `getOccAerodromeWeather` (`packages/api-client/src/occMap.ts` y `src/client.ts`): valida la consulta antes de enviarla y la respuesta con `isOccAerodromeWeather`, estricto en cada nivel (listas cerradas, los rangos del servidor y un estado que concuerda con sus partes). El código nuevo es `invalid_weather_query`. La app de la tablet no lee esta respuesta.

**6. Configuración (`AviationWeather`).**

| Clave | Valor | Regla |
| --- | --- | --- |
| `Enabled` | `false` en `appsettings.json` y en `appsettings.Production.json`; `true` en `appsettings.Development.json` | Apagado, el estado es `Disabled` y nunca se llama a nada. |
| `BaseUrl` | `https://aviationweather.gov/api/data/` | Absoluta, `https` y sin consulta; la barra final se añade si falta. |

- La sección se enlaza con `GetSection().Get<AviationWeatherOptions>()` y se valida en cada arranque, también apagada: una `BaseUrl` inválida lanza `InvalidOperationException` y la API no arranca. Ningún entorno se rechaza: Production lo deja apagado por configuración.
- Application registra con `TryAddSingleton` la fuente apagada, para los hosts sin Infrastructure, e Infrastructure registra siempre la efectiva (`AddAviationWeather`, en `backend/Elevant.Infrastructure/DependencyInjection.cs`). Encendida, el adaptador se construye la primera vez que se pide, y la imagen que se certifica sin red no llama a nadie, porque nadie lee el clima.
- El overlay del arnés E2E fija `AviationWeather__Enabled` en `${ELEVANT_E2E_AVIATION_WEATHER_ENABLED:-false}`: el recorrido no lee el servicio real salvo que alguien lo pida a propósito. Los dos `.env.example` traen las variables comentadas ([guía local](../workflows/local-development.md)).

**7. Pruebas sin red.**
- Los fixtures son sintéticos: la forma real de las respuestas `metar` y `taf` de la Data API, con valores inventados (`backend/tests/Elevant.UnitTests/Infrastructure/Fixtures/awc-metar.synthetic.json` y `awc-taf.synthetic.json`). El HTTP se simula con un manejador de prueba, y ninguna prueba ni workflow de CI llama a aviationweather.gov.
- La única prueba que lee el servicio, `AviationWeatherLiveTests`, hace una consulta de METAR y una de TAF de MDPC y solo corre con `ELEVANT_LIVE_AVIATION_WEATHER=1`, como `AirTrafficLiveTests`. Informa conteos y la antigüedad del METAR, nunca la respuesta.
- Unitarias: la fuente y su parser con los fixtures (los informes, el viento variable y la visibilidad «10+», el último informe legible, las listas cerradas y los rangos, la caché, lo guardado tras un fallo, el TAF vencido, la respuesta vacía, las esperas sin bucle, el `Retry-After` de un 429 como plazo o como fecha, una sola lectura compartida, las consultas, el código OACI, el `User-Agent`, el cliente, los fallos, la cancelación y el crédito); las esperas; la configuración; y el manejador (acceso, estación, estados y fallo de la fuente). De la API, montando el host sin SQL: la validación, los códigos y los títulos, el estado en el 200, el lector solo de planificación y la imagen de Development, que enciende el clima. De arquitectura: contratos sin `long`, enumeraciones ni ids internos, y una sola lectura bajo `occ/weather`. Una prueba SQL del código OACI del aeropuerto de la estación (`backend/tests/Elevant.IntegrationTests/Persistence/SqlServerMigrationTests.Weather.cs`). Del cliente compartido: el envoltorio, la consulta, el validador estricto y el código `invalid_weather_query`.

**Dónde M8 (API) se aparta del diseño o de lo que anunciaba este ADR** (manda la página de contratos):
- los fixtures son sintéticos, con la forma real y valores inventados, y no una respuesta real grabada una vez a mano, como decía el diseño: ninguna prueba llama a aviationweather.gov;
- el `User-Agent` es el genérico de la imagen aérea, `air-traffic-reader/1.0`, y no `ELEVANT/1.0`, que nombraba el proyecto (contratos 1.3);
- la nota va en este ADR, como todo M2 a M8 (contratos 4), y no en un ADR-0041 nuevo que juntara las secciones A a E del diseño;
- el plan, la página de contratos (1.4) y la tabla «Lo que añadirán M3 a M8» nombran el TAF en bruto; la respuesta lo lleva en bruto y también por periodos, como el diseño. Es aditivo: una pantalla puede quedarse con el texto en bruto;
- la página de contratos (1.4) da a toda la lectura una caché de 5 minutos; la fuente guarda el METAR 5 minutos y el TAF 30, como el diseño. Guardar el TAF más tiempo solo quita llamadas: con el servicio respondiendo siguen siendo como mucho 2 cada 5 minutos por aeropuerto;
- un `Retry-After` más largo que la espera manda, hasta una hora, y el diseño solo decía 1, 2, 4… 15 minutos; `Unavailable` cubre también un fallo inesperado de la fuente, y un TAF nunca se sirve pasada su validez, casos que el diseño no trataba;
- `appsettings.Production.json` apaga el clima de forma explícita, y el overlay del arnés lo apaga con una variable que permite la lectura a mano, como en A3 ([ADR-0042](0042-occ-air-picture-and-map-flights.md), sección 12);
- el código de error es uno nuevo, `invalid_weather_query`, y no el `invalid_map_query` de los mapas, y el aeropuerto de la estación lo lee un almacén propio, `IOccStationAirportStore`;
- el navegador no cambia en esta parte. El diseño dejaba Iowa Mesonet como respaldo del adaptador del navegador durante un release: lo decide la segunda parte. Retirar su origen de la CSP toca cuatro archivos, no los dos que nombraba el diseño (más abajo).

**Consecuencias.**
- Toda API que corre como Development llama a aviationweather.gov cuando alguien lee `occ/weather`: el VPS de Development y también el stack local sin el overlay del arnés. Hasta la segunda parte de M8 ninguna pantalla lo lee, así que solo llama con una lectura a mano. El VPS tiene que alcanzar `aviationweather.gov`: es la comprobación del operador de [integraciones externas](../architecture/external-integrations.md).
- Una lectura que encuentra un informe vencido espera la respuesta del servicio, como mucho 10 segundos, porque las dos consultas van a la vez. Mientras la fuente espera tras un fallo, responde en el acto con lo que guardó.
- La caché vive en la memoria de una instancia, como la imagen aérea: un reinicio la vacía y la lectura siguiente vuelve a llamar.
- La página de la Data API no publica condiciones de uso comercial: hay que confirmarlas antes de usar el clima fuera de Development. Production lo deja apagado.

**Compatibilidad y despliegue.** Sin migración: `dotnet ef migrations has-pending-model-changes` sigue limpio. La lectura es aditiva, y ninguna respuesta que lee la tablet cambia. El backend, la persistencia (el almacén del aeropuerto de la estación) y el overlay del arnés son entradas del release de base de datos, que sale sin cambio de esquema, y el snapshot y el cliente compartido lo son de las dos webs. Por eso, como en A3, se despliegan juntos y en el orden habitual: release de base de datos, API, AVIAM Web y Public Web. El VPS no necesita variables nuevas; el operador comprueba antes que la API alcanza `aviationweather.gov`. Ninguna pantalla cambia hasta la segunda parte de M8.

**Queda pendiente**
- **La segunda parte de M8**, del carril de mapas: `src/services/weatherService.js` pasará a esta lectura, y con ella llegarán las capas del clima, la lectura del TAF, el crédito «NOAA Aviation Weather Center» y los estados en los archivos de mensajes del OCC, en español y en inglés, sin mostrar nunca el título de un error. No quitará nada de la CSP.
- **Iowa Mesonet en la CSP.** Cuando ninguna pantalla lo lea, retirar `https://mesonet.agron.iastate.edu` cambia a la vez los tres archivos que afirman la CSP (`src/config/securityHeaders.mjs`, `scripts/test-development-delivery.mjs` y `frontend/scripts/deployment/csp-tool.mjs`), la prueba de este último (`frontend/tests/deployment/test-csp-tool.mjs`) y las notas del Vault que describen los orígenes (Private Web e Integraciones externas). Va en un cambio aparte, como `demotiles.maplibre.org`.
- **La forma real del JSON.** Los fixtures son sintéticos: solo `AviationWeatherLiveTests`, corrida a mano, la compara con una respuesta real.
- **Lo que no entra:** SIGMET y NOTAM. La pista en uso tampoco la decide el servidor: según contratos 2.3, la estima el mapa con las llegadas reales recientes, después con el viento del METAR y, si no, toma la 08.

## Actualización (14 de noviembre de 2026). PR M8 (mapas): referencias y meteorología en el mapa

Esta nota recoge la segunda parte de M8 «Capas aeronáuticas y clima», la del carril de mapas: el PR M8 (mapas) «Capas aeronáuticas y clima en el mapa (parte 2: el clima por la API en el navegador, referencias y meteorología)». El navegador lee el clima del aeródromo de `GET occ/weather`, la lectura de la primera parte (nota anterior), y los mapas del OCC suman en el mismo lienzo las referencias aeronáuticas, el día y la noche, el satélite y el viento en pista. El código llegó en tres pasos: el clima por la API en el navegador, con el TAF y el crédito de NOAA (`1c0f2482`); los anillos, los ejes de pista, los aeropuertos de la región, las radioayudas y el día y la noche (`32ecc0e5`); y las nubes por satélite, la lluvia estimada y el viento en pista (`d5e35d68`). No cambian la API, el OpenAPI, el cliente compartido, la base ni la CSP. La FIR aproximada que anunciaba la tabla «Lo que añadirán M3 a M8» no entra (punto 3). Esta nota amplía las decisiones de arriba sin reescribirlas. Donde el diseño y la página de contratos del plan difieren, manda la página de contratos; las diferencias están al final de la nota.

**1. El navegador lee el clima de la API.**
- `src/services/weatherService.js` tiene dos adaptadores con la misma interfaz, como `occMapService.js` (punto 1 de la nota de M5):
  - el remoto lee con el envoltorio del cliente compartido, `getOccAerodromeWeather`, que valida cada respuesta con `isOccAerodromeWeather`. Pide `no-store`, abandona la lectura a los 20 s, como toda lectura del OCC, y alimenta el reloj del servidor con el `serverTime` de la respuesta. Un 401 cierra la sesión;
  - el simulado responde un escenario sintético sin red, movido a la hora del reloj simulado, lo pasa por el mismo validador (si no pasa, falla con `malformed_simulation`) y anota cada lectura. Los datos sintéticos viven con las pruebas y el laboratorio (`src/features/maps/testing/weatherFixtures.js`), nunca en el servicio.
- `weatherMessage` explica en español los códigos de la lectura, `invalid_weather_query`, `forbidden` y `not_found`, y nunca muestra el título del servidor.
- `toWeatherReading` deja la respuesta como la leen las pantallas:
  - el METAR sigue saliendo de `parseMetar` sobre el texto en bruto (`features/weather/metar.js`), y lo que decodificó la API solo rellena lo que ese texto no dice (`mergeDecodedMetar`);
  - el estado (`Live`, `Stale`, `Unavailable` o `Disabled`) es un dato, nunca un error, como el de la imagen aérea;
  - el crédito es el que manda la API, «NOAA Aviation Weather Center» con `https://aviationweather.gov`, y lleva `official: false`. La marca «No oficial» sigue donde se vea el clima (contratos 2.4), aunque el servicio sea oficial, porque ELEVANT lo retransmite y no da un parte meteorológico para despachar;
  - la respuesta no trae los valores derivados que calculaba Iowa Mesonet (la humedad, la sensación térmica y la precipitación de la última hora): `data.derived` conserva sus claves, sin valores.
- `features/weather/useMdpcWeather.js` conserva su nombre, su argumento `{ enabled }` y su propio sondeo de 10 minutos con la pestaña a la vista, más una lectura cuando vuelve la conexión (`online`), nunca con `occ_planning` (contratos 2.7). También conserva su forma, `{ status, data, fetchedAt, refreshFailed, refreshing, refresh }`, con `data.station`, `data.observedAt`, `data.metar`, `data.derived` y `data.source`. Suma dos argumentos opcionales, `stationId` (por omisión, la estación de la sesión del OCC, `useOccStation`) y `service` (el adaptador), y devuelve además `apiStatus`, `taf`, `retrievedAt`, `source` y `error`.
  - Cinco estados: `loading`; `success`, con un METAR (`Live` o `Stale`); `empty`, sin METAR (`Unavailable` o `Disabled`), con el estado y el crédito; `error`, si falla la primera lectura (una relectura fallida conserva lo anterior y marca `refreshFailed`); y `unauthorized`.
  - Lee solo si la cuenta tiene uno de los cuatro permisos del mapa (`MAP_PERMISSIONS`, que pasa a `maps/mapPermissions.js` para que la consola no cargue el plano). Un 401 o un 403 la detienen, sondeo incluido, hasta que cambie el acceso del departamento (un objeto de acceso nuevo, que el marco del OCC trae con `department_users` y `access_requests`), la estación o `enabled`, o hasta que alguien pida `refresh()`: entonces lee una vez más y el servidor decide de nuevo, como `useOccResource` (contratos 2.7). El sondeo y la vuelta de la conexión nunca preguntan por una lectura rechazada.
  - Una sola regla de frescura, `isObservationStale(observedAt, ahora, apiStatus)`: manda el estado de la API, así que un METAR `Stale` está sin actualizar a cualquier edad; si no, lo está pasados 90 minutos, el límite de la API para uno en vivo (`STALE_AFTER_MINUTES` es `OCC_AERODROME_WEATHER_LIMITS.liveMetarMinutes`; antes eran 75), medidos al milisegundo, como el viento del mapa (punto 5). Sin `apiStatus` mira solo la edad.
  - Informa a la lista de fuentes del marco la fuente «Clima MDPC» (`weather`), con la hora de su METAR y la marca «No oficial»: `Live` es `ok` (`delayed` tras una relectura fallida), `Stale` es `delayed`, `Unavailable` es `offline` y `Disabled` es `unconfigured`.
- Lo leen, cada pantalla con su propio sondeo: Monitoreo de vuelos dentro del marco del OCC, Mapa de posiciones, la vista «Mapa» de Planificación y el panel de meteorología de la consola actual, por `DashboardRoute`.
- El navegador ya no pide el METAR actual a Iowa Environmental Mesonet: se retiró `loadCurrentObservation`. Solo el historial de 6 horas del panel de meteorología de la consola actual lo sigue leyendo (`loadRecentMetars`), hasta que U3 retire ese panel. Su origen, `https://mesonet.agron.iastate.edu`, sigue en la CSP hasta un cambio aparte, que toca a la vez los tres archivos que la afirman (`src/config/securityHeaders.mjs`, `scripts/test-development-delivery.mjs` y `frontend/scripts/deployment/csp-tool.mjs`), la prueba de este último (`frontend/tests/deployment/test-csp-tool.mjs`) y las notas del Vault que describen los orígenes.
- *Por qué:* contratos 1.4 y 2.7, y [ADR-0004](0004-centralize-external-api-access.md): los clientes hablan solo con la API de ELEVANT. Una sola fuente del METAR para todas las pantallas, y con ella el TAF.
- *Descartado:* conservar Iowa Mesonet como respaldo del adaptador durante un release, como dejaba abierto el diseño de la API. Dos fuentes del mismo METAR podrían contradecirse en pantalla, y tras un fallo del servicio la API ya sirve lo que guardó.

**2. La lectura del TAF.**
- `features/weather/taf.js` es puro:
  - `toTafModel` une en un modelo el texto en bruto y los periodos que decodificó la API, en orden de inicio, y da a cada periodo su grupo del texto en bruto cuando los dos cuentan lo mismo (`splitTafGroups`);
  - `tafReadout(modelo, instante)` dice qué rige: `none`, `notYet`, `expired` o `current`, con el periodo base o el FM que rige ahora, después los TEMPO, PROB y BECMG que lo cubren, y el periodo siguiente;
  - `describeTafPeriod` escribe un periodo en una línea, con las horas de la estación: «Temporal 12:00–16:00 · 100° 15 kt G25 · 4 km · SHRA · BKN015».
- Ninguna pantalla muestra todavía el TAF. El hook lo trae (`taf`) para la pastilla y el detalle del clima de la consola de U3 (contratos 2.5), y una pantalla puede quedarse con el texto en bruto (contratos 1.4).

**3. Las referencias, en todos los mapas.**
- `traffic/referenceFeatures.js` arma, puro, las referencias del diseño E6 en dos fuentes: `occ-reference`, con el punto de referencia de PUJ y los anillos, y `occ-reference-ourairports`, con lo que sale de datos de OurAirports (los ejes de pista extendidos, desde los umbrales y rumbos de las cabeceras del plano, los aeropuertos de la región y las radioayudas), que lleva su crédito. `style/referenceLayers.js` las dibuja en el slot `reference`, en silencio: líneas finas y palabras tenues en los tokens neutros, sin tono (contratos 2.4). Las tiene todo mapa sobre `OccMap`, cada una con su clave del menú de capas (punto 6):
  - los anillos de distancia, de 50, 100, 150, 200 y 250 NM en Región y de 5, 10, 20 y 40 NM en Aproximación, con su rótulo («20 NM») al noreste, sobre el Atlántico. Cambian en el umbral derivado `approach` (punto 7);
  - los ejes de pista extendidos: 10 NM desde cada umbral, con una marca por milla, más larga a 5 y a 10. El de la pista en uso va más ancho y en el color del texto, y su rótulo dice de dónde sale: «Pista 08 (según las llegadas)», «Pista 08 (estimada por el viento)» o «Pista 08 (habitual)»;
  - los 31 aeropuertos de la región de `airport/data/region.context.json`, todos menos PUJ, que ya marca su punto de referencia: un anillo con «MDSD SDQ» (OACI e IATA, o solo OACI). El origen o el destino de un vuelo de hoy (el `counterpart` de `occ/map/flights`, salvo el de un vuelo cancelado) es un punto lleno con su código en el color del texto: lo distingue la forma, no solo el color. El mapa base ya no escribe la etiqueta de las teselas de esos aeropuertos, así que cada uno se escribe una vez;
  - las radioayudas PNA y PCA, con su símbolo propio, su tipo y su frecuencia, «PNA VOR-DME 112,7» y «PCA NDB 425», desde el umbral `approach` hasta que las posiciones pasan a polígonos (`polygons`): ninguna queda sobre las posiciones, y PCA está junto a la terminal A.
- La pista en uso sigue contratos 2.3 (decisión 19 de Erick) con `airport/runwayInUse.js` de M6: primero las llegadas en vivo recientes, después el viento del METAR y, si no, la 08.
  - Una llegada cuenta solo en final (`finalApproachEnd`): en vivo, en el aire y sin subir, a 1000 m de altura o menos, sobre la prolongación del eje de una cabecera (a 1 NM o menos del eje, entre el umbral y 12 NM hacia fuera) y volando su rumbo, a 10° o menos (`ALIGNED_DEG` de `runwayInUse.js`). Vota por esa cabecera. Un avión en el tramo de viento en cola, en un tramo base o que viene hacia PUJ fuera del eje no dice nada de la pista. Las posiciones estimadas, las sin actualizar y las de un vuelo demo nunca cuentan.
  - El voto de cada avión, guardado por su dirección ADS-B, dura 10 minutos del reloj del servidor desde su última posición en final (`rememberArrivals`, que `OccMap` guarda entre lecturas con `core/useRecentArrivals.js`). Así la pista sigue «según las llegadas» después del aterrizaje y entre dos llegadas, y pasados 10 minutos sin ninguna vuelven a decidir el viento o la 08. Sin tráfico en el mapa, como en Mapa de posiciones y Planificación, deciden el viento o la 08.
  - El viento cuenta solo si el METAR está `Live` y se observó como mucho 90 minutos antes en el reloj del servidor, el límite de la API para uno en vivo. Un viento en calma o variable no dice nada de la pista.
- `airport/regionContext.js` (`REGION_CONTEXT`) es el primer lector de `region.context.json`.
- Fuentes y licencias:
  - **OurAirports**, de dominio público. `region.context.json` salió de su extracto del 13 de noviembre de 2026 (nota de M3) y no cambia. No exige crédito, pero el mapa lo da igual: la fuente `occ-reference-ourairports` lleva «OurAirports», enlazado a `https://ourairports.com/` (`OURAIRPORTS_ATTRIBUTION`, en `core/attribution.js`), y MapLibre lo muestra solo mientras se dibuja alguna de sus capas, como en Región y en Aproximación con sus valores por omisión. El crédito del aeródromo termina con el mismo texto, así que con los dos en pantalla se ve una vez.
  - **VATSpy** (CC BY-SA 4.0), que no se usa. El plan permitía extraer una vez, a mano, un polígono aproximado de la FIR Santo Domingo (MDCS) de su archivo `FIRBoundaries.dat` (proyecto `vatsimnetwork/vatspy-data-project`), guardarlo con su fuente, su licencia y su fecha, y dar su crédito solo con la capa encendida. El 14 de noviembre de 2026 GitHub respondió 404 por ese archivo. Sin un extracto no hay límite, ni clave `fir` en el menú, ni crédito: un límite nunca se inventa. Lo dice también `src/features/maps/airport/data/README.md`.
  - **NASA GIBS**, en el punto 5.
- *Por qué:* el diseño E6. Las referencias ayudan a leer la región y la aproximación sin competir con el tráfico ni con las posiciones.

**4. El día y la noche, del módulo solar único.**
- `traffic/nightShade.js` calcula la noche: donde el sol está por debajo del borde del crepúsculo civil (−6°, `CIVIL_TWILIGHT_DEG`), meridiano por meridiano cada 2°, a partir del punto subsolar de `traffic/solar.js` (`subsolarPoint`), el módulo solar de M7 parte 1 (decisión J-1 del diseño). No es un segundo módulo solar: solo resuelve, en cada meridiano, la latitud del borde.
  - `terminatorPolygon` da un polígono cerrado entre ±85° de latitud, cortado en el antimeridiano cuando, cerca de un equinoccio, la noche no toca ningún polo.
  - `nightShadeFeatures` da la sombra, la línea del borde y la palabra «Noche» del lado de la noche, porque sobre el mar la sombra apenas oscurece.
- Se dibuja en el slot `shade`, justo encima de la tierra y el mar, hasta el umbral `airfield`: en Región y Aproximación, donde la clave `daynight` está encendida por omisión. Cambia con el minuto del reloj del servidor (`core/useMinuteClock.js` acepta ahora un reloj, el de `services/serverClock.js`), sin ninguna petición, y el laboratorio la congela con `?t=`.
- No se dibujan luces de pista. El sol ya ilumina los aviones 3D (`aircraft/aircraft3dLayer.js`, de M7); M8 no cambia la luz de los edificios (`map.setLight`).

**5. La meteorología, en el lienzo único.**
- `traffic/weatherLayers.js` es el único dueño de las fuentes, las capas y los datos del clima en el mapa.
- **El satélite.** Las nubes infrarrojas de GOES-East y la lluvia estimada de IMERG, de NASA GIBS, que `GoesCloudMap.jsx` dibujaba en un mapa propio, son dos fuentes ráster en el slot `weather`, bajo las referencias.
  - Se dibujan solo en Región y Aproximación, están apagadas por omisión y nacen ocultas: `OccMap` muestra una solo cuando fijó sus teselas a la hora de la imagen que da GIBS (`satelliteTileAt`), así que el mapa nunca pide una imagen distinta de la que nombra. Llevan las opacidades del panel, 0,7 y 0,82.
  - Se dibujan en grises (`raster-saturation` −1, `SATELLITE_SATURATION`). GIBS las pinta con escalas de color propias, y la de la lluvia de IMERG llega a naranjas, rojos y morados; lo normal no lleva tono, y el ámbar y el rojo quedan para «Atención» y «Urgente» (contratos 2.4). Así las muestras blancas de la leyenda coinciden con lo que se ve.
  - Su crédito, «NASA GIBS», va en sus fuentes ráster: MapLibre lo muestra solo mientras una de ellas se dibuja.
  - `maps/useSatelliteImagery.js` lee la hora de cada imagen (la cabecera `Layer-Time-Actual` de la tesela de PUJ, con `services/satelliteService.js`, directo de GIBS, un origen que la CSP ya permite) solo mientras se pide: con su clave encendida y el mapa en Región o Aproximación. Después la vuelve a leer cada 10 minutos con la pestaña a la vista, y no otra vez si el mapa vuelve antes a esas vistas. Mientras se pide una imagen, informa la fuente «Satélite» (`satellite`) a la lista de fuentes del marco. El laboratorio y las pruebas usan un adaptador simulado, sin red.
- **El viento en pista.** Sale del METAR de `useMdpcWeather`: una flecha hacia donde sopla y «100° 13 kt R08» (la dirección con tres cifras o «VRB», la velocidad, la ráfaga como «G25» y la pista en uso), o «Calma» con un anillo.
  - Va en el campo abierto entre las dos pistas, al este de las calles de rodaje y lejos de las posiciones, desde el umbral `airfield`; en las vistas más amplias va solo el rótulo, bajo la marca de PUJ. La clave `weather.wind` está encendida por omisión en Aproximación y Aeródromo.
  - Un METAR `Stale`, o uno `Live` que pasó de 90 minutos en el reloj del servidor, se atenúa y dice «Sin actualizar desde las 08:00» (`TAGS.stale`, con `staleWords` de `traffic/stationTime.js`). Con `Unavailable` o `Disabled` no se dibuja nada.
  - Su ficha (`ui/MapTooltip.jsx`, con `windTooltip`), que un clic fija como las de M3, dice «Viento 100° 13 kt · No oficial», la hora del METAR («METAR de las 10:50», o «Sin actualizar desde las 08:00») y una línea por cabecera con el viento de frente o de cola y el de costado: «R08: 12 kt de frente · 6 kt de la derecha». `airport/runwayWind.js` compara el rumbo verdadero de cada cabecera, del plano, con la dirección verdadera del METAR, sin variación magnética y en nudos enteros.
  - Mientras el viento está en pantalla, la atribución da el crédito «Clima: NOAA Aviation Weather Center», enlazado a `https://aviationweather.gov`. `buildAttribution` acepta ahora una `label` por fuente; sin ella, el crédito sigue siendo «Datos de aeronaves».
- *Por qué:* contratos 2.3 (el clima es una capa, no una vista), 2.4 y 2.5. Como la red de tráfico (decisión 6 de Erick), cada fuente que se ve en el mapa lleva su crédito mientras está en pantalla.
- *Descartado:* una vista «Clima» y un segundo mapa para el satélite, como el del panel de la consola actual.

**6. Los grupos «Referencias» y «Meteorología» del menú de capas.**
- `core/layersMenu.js` suma los dos grupos después de Tráfico, con los valores por omisión del diseño E7:

  | Grupo | Clave | Rótulo | Encendida por omisión en |
  |---|---|---|---|
  | Referencias | `rings` | Anillos de distancia | Región y Aproximación |
  | | `centrelines` | Ejes de pista | Aproximación |
  | | `airports` | Aeropuertos de la región | Región y Aproximación |
  | | `navaids` | Radioayudas | Aproximación y Aeródromo |
  | | `daynight` | Día y noche | Región y Aproximación |
  | Meteorología | `weather.goes` | Nubes por satélite | ninguna |
  | | `weather.imerg` | Lluvia estimada | ninguna |
  | | `weather.wind` | Viento en pista | Aproximación y Aeródromo |

- Una clave encendida que no muestra nada dice por qué, debajo de su nombre y como su descripción accesible: «Se ve en Región y Aproximación», «Buscando la imagen…», «No hay imagen en este momento.» o, ya dibujada, la hora de la imagen. La del viento dice el estado del clima: «No hay clima del aeródromo en este momento.», «El clima del aeródromo no está activado en este entorno.», «Tu acceso no incluye el clima del aeródromo.», «No se pudo cargar el clima del aeródromo.» o «Cargando el clima del aeródromo…».
- El navegador sigue guardando solo lo que difiere de la vista (`elevant-occ-map-layers:v1`, punto 6 de la nota de M5). El menú está en Monitoreo de vuelos y en el laboratorio. Mapa de posiciones y Planificación no tienen menú de capas: muestran lo que trae cada vista, con las elecciones que guardó el navegador.
- La leyenda (decisión 9 de este ADR) suma, solo mientras están en pantalla y leídas del mapa (`queryRenderedFeatures`, con `ui/referenceLegend.js` y `ui/ReferenceSwatch.jsx`): «Anillos de distancia», «Eje de pista extendido (marca cada NM)», la pista en uso con su origen, «Aeropuerto de la región», «Origen o destino de un vuelo de hoy», «Radioayuda VOR-DME», «Radioayuda NDB», «Noche (tras el crepúsculo civil)», «Viento en pista» con «No oficial» y cada imagen del satélite con su hora («Imagen de las 10:50»). Si el METAR está sin actualizar, el viento lleva «Sin actualizar» bajo su nombre y sigue con «No oficial»: un METAR atrasado tampoco es oficial, y el rótulo del mapa no lo dice (contratos 2.4: nada depende de pasar el puntero).

**7. Un umbral más y fuentes ráster en el estilo.**
- `THRESHOLD_NAMES` suma `approach`: el punto medio entre los encuadres de Región y Aproximación (`thresholdsFromFits`), la misma frontera que usa el selector de vistas. Ahí los anillos de Región dan paso a los de Aproximación, y empiezan las marcas de los ejes y las radioayudas. Es un umbral derivado, no un zoom fijo (contratos 2.3 y decisión 8 de este ADR).
- `buildOccStyle` admite, además de las fuentes GeoJSON que nacen vacías, fuentes ráster con su propia lista `tiles` de URL `https`, sin TileJSON; cualquier otra fuente sigue haciendo fallar el armado.
- El motor suma `setRasterTiles(fuente, teselas)`: cambia las teselas solo si cambian, las recuerda y las repone tras perder el contexto (decisión 3 de este ADR). `tests/fakeMapLibre.js` suma `setTiles`.
- Los símbolos de las radioayudas y las imágenes `wind-arrow` y `wind-calm` son SDF de trazos propios (decisión 6 de este ADR): sigue sin haber sprite.
- `OccMap` escribe una vez el punto de referencia y los anillos; la fuente de OurAirports, solo cuando cambian la pista en uso, las contrapartes o el idioma; la noche, con el minuto; y el viento, solo cuando cambia lo que dibuja. Nada se relee con `occ_planning` (contratos 2.7).

**8. Las pantallas y el laboratorio.**
- Monitoreo de vuelos, dentro del marco del OCC, lee el clima y pasa al mapa el clima y sus vuelos, con sus contrapartes; fuera del marco, como en sus pruebas de página, el mapa no lleva clima. Mapa de posiciones y la vista «Mapa» de Planificación pasan el clima a `PositionMap` (prop `weather`): abren en Rampa, donde el viento está apagado por omisión, y lo muestran en Aeródromo. La plataforma de la consola actual tiene las referencias, que Rampa no muestra por omisión, y no recibe el clima: el carril de mapas no edita `src/features/dashboard/**`.
- El laboratorio suma tres escenas de referencias (`region-references`; `region-references-night`, a las 18:15 de Punta Cana; y `approach-references`) y cuatro de clima (`region-satellite`, `airfield-wind-live`, `airfield-wind-stale` y `airfield-wind-unavailable`), con el clima sintético de `testing/weatherFixtures.js`, leído una vez, y las horas simuladas del satélite. No sondea, ni lee la API, aviationweather.gov o la hora de una imagen de GIBS: las teselas del satélite, fijadas a la hora simulada, las pide MapLibre, y en la suite visual las responde el aislamiento con una imagen inventada.

**Dónde M8 (mapas) se aparta del diseño o de lo que anunciaba este ADR** (manda la página de contratos):
- el navegador lee el clima de la API (contratos 1.4), y no de Iowa Mesonet, y el TAF entra como modelo, aunque el diseño E6 dejaba el TAF y los SIGMET fuera de la v1. No hay respaldo con Iowa Mesonet (punto 1);
- no hay FIR, aunque el diseño E6 la dibujaba, el E7 la encendía en Región, el A7 daba el crédito de su fuente y la tabla «Lo que añadirán M3 a M8» la anunciaba: el archivo de VATSpy respondió 404, y un límite nunca se inventa (punto 3);
- la pista en uso suma «Pista 08 (habitual)», el caso de la 08 por omisión (decisión 19 de Erick, contratos 2.3), a los dos rótulos del diseño. El viento la decide solo con un METAR `Live` de 90 minutos o menos y un viento que sopla de algún lado, y las llegadas, solo en final y con su voto de 10 minutos (punto 3);
- los anillos cambian en el umbral derivado `approach`, y no por vista. Las radioayudas terminan en el umbral `polygons`: la clave `navaids` sigue encendida por omisión en Aeródromo, como en E7, pero nada de ellas se dibuja sobre las posiciones;
- `terminatorPolygon` está en `traffic/nightShade.js`, y no en `traffic/solar.js`, que escribió M7 parte 1 y que dejó el terminador a M8: la decisión J-1 se cumple, con un solo módulo solar. La noche es la del crepúsculo civil, con la palabra «Noche», y M8 no llama a `map.setLight` para los edificios;
- el rótulo del viento nombra la pista en uso, «R08», y no la «R25» del ejemplo del diseño, que MDPC no tiene. Va entre las pistas en Aeródromo y como rótulo bajo PUJ en Aproximación, se atenúa con «Sin actualizar desde las 08:00» (contratos 2.4) y su ficha se fija con un clic;
- la atribución: el diseño A7 sumaba en `buildAttribution` NASA GIBS, OurAirports y la fuente de la FIR. GIBS va en sus fuentes ráster, como el crédito del aeródromo; NOAA va por `buildAttribution`, con su propia etiqueta, «Clima», mientras el viento está en pantalla; OurAirports va en la fuente de las referencias que salen de sus datos (punto 3), y no en `buildAttribution`; y no hay FIR;
- el satélite pasa al lienzo único, pero `GoesCloudMap.jsx` y `RegionalTrafficMap.jsx` se quedan hasta que U3 retire la consola actual (contratos 3), aunque el paso 7 de la sección K del diseño los borraba aquí;
- las imágenes del satélite se dibujan en grises. El diseño E6 solo las pasaba de `GoesCloudMap.jsx`, que las pinta con la paleta de GIBS, pero contratos 2.4 no deja tono en lo normal (punto 5);
- el menú de capas explica, bajo una clave encendida, por qué no se ve, algo que el diseño no tenía;
- las escenas del laboratorio no son las del diseño I3 (`region-night-terminator`): son las siete del punto 8;
- la pastilla del clima de la consola (viento, QNH, antigüedad y «No oficial», contratos 2.5) y su detalle son de U3, sobre `useMdpcWeather`: M8 entrega el hook y la lectura del TAF, no la pastilla.

**Consecuencias.**
- Solo se despliega AVIAM Web (`frontend/private-web`). No cambian la API, el OpenAPI, el snapshot, el cliente compartido ni la base; no hay migración, y `dotnet ef migrations has-pending-model-changes` sigue limpio. No entra ninguna dependencia, y la CSP no cambia: el navegador lee el clima de la API, las imágenes de GIBS, un origen que ya estaba permitido, y de Iowa Mesonet solo el historial del panel de la consola actual.
- Desde este PR, abrir en el OCC Monitoreo de vuelos, Mapa de posiciones, Planificación o la consola actual lee `occ/weather`, y cada pantalla lo vuelve a leer cada 10 minutos con la pestaña a la vista. La API llama a aviationweather.gov cuando el METAR que guardó tiene más de 5 minutos o el TAF más de 30: como mucho 2 llamadas cada 5 minutos por aeropuerto, lean cuantas pantallas lean (nota de M8, API). La comprobación del operador es la de esa nota: antes de desplegar, el VPS tiene que alcanzar `aviationweather.gov` ([integraciones externas](../architecture/external-integrations.md)). Con el clima apagado (`Disabled`, como en Production y en el arnés E2E), el mapa no dibuja viento, y el menú de capas de Monitoreo de vuelos dice «El clima del aeródromo no está activado en este entorno.».
- Las imágenes del satélite se leen de GIBS solo mientras alguien las enciende en Región o Aproximación: la hora de cada una, cada 10 minutos, y sus teselas, fijadas a esa hora.
- El panel de meteorología de la consola actual toma su METAR de la API y ya no muestra la humedad, la sensación térmica ni la precipitación de la última hora, que calculaba Iowa Mesonet. Su texto de procedencia todavía dice «METAR MDPC · IEM · réplica no oficial», aunque su enlace ya lleva a aviationweather.gov, hasta que U3 retire el panel: el carril de mapas no edita `src/features/dashboard/**`. Tampoco conoce los estados `empty` y `unauthorized` del hook: con el clima `Unavailable` o `Disabled` (como en Production y en el arnés E2E), o sin permiso, deja la franja del METAR sin texto ni «Reintentar». Su aviso «Desactualizado» sale ahora pasados 90 minutos, y no 75, aunque su texto todavía dice «más de 75 minutos», y no ve el estado `Stale` de la API, porque le pasa solo la edad a `isObservationStale`.
- `region.context.json` ya tiene lector (`airport/regionContext.js`), que la nota de M5 dejaba pendiente.
- No entra ningún `data-testid`.
- Pruebas nuevas, junto a cada archivo y con datos sintéticos que pasan el validador estricto del cliente: el servicio del clima con sus dos adaptadores, sus códigos y el título del servidor que nunca se muestra; el hook, con su sondeo, sus estados, el permiso, la nueva lectura tras un acceso nuevo o `refresh()`, la fuente del marco y la regla de frescura, la misma que siguen el marco y el viento del mapa (un METAR `Live` de 80 minutos al día y uno `Stale` de 40 sin actualizar); el TAF; el viento por pista; las referencias, con un avión en el tramo de viento en cola que no vota y el voto de una llegada que dura 10 minutos; la noche, cuyo borde tiene el sol a −6° con una tolerancia de 0,05° según `sunPosition`; la meteorología con sus capas; la hora del satélite; el menú, la leyenda y la ficha; el motor y el estilo con las fuentes ráster; las escenas; y el mapa falso. En la suite visual, `tests/visual/lab/map-lab.references.spec.mjs` y `tests/visual/lab/map-lab.weather.spec.mjs`, a 1440×900 y a 1920×1080; la primera comprueba también que el crédito de OurAirports sale en Región y en Aproximación mientras se dibuja alguna de sus referencias, y solo entonces. El aislamiento responde las teselas de GIBS fijadas a una hora con una imagen inventada y no responde las que no lo están. En esa imagen, la lluvia lleva los tonos de una escala como la de IMERG, para que las capturas muestren que el mapa la dibuja en grises. El stub de la API responde `occ/weather` con un clima sintético: ninguna prueba llama a aviationweather.gov, a Iowa Mesonet ni a GIBS.

**Queda pendiente**
- **La pastilla y el detalle del clima** de la consola de U3 (contratos 2.5), sobre `useMdpcWeather`, con la lectura del TAF (`tafReadout` y `describeTafPeriod`).
- **El viento en la plataforma de la consola**: la consola de U3 le pasará el clima a su mapa, como hacen Mapa de posiciones y Planificación.
- **La consola actual**: `GoesCloudMap.jsx`, `RegionalTrafficMap.jsx` y `loadRecentMetars` se borran con ella (U3), y con ellos la última lectura de Iowa Mesonet y las dos excepciones de `core/noSetStyle.test.js`. Hasta entonces, su panel de meteorología sigue nombrando a IEM como procedencia.
- **El panel de meteorología de la consola actual, antes de que este PR llegue a `Development`**: es una dependencia con el carril visual, porque el carril de mapas no edita `src/features/dashboard/**`. U3, con la consola nueva o con un cambio acordado en `WeatherPanel.jsx` y `dashboardMessages.js`, tiene que mostrar `empty` con «No hay clima del aeródromo en este momento.» o «El clima del aeródromo no está activado en este entorno.» (según `apiStatus`) y `unauthorized` con «Tu acceso no incluye el clima del aeródromo.» (los textos de `mapMessages`, grupo `weather.status`); dar el crédito del METAR con `source.name`, «NOAA Aviation Weather Center», y «No oficial», también en el nombre de la fuente («Meteorología MDPC (IEM)»), y dejar al historial de 6 horas, que sigue saliendo de Iowa Mesonet, su propio crédito; y pasar `apiStatus` a `isObservationStale`.
- **Iowa Mesonet en la CSP**: retirar `https://mesonet.agron.iastate.edu` cuando nada lo lea, en un cambio aparte que toca los tres archivos que afirman la CSP, `test-csp-tool.mjs` y las notas del Vault, como `demotiles.maplibre.org`.
- **La FIR**: el archivo de VATSpy que nombraba el plan ya no está publicado. Dibujar el límite aproximado de la FIR Santo Domingo pide otro extracto con una licencia clara, guardado con su fuente, su licencia y su fecha, y con su crédito solo mientras se vea la capa.
- **SIGMET y NOTAM**: no entran, y la API no los lee.
- **La pista en uso en el bloque de datos** de un vuelo real llega con M6; hoy solo un vuelo demo nombra la suya, la 08.
- **El plan de peticiones del marco** (`admin-occ/live/occRequestPlan.js`, del carril visual) no cuenta en esta rama la lectura del clima, una cada 10 minutos por pantalla.
