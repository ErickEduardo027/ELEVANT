# B788: aviso de origen, licencia y cambios

Modelo 3D del B788 (Boeing 787-8) para los mapas del OCC de ELEVANT (AVIAM). Es una obra derivada de un modelo publicado con licencia GPL-2.0-only y se distribuye con la misma licencia: el texto completo está en `LICENSE`.
Se construye a partir del modelo del Boeing 787-8.

## Origen

- Archivo: `b788/glTF2/B788.glb` del repositorio [Ysurac/FlightAirMap-3dmodels](https://github.com/Ysurac/FlightAirMap-3dmodels) en el commit `0906d9ba1bdd906ce45807e45ed706c09912db19`.
- URL fijada: https://raw.githubusercontent.com/Ysurac/FlightAirMap-3dmodels/0906d9ba1bdd906ce45807e45ed706c09912db19/b788/glTF2/B788.glb
- SHA-256 del original: `3aadb364c26ab61523bff4637020805b199eefa10e9fafe0e7834649ca54cd1e`.
- Autoría: Ysurac, repositorio FlightAirMap-3dmodels (modelos de FGMEMBERS vía fr24-3d-models de Aleksei Kalmykov / Flightradar24).
- Procedencia aguas arriba: [FGMEMBERS/787-8](https://github.com/FGMEMBERS/787-8).
- Licencia: GPL-2.0-only, según `b788/COPYING` de Ysurac/FlightAirMap-3dmodels.

## Cambios (2026-11-27, ELEVANT / AVIAM)

Hechos con `frontend/private-web/scripts/models/build-aircraft-models.mjs`; las medidas de destino son las de `src/features/maps/aircraft/types.js` (56,72 × 60,12 × 16,92 m).

- Girado al marco de la app (x a la derecha, y hacia la nariz, z arriba) desde «nose+Z».
- Quitadas todas las texturas, coordenadas UV y materiales originales: la librea es un shader de la app.
- Quitadas 29 piezas (380 triángulos): lbeacon, lbeaconbase, lbeaconlenz, lhlight, lhnavlite, lhturnoffl, lhturnofflt, lights.000, lights.001, lights.002, lights.003, llandlt, llandlt.001, lltcover, lltcover.0, lltcover.001, lltcover.002, logolts, rhlight, rhnavlite, rhturnoffl, rhturnofflt, rlandlt, rlandlt.001, tlight, ubeacon, ubeaconbase, ubeaconlenz, winglts.
- Quitadas 3 piezas duplicadas superpuestas (17 triángulos).
- Escalado ×1.0006 a la longitud del B788 (56,72 m).
- Centrado en la envergadura y la longitud y elevado: la parte más baja queda a 1,10 m del suelo (z = 0) y la deriva a 16,03 m (16,92 m publicados); el tren lo dibuja la app (est.).
- Normales recalculadas con el ángulo de pliegue de cada pieza; vértices soldados y cuantizados con KHR_mesh_quantization; materiales unificados en tres clases (cuerpo, vidrio, oscuro) de doble cara.
- L1 simplificado con meshoptimizer de 14333 a 7875 triángulos (ratio 0.55, error relativo 0.0003), en una primitiva.

## Marcas

Los nombres de fabricantes y de tipos de avión solo identifican el tipo representado. El modelo no lleva librea, logotipos ni marcas de ninguna aerolínea ni fabricante.
