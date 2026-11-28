# A332: aviso de origen, licencia y cambios

Modelo 3D del A332 (Airbus A330-200) para los mapas del OCC de ELEVANT (AVIAM). Es una obra derivada de un modelo publicado con licencia GPL-2.0-only y se distribuye con la misma licencia: el texto completo está en `LICENSE`.
Se construye a partir del modelo del Airbus A330-200.

## Origen

- Archivo: `a332/glTF2/A332.glb` del repositorio [Ysurac/FlightAirMap-3dmodels](https://github.com/Ysurac/FlightAirMap-3dmodels) en el commit `0906d9ba1bdd906ce45807e45ed706c09912db19`.
- URL fijada: https://raw.githubusercontent.com/Ysurac/FlightAirMap-3dmodels/0906d9ba1bdd906ce45807e45ed706c09912db19/a332/glTF2/A332.glb
- SHA-256 del original: `006cd3a20dd8f28ffaeec839b37121c83e0f60889330edfc3477246100d345aa`.
- Autoría: Ysurac, repositorio FlightAirMap-3dmodels (modelos de FGMEMBERS vía fr24-3d-models de Aleksei Kalmykov / Flightradar24).
- Procedencia aguas arriba: [FGMEMBERS/A330-200](https://github.com/FGMEMBERS/A330-200).
- Licencia: GPL-2.0-only, según `a332/COPYING` de Ysurac/FlightAirMap-3dmodels.

## Cambios (2026-11-27, ELEVANT / AVIAM)

Hechos con `frontend/private-web/scripts/models/build-aircraft-models.mjs`; las medidas de destino son las de `src/features/maps/aircraft/types.js` (58,82 × 60,30 × 17,39 m).

- Girado al marco de la app (x a la derecha, y hacia la nariz, z arriba) desde «nose+Z».
- Quitadas todas las texturas, coordenadas UV y materiales originales: la librea es un shader de la app.
- Quitadas 4 piezas (380 triángulos): land-light-l, land-light-r, pw.nacelle0_, pw.nacelle0_.001.
- Escalado ×1.0079 a la longitud del A332 (58,82 m).
- Centrado en la envergadura y la longitud y elevado: la parte más baja queda a 1,10 m del suelo (z = 0) y la deriva a 17,36 m (17,39 m publicados); el tren lo dibuja la app (est.).
- Normales recalculadas con el ángulo de pliegue de cada pieza; vértices soldados y cuantizados con KHR_mesh_quantization; materiales unificados en tres clases (cuerpo, vidrio, oscuro) de doble cara.
- L1 simplificado con meshoptimizer de 17648 a 9701 triángulos (ratio 0.55, error relativo 0.0002), en una primitiva.

## Marcas

Los nombres de fabricantes y de tipos de avión solo identifican el tipo representado. El modelo no lleva librea, logotipos ni marcas de ninguna aerolínea ni fabricante.
