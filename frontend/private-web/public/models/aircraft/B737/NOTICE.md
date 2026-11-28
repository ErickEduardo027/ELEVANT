# B737: aviso de origen, licencia y cambios

Modelo 3D del B737 (Boeing 737-700) para los mapas del OCC de ELEVANT (AVIAM). Es una obra derivada de un modelo publicado con licencia GPL-2.0-only y se distribuye con la misma licencia: el texto completo está en `LICENSE`.
Es un **hermano ajustado**: se construye a partir del modelo del Boeing 737-800 y no es un modelo propio del B737.

## Origen

- Archivo: `models/gltf_v2/airplane/b738.glb` del repositorio [mbr1376/fr24-3d-models](https://github.com/mbr1376/fr24-3d-models) en el commit `3d0a50dfddf14cff653dd4ac6c6c11e3aa58b7de`.
- URL fijada: https://raw.githubusercontent.com/mbr1376/fr24-3d-models/3d0a50dfddf14cff653dd4ac6c6c11e3aa58b7de/models/gltf_v2/airplane/b738.glb
- SHA-256 del original: `edfcebe78f609d87198ca07b5d1146d783520ac211d92b07c5d29acc232d5de8`.
- Autoría: Aleksei Kalmykov (kalmykov) / Flightradar24, repositorio fr24-3d-models; conversión a glTF 2.0 de mbr1376.
- Procedencia aguas arriba: [FGMEMBERS/737-800](https://github.com/FGMEMBERS/737-800).
- Licencia: GPL-2.0-only, según `LICENSE` de mbr1376/fr24-3d-models.

## Cambios (2026-11-27, ELEVANT / AVIAM)

Hechos con `frontend/private-web/scripts/models/build-aircraft-models.mjs`; las medidas de destino son las de `src/features/maps/aircraft/types.js` (33,63 × 35,79 × 12,55 m).

- Quitadas 1 primitivas de líneas o puntos.
- Girado al marco de la app (x a la derecha, y hacia la nariz, z arriba) desde «nose-Z».
- Quitadas todas las texturas, coordenadas UV y materiales originales: la librea es un shader de la app.
- Quitadas 2 piezas (10708 triángulos): a-light, a-light1.
- Quitadas 1 piezas duplicadas superpuestas (32 triángulos).
- Escalado ×1.0013 a la longitud del B738 (39,47 m).
- Retirado un tramo de fuselaje de 2,44 m entre 21,50 y 26,00 m desde la nariz (sección constante; reparto estimado).
- Retirado un tramo de fuselaje de 3,40 m entre 6,75 y 14,50 m desde la nariz (sección constante; reparto estimado).
- Centrado en la envergadura y la longitud y elevado: la parte más baja queda a 0,42 m del suelo (z = 0) y la deriva a 12,55 m (12,55 m publicados); el tren lo dibuja la app (est.).
- Normales recalculadas con el ángulo de pliegue de cada pieza; vértices soldados y cuantizados con KHR_mesh_quantization; materiales unificados en tres clases (cuerpo, vidrio, oscuro) de doble cara.
- L1 simplificado con meshoptimizer de 14230 a 7827 triángulos (ratio 0.55, error relativo 0.0002), en una primitiva.

## Marcas

Los nombres de fabricantes y de tipos de avión solo identifican el tipo representado. El modelo no lleva librea, logotipos ni marcas de ninguna aerolínea ni fabricante.
