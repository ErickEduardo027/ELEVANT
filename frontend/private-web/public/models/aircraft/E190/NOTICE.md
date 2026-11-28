# E190: aviso de origen, licencia y cambios

Modelo 3D del E190 (Embraer E190) para los mapas del OCC de ELEVANT (AVIAM). Es una obra derivada de un modelo publicado con licencia GPL-2.0-only y se distribuye con la misma licencia: el texto completo está en `LICENSE`.
Se construye a partir del modelo del Embraer E190.

## Origen

- Archivo: `e190/glTF2/E190.glb` del repositorio [Ysurac/FlightAirMap-3dmodels](https://github.com/Ysurac/FlightAirMap-3dmodels) en el commit `0906d9ba1bdd906ce45807e45ed706c09912db19`.
- URL fijada: https://raw.githubusercontent.com/Ysurac/FlightAirMap-3dmodels/0906d9ba1bdd906ce45807e45ed706c09912db19/e190/glTF2/E190.glb
- SHA-256 del original: `1f44507cf61b869170545c89f8f9e536566ccebea289ca75e1419f148713407f`.
- Autoría: Ysurac, repositorio FlightAirMap-3dmodels (modelos de FGMEMBERS vía fr24-3d-models de Aleksei Kalmykov / Flightradar24).
- Procedencia aguas arriba: [FGMEMBERS/E-jet-family](https://github.com/FGMEMBERS/E-jet-family).
- Licencia: GPL-2.0-only, según `e190/License.txt` de Ysurac/FlightAirMap-3dmodels.

## Cambios (2026-11-27, ELEVANT / AVIAM)

Hechos con `frontend/private-web/scripts/models/build-aircraft-models.mjs`; las medidas de destino son las de `src/features/maps/aircraft/types.js` (36,24 × 28,72 × 10,57 m).

- Girado al marco de la app (x a la derecha, y hacia la nariz, z arriba) desde «nose+Z».
- Quitadas todas las texturas, coordenadas UV y materiales originales: la librea es un shader de la app.
- Quitadas 2 piezas (224 triángulos): beacon, beacon.001.
- Escalado ×1.0116 a la longitud del E190 (36,24 m).
- Centrado en la envergadura y la longitud y elevado: la parte más baja queda a 0,30 m del suelo (z = 0) y la deriva a 10,64 m (10,57 m publicados); el tren lo dibuja la app (est.).
- Normales recalculadas con el ángulo de pliegue de cada pieza; vértices soldados y cuantizados con KHR_mesh_quantization; materiales unificados en tres clases (cuerpo, vidrio, oscuro) de doble cara.
- L1 simplificado con meshoptimizer de 20165 a 11077 triángulos (ratio 0.55, error relativo 0.0001), en una primitiva.

## Marcas

Los nombres de fabricantes y de tipos de avión solo identifican el tipo representado. El modelo no lleva librea, logotipos ni marcas de ninguna aerolínea ni fabricante.
