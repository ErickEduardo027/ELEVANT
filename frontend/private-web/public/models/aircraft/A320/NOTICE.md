# A320: aviso de origen, licencia y cambios

Modelo 3D del A320 (Airbus A320) para los mapas del OCC de ELEVANT (AVIAM). Es una obra derivada de un modelo publicado con licencia GPL-2.0-only y se distribuye con la misma licencia: el texto completo está en `LICENSE`.
Se construye a partir del modelo del Airbus A320.

## Origen

- Archivo: `a320/glTF2/A320.glb` del repositorio [Ysurac/FlightAirMap-3dmodels](https://github.com/Ysurac/FlightAirMap-3dmodels) en el commit `0906d9ba1bdd906ce45807e45ed706c09912db19`.
- URL fijada: https://raw.githubusercontent.com/Ysurac/FlightAirMap-3dmodels/0906d9ba1bdd906ce45807e45ed706c09912db19/a320/glTF2/A320.glb
- SHA-256 del original: `e0972773364e17e7a94fe6823e82e7c2aef7d90c3b12e608e0e38dd057fdcbc7`.
- Autoría: Ysurac, repositorio FlightAirMap-3dmodels (modelos de FGMEMBERS vía fr24-3d-models de Aleksei Kalmykov / Flightradar24).
- Procedencia aguas arriba: [FGMEMBERS/A320-family](https://github.com/FGMEMBERS/A320-family).
- Licencia: GPL-2.0-only, según `a320/COPYING` de Ysurac/FlightAirMap-3dmodels.

## Cambios (2026-11-27, ELEVANT / AVIAM)

Hechos con `frontend/private-web/scripts/models/build-aircraft-models.mjs`; las medidas de destino son las de `src/features/maps/aircraft/types.js` (37,57 × 35,80 × 11,76 m).

- Girado al marco de la app (x a la derecha, y hacia la nariz, z arriba) desde «nose+X».
- Quitadas todas las texturas, coordenadas UV y materiales originales: la librea es un shader de la app.
- Escalado ×0.9817 a la longitud del A320 (37,57 m).
- Envergadura llevada de 33,29 a 34,10 m fuera del fuselaje (alas, motores y estabilizador).
- Añadidos sharklets procedurales (forma estimada): envergadura de 34,10 a 35,80 m.
- Centrado en la envergadura y la longitud y elevado: la parte más baja queda a 0,34 m del suelo (z = 0) y la deriva a 11,76 m (11,76 m publicados); el tren lo dibuja la app (est.).
- Normales recalculadas con el ángulo de pliegue de cada pieza; vértices soldados y cuantizados con KHR_mesh_quantization; materiales unificados en tres clases (cuerpo, vidrio, oscuro) de doble cara.
- L1 simplificado con meshoptimizer de 23056 a 12512 triángulos (ratio 0.54, error relativo 0.0003), en una primitiva.

## Marcas

Los nombres de fabricantes y de tipos de avión solo identifican el tipo representado. El modelo no lleva librea, logotipos ni marcas de ninguna aerolínea ni fabricante.
