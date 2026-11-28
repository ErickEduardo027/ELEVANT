# B752: aviso de origen, licencia y cambios

Modelo 3D del B752 (Boeing 757-200) para los mapas del OCC de ELEVANT (AVIAM). Es una obra derivada de un modelo publicado con licencia GPL-2.0-or-later y se distribuye con la misma licencia: el texto completo está en `LICENSE`.
Se construye a partir del modelo del Boeing 757-200.

## Origen

- Archivo: `b752/glTF2/B752.glb` del repositorio [Ysurac/FlightAirMap-3dmodels](https://github.com/Ysurac/FlightAirMap-3dmodels) en el commit `0906d9ba1bdd906ce45807e45ed706c09912db19`.
- URL fijada: https://raw.githubusercontent.com/Ysurac/FlightAirMap-3dmodels/0906d9ba1bdd906ce45807e45ed706c09912db19/b752/glTF2/B752.glb
- SHA-256 del original: `8f3ca67e2f956f5b799d83cb781462a9325f69a168d01387a26879966657622f`.
- Autoría: Ysurac, repositorio FlightAirMap-3dmodels (modelos de FGMEMBERS vía fr24-3d-models de Aleksei Kalmykov / Flightradar24).
- Procedencia aguas arriba: [FGMEMBERS/757-200](https://github.com/FGMEMBERS/757-200).
- Licencia: GPL-2.0-or-later, según `b752/LICENSE` de Ysurac/FlightAirMap-3dmodels.

## Cambios (2026-11-27, ELEVANT / AVIAM)

Hechos con `frontend/private-web/scripts/models/build-aircraft-models.mjs`; las medidas de destino son las de `src/features/maps/aircraft/types.js` (47,32 × 38,05 × 13,56 m).

- Girado al marco de la app (x a la derecha, y hacia la nariz, z arriba) desde «nose+X».
- Quitadas todas las texturas, coordenadas UV y materiales originales: la librea es un shader de la app.
- Escalado ×1.0210 a la longitud del B752 (47,32 m).
- Envergadura llevada de 39,16 a 38,05 m fuera del fuselaje (alas, motores y estabilizador).
- Centrado en la envergadura y la longitud y elevado: la parte más baja queda a 0,75 m del suelo (z = 0) y la deriva a 13,35 m (13,56 m publicados); el tren lo dibuja la app (est.).
- Normales recalculadas con el ángulo de pliegue de cada pieza; vértices soldados y cuantizados con KHR_mesh_quantization; materiales unificados en tres clases (cuerpo, vidrio, oscuro) de doble cara.
- L1 simplificado con meshoptimizer de 33454 a 14382 triángulos (ratio 0.43, error relativo 0.0002), en una primitiva.

## Marcas

Los nombres de fabricantes y de tipos de avión solo identifican el tipo representado. El modelo no lleva librea, logotipos ni marcas de ninguna aerolínea ni fabricante.
