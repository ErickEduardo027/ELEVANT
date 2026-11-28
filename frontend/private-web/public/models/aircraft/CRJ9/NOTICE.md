# CRJ9: aviso de origen, licencia y cambios

Modelo 3D del CRJ9 (Bombardier CRJ900) para los mapas del OCC de ELEVANT (AVIAM). Es una obra derivada de un modelo publicado con licencia GPL-2.0-or-later y se distribuye con la misma licencia: el texto completo está en `LICENSE`.
Se construye a partir del modelo del Bombardier CRJ900.

## Origen

- Archivo: `crj9/glTF2/CRJ9.glb` del repositorio [Ysurac/FlightAirMap-3dmodels](https://github.com/Ysurac/FlightAirMap-3dmodels) en el commit `0906d9ba1bdd906ce45807e45ed706c09912db19`.
- URL fijada: https://raw.githubusercontent.com/Ysurac/FlightAirMap-3dmodels/0906d9ba1bdd906ce45807e45ed706c09912db19/crj9/glTF2/CRJ9.glb
- SHA-256 del original: `efcf8af5cc9325937e96eb1f4d0dcf72bd29cb6fb51470d583517f26878f30fc`.
- Autoría: Ysurac, repositorio FlightAirMap-3dmodels (modelos de FGMEMBERS vía fr24-3d-models de Aleksei Kalmykov / Flightradar24).
- Procedencia aguas arriba: [FGMEMBERS/CRJ700-family](https://github.com/FGMEMBERS/CRJ700-family).
- Licencia: GPL-2.0-or-later, según `crj9/LICENSE` de Ysurac/FlightAirMap-3dmodels y `a320/COPYING` de Ysurac/FlightAirMap-3dmodels.

## Cambios (2026-11-27, ELEVANT / AVIAM)

Hechos con `frontend/private-web/scripts/models/build-aircraft-models.mjs`; las medidas de destino son las de `src/features/maps/aircraft/types.js` (36,20 × 24,85 × 7,51 m).

- Girado al marco de la app (x a la derecha, y hacia la nariz, z arriba) desde «nose+Z».
- Quitadas todas las texturas, coordenadas UV y materiales originales: la librea es un shader de la app.
- Quitadas 7 piezas (1804 triángulos): LandingLtCases, LandingLtLens, LandingLts, RAT, RATBlades, StairHandles, Stairs.
- Escalado ×0.9957 a la longitud del CRJ9 (36,20 m).
- Envergadura llevada de 23,81 a 24,85 m fuera del fuselaje (alas, motores y estabilizador).
- Centrado en la envergadura y la longitud y elevado: la parte más baja queda a 0,60 m del suelo (z = 0) y la deriva a 6,66 m (7,51 m publicados); el tren lo dibuja la app (est.).
- Normales recalculadas con el ángulo de pliegue de cada pieza; vértices soldados y cuantizados con KHR_mesh_quantization; materiales unificados en tres clases (cuerpo, vidrio, oscuro) de doble cara.
- L1 simplificado con meshoptimizer de 13663 a 7503 triángulos (ratio 0.55, error relativo 0.0002), en una primitiva.

## Marcas

Los nombres de fabricantes y de tipos de avión solo identifican el tipo representado. El modelo no lleva librea, logotipos ni marcas de ninguna aerolínea ni fabricante.
