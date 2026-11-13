# Plano de MDPC: datos, licencias y revisión

Esta carpeta guarda el plano del aeropuerto de Punta Cana (MDPC / PUJ) que
dibujan los mapas del OCC desde el PR M3
([ADR-0043](../../../../../../../docs/adr/0043-occ-maps-one-engine.md)). Los
dos JSON se generan con `scripts/maps/build-mdpc-layout.mjs` y no se editan a
mano: una prueba los reconstruye y falla si no son idénticos a los
versionados.

## Qué hay aquí

**`mdpc.layout.json`**, el plano (esquema 1):

- `meta`: OACI, IATA, punto de referencia, elevación, caja del aeródromo, las
  fuentes con su fecha y 6 frecuencias;
- las 2 pistas, 08/26 y 09/27 (3 100 × 45 m), con sus umbrales y sus marcas;
- 52 calles de rodaje, 14 de ellas con nombre;
- el grafo de rodaje: 164 nodos, 204 tramos y 18 salidas de pista;
- 13 puntos de espera, 3 esperas de plataforma (A, B y FBO), 8 plataformas y
  5 terminales;
- las 42 posiciones (41 activas y la B33 retirada), cada una con su caja, su
  rumbo, su letra, su entrada, su procedencia y sus marcas de revisión;
- la pista habitual (`operations.preferred`): la 08, como suposición
  (decisión 19);
- `qa`: las 28 puertas y las 30 líneas de posición de OSM, solo para la
  revisión.

Lo lee [`airportLayout.js`](../airportLayout.js) (`MDPC_LAYOUT`), que va con el
código del mapa. Los servicios nunca lo importan: usan la lista corta
[`standReference.js`](../../stands/standReference.js).

**`region.context.json`**: 32 aeropuertos grandes y medianos a 300 NM o menos,
MDPC incluido, y las radioayudas PNA (VOR-DME 112,7) y PCA (NDB 425). Ninguna
pantalla lo lee todavía: está pensado para los aeropuertos de la región (M5) y
las radioayudas (M8).

Las coordenadas van como `[lng, lat]`, con 6 decimales. Los dos archivos usan
LF, dos espacios de sangría y un salto de línea final.

## Fuentes

Se extrajeron a mano el 13 de noviembre de 2026. Las mismas fechas van en
`meta.sources` del plano.

| Fuente | Qué aporta | Fecha | Licencia |
| --- | --- | --- | --- |
| OpenStreetMap, por la API de Overpass ([`fetch-mdpc-osm.mjs`](../../../../../scripts/maps/fetch-mdpc-osm.mjs) → `scripts/maps/input/mdpc.osm.json`) | El eje y el ancho de las pistas, las calles de rodaje, las plataformas, las terminales, las líneas de posición, las puertas y los puntos de espera, a 4 km o menos del punto de referencia (18.5674, −68.3634) | Base de OSM del 2026-11-13T17:33:17Z (`osm3s.timestamp_osm_base`) | ODbL 1.0 |
| OurAirports, por su espejo de GitHub ([`fetch-ourairports-mdpc.mjs`](../../../../../scripts/maps/fetch-ourairports-mdpc.mjs) → `scripts/maps/input/ourairports.mdpc.json`) | MDPC, los extremos y umbrales de sus pistas, sus frecuencias, PNA y PCA, y los aeropuertos de la región | `fetchedAt`: 2026-11-13T17:35:18Z | Dominio público |
| ELEVANT: [`positionsData.js`](../../../dashboard/positionsData.js) | Los 42 puntos internos de las posiciones (41 activos y la B33 retirada): el centro de cada posición (decisión 20) | El archivo versionado | Referencia interna, sin verificar contra el AIP: no es oficial |
| La tabla manual, `scripts/maps/input/stand-overrides.json` | Las correcciones de la revisión (abajo) | Cada entrada lleva su nota | Propia |

## Licencias

- **OpenStreetMap: ODbL 1.0** («© OpenStreetMap contributors»).
  - Mientras dibuja el aeródromo, el mapa da el crédito «© OpenStreetMap
    contributors (ODbL) · OurAirports», con enlaces a la página de derechos de
    OSM, a la licencia y a OurAirports. Lo lleva la fuente del aeródromo
    (`AIRFIELD_ATTRIBUTION`, en [`attribution.js`](../../core/attribution.js)),
    así que MapLibre lo muestra solo cuando alguna capa del aeródromo está en
    pantalla.
  - El extracto `scripts/maps/input/mdpc.osm.json` y el plano derivado
    `mdpc.layout.json` se ofrecen bajo la ODbL 1.0: quien reciba el plano
    puede recibir los dos archivos con la misma licencia.
  - El plano mezcla la geometría de OSM con los puntos propios de ELEVANT y con
    la tabla manual. Esa mezcla puede hacer de todo el archivo una base de
    datos derivada, puntos internos incluidos, y entonces todo él se ofrece
    bajo la ODbL. Si los puntos internos no deben salir con esa licencia, hay
    que sacarlos del plano antes de compartirlo.
  - El extracto guarda solo las etiquetas que lee el generador (`aeroway`,
    `ref`, `name`, `width`, `surface`, `length`, `building` y `terminal`), sin
    el usuario, la versión ni la fecha de edición de cada elemento.
- **OurAirports: dominio público**, sin garantía de exactitud. No exige
  crédito; el mapa lo da igual.
- **AIP y cartas del aeropuerto.** Nunca se copian sus coordenadas, ni a la
  tabla manual ni a ningún otro archivo: no consta permiso del IDAC para
  procesarlas. En la revisión, la carta de estacionamiento solo se mira para
  comparar.

## Cómo se regenera

Todo se corre desde `frontend/private-web`. Nada de esto corre en
`npm run build`, en las pruebas ni en el CI, y `Dockerfile.dockerignore` deja
`scripts/maps` fuera del contexto de la imagen.

1. **Actualizar las fuentes (con red, a mano y una sola vez).** Solo cuando
   haga falta un extracto nuevo:

   ```powershell
   node scripts/maps/fetch-mdpc-osm.mjs
   node scripts/maps/fetch-ourairports-mdpc.mjs
   ```

   - El primero manda una sola consulta a Overpass: las vías `aeroway` de
     pista, calle de rodaje y de plataforma (`taxiway` y `taxilane`),
     plataforma, posición, terminal y punto de espera, y los nodos de puerta,
     posición y punto de espera, a 4 km del punto de referencia. Usa un
     User-Agent genérico. Si Overpass responde 429 o 504, espera lo que pide
     (2 minutos como mucho) y prueba una vez más.
   - El segundo descarga cuatro tablas del espejo de OurAirports (aeropuertos,
     pistas, frecuencias y radioayudas) y guarda solo las filas de MDPC y de su
     región.
   - Antes de seguir, revisa el diff de las entradas: un cambio en OSM puede
     mover una posición o cambiar su rumbo.

2. **Generar el plano.** Sin red ni reloj: dos corridas dan los mismos bytes.

   ```powershell
   node scripts/maps/build-mdpc-layout.mjs            # escribe los dos JSON
   node scripts/maps/build-mdpc-layout.mjs --report   # además imprime el informe por posición
   node scripts/maps/build-mdpc-layout.mjs --check    # no escribe; falla si lo versionado no coincide
   ```

   Con `--check --report` se lee el informe sin escribir nada.

3. **Probar.**

   ```powershell
   npx vitest run --configLoader runner --config vitest.config.mjs src/features/maps/airport scripts/maps
   ```

   - [`mdpcLayout.generated.test.js`](../mdpcLayout.generated.test.js) es la
     prueba de igualdad: reconstruye el plano y el contexto desde las entradas
     versionadas y exige los mismos bytes. También comprueba la tabla manual:
     esquema 1, alias vacíos, solo los campos de abajo y una nota en cada
     entrada.
   - [`airportLayout.test.js`](../airportLayout.test.js) comprueba los
     criterios de aceptación (abajo).
   - `scripts/maps/lib/*.test.mjs` prueban el generador con entradas
     sintéticas.

4. **Revisar y versionar.** Revisa el resultado en el laboratorio (abajo) y
   versiona las entradas y los dos JSON en el mismo commit.

## Revisión manual

El plano no se da por bueno hasta que una persona lo revisa y lo firma.

1. **El informe.** `node scripts/maps/build-mdpc-layout.mjs --check --report`
   imprime en Markdown una fila por posición: la línea de OSM casada, la
   distancia del punto al centroide de esa línea, la puerta de OSM del mismo
   código y su distancia, el rumbo y de dónde sale, la letra, el ancho, el
   mayor solape, cómo se trazó la entrada y las marcas. Después, las pistas
   (los extremos de OSM contra los umbrales de OurAirports), los puntos de
   espera, las esperas de plataforma y lo descartado.
   - El rumbo sale de la tabla manual (`manual`), de la línea de OSM casada
     (`osm`), de la vecina de su fila con rumbo de OSM a 150 m o menos
     (`neighbour`) o del eje de su fila (`row`). De los dos sentidos del eje,
     una posición de contacto mira a su puerta de OSM o a la terminal más
     cercana. Una remota o de FBO deja detrás la calle de rodaje: toma el
     sentido cuya cola mira en línea recta a una calle a 150 m o menos (la más
     cercana, si las dos lo hacen); si ninguna, el que se aleja de la calle más
     cercana a ella, siempre que esa calle no quede a lo largo de su fila (a
     menos de 30° de su línea). Si nada cerca decide, la posición mira como la
     más cercana de su fila que estaciona en paralelo y sí está decidida, y el
     informe la nombra: `row (B36)`.
   - La entrada siempre llega por detrás, a lo largo del rumbo: `ray`, recta
     desde la calle que corta la cola a 150 m o menos; si no hay ninguna,
     `lineUp`: el avión se alinea detrás de su caja, a media caja de fondo más
     media de ancho del centro (63 m en una D, 45,5 m en una C), y la entrada
     va desde la calle más cercana a ese punto, sin cruzar su fila; `nearest`,
     cuando hasta esa calle queda delante de la posición: recta desde ella, y
     marcada.
   - Marcas que piden a una persona:
     - `unmatched`: ninguna línea de posición de OSM a 40 m o menos;
     - `ambiguous`: otra línea casi igual de cerca, otra posición casi igual
       de cerca de su línea, u OSM liga la puerta del mismo código a otra
       línea;
     - `far`: el centroide de OSM o la puerta del mismo código a más de 50 m;
     - `overlap`: se solapa más del 15 % con otra caja;
     - `crossesTaxiway`: una calle de rodaje cruza la caja;
     - `leadInCrosses`: la entrada cruza la caja de otra posición;
     - `leadInNotBehind`: la entrada sale de la calle a 90° o menos de la
       nariz, así que el avión llegaría de lado o de frente;
     - `offNetwork`: a más de 300 m de la red de rodaje;
     - `noLeadIn`: ninguna calle desde la que trazar la entrada.
   - Marcas que solo explican la caja: `narrowed` (más estrecha que su letra,
     por la separación de la fila) y `headingAssumed` (el rumbo sigue a su
     fila).
2. **La escena del laboratorio.** Con `npm run dev`, abre
   `/map-lab?scene=layout-qa` (solo existe en desarrollo;
   [escena](../../lab/LayoutQaScene.jsx)). Dibuja cada caja con su código, una
   flecha hacia donde apunta la nariz y sus marcas; los puntos de ELEVANT; las
   puertas y las líneas de posición de OSM; una línea al centroide de OSM
   cuando el punto queda a más de 15 m; el grafo de rodaje según hasta dónde
   se llega por él; los puntos de espera y las esperas de plataforma. Dos
   clics en nodos del grafo dibujan la ruta más corta por las calles de rodaje
   y dan su largo. La lista lateral muestra las 42 posiciones, primero las
   marcadas, y un clic encuadra la posición con su entrada, su puerta y su
   centroide.
   - Para tener capturas de todo,
     `npm run test:visual -- --project lab tests/visual/lab/map-lab.layout-qa.spec.mjs`
     escribe en `test-results/visual/` una captura del aeródromo, una por
     terminal, una por posición marcada y una de la ruta.
   - Comprueba también que cada punto cae en el centro del puesto y no en la
     parada de la rueda de nariz (decisión 20).
3. **Corregir.** Lo que la revisión decida va en la tabla manual (abajo).
   Regenera y vuelve a mirar la escena.
4. **Firmar.** Cada posición revisada lleva `reviewedBy` y `reviewedOn`. Con
   ellos, el plano marca `provenance.qa: 'reviewed'` y copia la firma.

### Quién revisa y firma

El dueño del producto, con el OCC de Punta Cana, revisa el informe y la escena,
decide cada marca y firma la tabla. `reviewedBy` lleva el rol de quien firma,
nunca un nombre ni un correo. El cambio entra por un PR como cualquier otro: el
PR muestra el informe, y quien lo revisa comprueba que las entradas y los JSON
cambian juntos y que las pruebas pasan.

## La tabla manual (`scripts/maps/input/stand-overrides.json`)

```json
{
  "schema": 1,
  "aliases": {},
  "stands": {
    "B31": { "headingTrue": 175, "note": "Por qué se corrige, en una frase." }
  }
}
```

Cada entrada de `stands` lleva el código de la posición y manda sobre todo lo
automático. Todos los campos son opcionales salvo `note`:

| Campo | Qué hace |
| --- | --- |
| `osmWay` | El id de la línea o del polígono de posición de OSM que le corresponde; `null` la deja sin geometría de OSM. |
| `headingTrue` | El rumbo verdadero hacia donde apunta la nariz del avión estacionado, en grados. |
| `sizeLetter` | La letra OACI del avión más grande que admite (`C`, `D`, `E` o `F`). Fija la caja, ancho por fondo: C 41 × 50 m, D 60 × 66 m, E 73 × 80 m y F 88 × 82 m. |
| `kind` | `contact`, `remote` o `fbo`. |
| `polygon` | Un anillo cerrado de pares `[lng, lat]` que reemplaza la caja. Solo medidas propias o geometría de OSM, nunca coordenadas del AIP ni de las cartas. |
| `retired` | `true` o `false`; manda sobre `positionsData.js`. |
| `note` | Obligatoria: por qué se corrige. |
| `reviewedBy`, `reviewedOn` | El rol de quien firmó y la fecha (`AAAA-MM-DD`). |

`aliases` liga un código que usa el aeropuerto con el código de una posición
del plano: `{ "<código del aeropuerto>": "<código de la posición>" }`. Nace
vacía y solo se llena con lo que confirme el dueño del producto: las
equivalencias nunca se infieren, y «9A» no es «A9». El formato no necesita
alias: los códigos se comparan con `normalizeStandCode`, así que `A01`, `a-1`
y `A1` ya son la misma posición. Hoy la prueba de igualdad exige la tabla de
alias vacía: el PR que añada un alias confirmado cambia esa prueba.

## Criterios de aceptación

[`airportLayout.test.js`](../airportLayout.test.js) los comprueba en cada
corrida:

- 42 posiciones: 41 activas con caja cerrada, rumbo y letra (C a F), y la B33
  retirada, sin nodo ni entrada.
- El centro de cada posición es su punto de `positionsData.js`, con la misma
  terminal y la misma marca de retirada (decisión 20).
- Cada posición activa llega a todas las salidas de pista por calles de rodaje
  y entradas, sin usar ningún tramo de pista. Su entrada empieza a 3 m o menos
  de una calle de rodaje y termina en su centro.
- La entrada de cada posición activa sale de la calle por detrás de ella (a
  más de 90° de la nariz) y no cruza la caja de ninguna otra posición activa.
- El grafo de rodaje es una sola pieza; cada punto de espera es un nodo del
  grafo, y hay una espera de plataforma por terminal (A, B y FBO).
- Ninguna posición activa se solapa más del 15 % con otra.
- Los umbrales de 08, 26, 09 y 27, y los extremos del eje de OSM, quedan a
  30 m o menos de los de OurAirports.
- La pista habitual es la 08 para llegar y salir, marcada como suposición.
- `A01` y `a-1` son `A1`; «1», «9A», «23A» y «N1» no casan con ninguna
  posición mientras la tabla de alias esté vacía; las puertas «1» a «11» y
  «N1» a «N5» de OSM nunca se toman por A1–A11 ni por AN1–AN5.
- La caja del aeródromo abarca las dos pistas, la de las posiciones queda
  dentro de ella y cada terminal tiene la suya.

La revisión firmada es el único criterio que no se prueba solo.

## Estado al 13 de noviembre de 2026

Sin firmar: las 42 posiciones tienen `provenance.qa: 'auto'`. Quedan 16
posiciones marcadas para una persona:

- sin geometría de OSM (`unmatched`): B31, B32, B34 a B37 y BN6 a BN13;
- dos candidatas (`ambiguous`): B29 y B30;
- una calle de rodaje cruza la caja (`crossesTaxiway`): BN9.

Los rumbos de B34 a B37 y de BN6 a BN13 son supuestos por su fila
(`headingAssumed`). B34 a B37 miran al este, con la cola al oeste: B36 y B37
dejan detrás la calle F, la más cercana, y B34 y B35 siguen a B36, porque la
calle E, al norte, corre a lo largo de su fila y no decide nada. BN6 a BN9
miran al norte, con la calle F detrás, y BN10 a BN13 al sur, con la calle E
detrás. Ninguna entrada cruza otra posición ni llega de lado o de frente.

B31 y B32 llevan en la tabla un rumbo provisional de 175°, con su nota y sin
firma. La tabla de alias está vacía.
