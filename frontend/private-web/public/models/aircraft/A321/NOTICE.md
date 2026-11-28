# A321: aviso de origen, licencia y cambios

Modelo 3D del A321 (Airbus A321) para los mapas del OCC de ELEVANT (AVIAM). Es una obra derivada de un modelo publicado con licencia GPL-2.0-only y se distribuye con la misma licencia: el texto completo está en `LICENSE`.
Se construye a partir del modelo del Airbus A321.

## Origen

- Archivo: `a320/glTF2/A321.glb` del repositorio [Ysurac/FlightAirMap-3dmodels](https://github.com/Ysurac/FlightAirMap-3dmodels) en el commit `0906d9ba1bdd906ce45807e45ed706c09912db19`.
- URL fijada: https://raw.githubusercontent.com/Ysurac/FlightAirMap-3dmodels/0906d9ba1bdd906ce45807e45ed706c09912db19/a320/glTF2/A321.glb
- SHA-256 del original: `c6e223e01386e5f184e6dea6e83b2956964ee24ae32832f8600dbca5d7e6d7af`.
- Autoría: Ysurac, repositorio FlightAirMap-3dmodels (modelos de FGMEMBERS vía fr24-3d-models de Aleksei Kalmykov / Flightradar24).
- Procedencia aguas arriba: [FGMEMBERS/A320-family](https://github.com/FGMEMBERS/A320-family).
- Licencia: GPL-2.0-only, según `a320/COPYING` de Ysurac/FlightAirMap-3dmodels.

## Cambios (2026-11-27, ELEVANT / AVIAM)

Hechos con `frontend/private-web/scripts/models/build-aircraft-models.mjs`; las medidas de destino son las de `src/features/maps/aircraft/types.js` (44,51 × 35,80 × 11,76 m).

- Girado al marco de la app (x a la derecha, y hacia la nariz, z arriba) desde «nose+Z».
- Quitadas todas las texturas, coordenadas UV y materiales originales: la librea es un shader de la app.
- Escalado ×0.9998 a la longitud del A321 (44,51 m).
- Añadidos sharklets procedurales (forma estimada): envergadura de 33,90 a 35,80 m.
- Centrado en la envergadura y la longitud y elevado: la parte más baja queda a 0,37 m del suelo (z = 0) y la deriva a 11,76 m (11,76 m publicados); el tren lo dibuja la app (est.).
- Normales recalculadas con el ángulo de pliegue de cada pieza; vértices soldados y cuantizados con KHR_mesh_quantization; materiales unificados en tres clases (cuerpo, vidrio, oscuro) de doble cara.
- L1 simplificado con meshoptimizer de 25550 a 13904 triángulos (ratio 0.54, error relativo 0.0002), en una primitiva.

## Marcas

Los nombres de fabricantes y de tipos de avión solo identifican el tipo representado. El modelo no lleva librea, logotipos ni marcas de ninguna aerolínea ni fabricante.
