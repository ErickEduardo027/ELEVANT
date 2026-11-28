# A333: aviso de origen, licencia y cambios

Modelo 3D del A333 (Airbus A330-300) para los mapas del OCC de ELEVANT (AVIAM). Es una obra derivada de un modelo publicado con licencia GPL-2.0-only y se distribuye con la misma licencia: el texto completo está en `LICENSE`.
Se construye a partir del modelo del Airbus A330-300.

## Origen

- Archivo: `a333/glTF2/A333.glb` del repositorio [Ysurac/FlightAirMap-3dmodels](https://github.com/Ysurac/FlightAirMap-3dmodels) en el commit `0906d9ba1bdd906ce45807e45ed706c09912db19`.
- URL fijada: https://raw.githubusercontent.com/Ysurac/FlightAirMap-3dmodels/0906d9ba1bdd906ce45807e45ed706c09912db19/a333/glTF2/A333.glb
- SHA-256 del original: `2b5a0083fc1bee1b9932ec1b1fb034d5288efbef31aa604c901c66490b84e7f8`.
- Autoría: Ysurac, repositorio FlightAirMap-3dmodels (modelos de FGMEMBERS vía fr24-3d-models de Aleksei Kalmykov / Flightradar24).
- Procedencia aguas arriba: [FGMEMBERS/A330-300](https://github.com/FGMEMBERS/A330-300).
- Licencia: GPL-2.0-only, según `a333/COPYING` de Ysurac/FlightAirMap-3dmodels.

## Cambios (2026-11-27, ELEVANT / AVIAM)

Hechos con `frontend/private-web/scripts/models/build-aircraft-models.mjs`; las medidas de destino son las de `src/features/maps/aircraft/types.js` (63,66 × 60,30 × 16,79 m).

- Girado al marco de la app (x a la derecha, y hacia la nariz, z arriba) desde «nose+Z».
- Quitadas todas las texturas, coordenadas UV y materiales originales: la librea es un shader de la app.
- Quitadas 6 piezas (604 triángulos): land-light-l, land-light-r, landing-l, landing-r, pw.nacelle0_, pw.nacelle0_.001.
- Escalado ×1.0097 a la longitud del A333 (63,66 m).
- Centrado en la envergadura y la longitud y elevado: la parte más baja queda a 1,10 m del suelo (z = 0) y la deriva a 16,77 m (16,79 m publicados); el tren lo dibuja la app (est.).
- Normales recalculadas con el ángulo de pliegue de cada pieza; vértices soldados y cuantizados con KHR_mesh_quantization; materiales unificados en tres clases (cuerpo, vidrio, oscuro) de doble cara.
- L1 simplificado con meshoptimizer de 17366 a 9544 triángulos (ratio 0.55, error relativo 0.0002), en una primitiva.

## Marcas

Los nombres de fabricantes y de tipos de avión solo identifican el tipo representado. El modelo no lleva librea, logotipos ni marcas de ninguna aerolínea ni fabricante.
