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

**2. Listo al cargar el estilo; solo un constructor que falla es fatal.**
- El motor está listo (`ready`) en `style.load`, no al cargar las teselas.
- Solo un constructor que lanza es fatal (`unavailable`): `GPUInitializationError` lleva el motivo `webgl`, y cualquier otro error, `error`. `OccMap` muestra entonces `MapUnavailable` (`role="alert"`, con el título y la descripción de cada pantalla) y la lista de posiciones o de vuelos del mapa para seguir trabajando.
- El mapa base se vigila aparte: un error de la fuente `openmaptiles`, o 8 s sin su primera tesela, lo marcan `degraded`. Es un aviso, «No se pudo cargar el mapa base. Se muestran las posiciones y los datos de ELEVANT.», no un respaldo: las posiciones, las referencias y la selección siguen funcionando.
- Lo que necesita el estilo (datos, estado de las entidades, visibilidad, rangos de zoom, grupos y capas personalizadas) espera a que cargue y corre en el orden en que se pidió. Una llamada que falla deja su traza y no tapa a las demás.
- *Por qué:* el estilo va en el bundle y las posiciones son datos propios, así que la rampa sirve aunque OpenFreeMap esté lento o caído.
- *Descartado:* el plazo de 8 s hasta `idle` de antes, que convertía un servidor de teselas lento en un mapa muerto.

**3. Workers precalentados y lo que se repone tras perder el contexto.**
- `core/workerUrl.js` exporta la ruta literal `'/assets/maplibre/maplibre-gl-worker.mjs'`, la que `scripts/verify-maplibre-worker.mjs` busca en los chunks del build, y `ensureWorkerUrl()`, que llama a `setWorkerUrl` y después a `prewarm()` una sola vez por módulo. El grupo de workers sobrevive a los mapas: ni un remontaje de Strict Mode ni uno de la página crean y terminan workers.
- Tras `webglcontextlost`, el motor deja de aplicar llamadas al estilo. MapLibre 6.16 reconstruye el estilo con sus datos e imágenes y dispara `webglcontextrestored` antes de que ese estilo cargue: en el `style.load` siguiente, o en el acto si ya cargó, el motor vuelve a poner las capas personalizadas en su slot y el estado de las entidades que recuerda. La selección es un dato de su propia fuente, no estado de entidad, así que no hay que reponerla.
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
- Doce ids fijos, sin tema ni color en el nombre: `stand-frame-solid`, `stand-frame-dash-4-3`, `stand-frame-dash-2-2`, `stand-frame-dot-1-3`, `stand-slab`, `stand-hatch`, `glyph-aircraft`, `glyph-axis`, `glyph-clock`, `stand-selected`, `aircraft-solid` y `airport-arp`. La silueta del avión es la de `maps/aircraftSilhouette.js`.
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
- `relatedEntities` queda mínima: un vuelo marca su posición (la asignada, o la sugerida de un vuelo demo sin importar), y una posición marca su vuelo actual o el siguiente. Lee los vuelos del mapa; las posiciones traerán sus visitas con M4.
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
- `ui/MapLegend.jsx`, con `ui/legendEntries.js`, lista solo lo que hay en pantalla:
  - los estados de las posiciones dibujadas una a una dentro de la vista, en el orden del vocabulario;
  - «No oficial», cuando una de ellas no la ubicó OCC y está en su ubicación de referencia interna;
  - qué es un grupo, cuando las posiciones en pantalla se agrupan.
- Cada muestra dibuja la posición como la dibuja el mapa (relleno, contorno, trazo y el símbolo de dentro), así «Ocupada», «Llegando» y «Por liberar» se distinguen sin color.
- Se pliega con su propio botón, que siempre se llama «Leyenda» e indica con `aria-expanded` si está abierta, y no se muestra cuando no hay nada que explicar. Solo cambia cuando cambia lo que hay en pantalla, nunca por cuadro. Va abajo, en el centro, con el selector de vistas (`ui/MapDock.jsx` y `ui/MapPresetSwitcher.jsx`).
- *Por qué:* lo pidió Erick: cada mapa muestra su leyenda. Una leyenda de todo explicaría lo que la pantalla no muestra.
- *Descartado:* una leyenda fija con los siete estados; abrirla con una tecla, porque es un botón (contratos 2.2).

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
  - la leyenda lista solo los estados en pantalla;
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
- Los marcadores de los mapas ya no pintan con `STATUS_COLORS`: para los mapas se cierra lo que ADR-0044 dejó pendiente. Las leyendas y el resumen de las páginas (`FlightLegend`, `PositionLegend` y `PositionSummary`) siguen hasta U5.
- La consola actual conserva tres mapas (la plataforma, la región y la meteorología), y su vista ampliada monta otro mapa en un diálogo, hasta que U3 la rehaga como un solo `OccMap` a pantalla completa.
- Sin cambios fuera de AVIAM Web:
  - no cambian la API, el OpenAPI, el cliente compartido ni la base, y no hay migración;
  - no entra ninguna dependencia, y sale `@googlemaps/js-api-loader`;
  - la CSP no cambia: la TileJSON, las teselas y los glifos siguen en `tiles.openfreemap.org`, que ya estaba permitido, y el worker sigue en el propio origen;
  - solo se despliega AVIAM Web (`frontend/private-web`).
- El riesgo R7 del Vault («Dependencias cartográficas demo») sigue abierto: OpenFreeMap es un servicio público sin acuerdo de servicio. Cambiar de proveedor es ahora un cambio de código (`OPENFREEMAP_TILEJSON` y `GLYPHS_URL`, en `occStyle.js`) y de la CSP, no una variable.
- Pruebas nuevas, junto a cada archivo: las del motor y de `OccMap` (con la de `Esc`), las vistas, la selección, la atribución, el estilo, la paleta, los íconos y el SDF; las capas de posiciones, de referencias, de selección y de vuelos; la leyenda y el selector de vistas; los mensajes en español e inglés; el laboratorio y sus escenas; `noSetStyle.test.js` y el mapa falso compartido. Además, la comprobación de `verify-map-chunks.mjs` en `test:delivery` y la suite visual. Se reescribieron las pruebas de `FlightMap.jsx` y `PositionMap.jsx`, y se borraron las de los archivos retirados.

**Queda pendiente**
- **`demotiles.maplibre.org` en la CSP.** Ningún mapa lo usa desde M2, pero sigue permitido. Retirarlo cambia a la vez los tres archivos que afirman la CSP (`src/config/securityHeaders.mjs`, `scripts/test-development-delivery.mjs` y `frontend/scripts/deployment/csp-tool.mjs`), la prueba de este último (`frontend/tests/deployment/test-csp-tool.mjs`) y las dos notas del Vault que describen los orígenes (Private Web e Integraciones externas). Va en un cambio aparte.
- **El anfitrión que conserva el motor entre rutas** (`core/engineHost.js`, con la cámara entre los módulos del OCC), que el plan aplaza. Hoy cada ruta crea su mapa, sobre el grupo de workers ya precalentado.
- **Mapa de posiciones** muestra dos leyendas: la del mapa y la de la página (`PositionLegend`), que todavía pinta colores que el mapa ya no dibuja. A 1440×900 su resumen (`PositionSummary`) tapa la escala, el botón de los créditos y las posiciones A1 a A5. Lo rehace U5, que también le pasará al mapa la zona que tapan sus paneles (`insets`).
- **`/map-lab` en producción** responde la página de no encontrada con el estado 200, no con un 404: el layout raíz transmite cada página dentro de un `Suspense`, así que Next manda esa página con el 200 ya enviado y la marca `noindex`. El laboratorio no está en el bundle.
- **Los mapas viejos del dashboard** (`RegionalTrafficMap.jsx` y `GoesCloudMap.jsx`) conservan su ciclo de vida, `basemapStyles.js` con los estilos publicados de OpenFreeMap y `collapseCompactAttribution.js`, hasta que U3 borre el dashboard actual.
- **El 3D de M2** es la inclinación de cámara de siempre, más los edificios con altura en la plataforma de la consola. Los aviones 3D, el 3D encendido por defecto en Aeródromo y Rampa, y recordar esa elección llegan con M7.
