# B77W: aviso de origen, licencia y cambios

Modelo 3D del B77W (Boeing 777-300ER) para los mapas del OCC de ELEVANT (AVIAM). Es una obra derivada de un modelo publicado con licencia GPL-2.0-only y se distribuye con la misma licencia: el texto completo está en `LICENSE`.
Se construye a partir del modelo del Boeing 777-300.

## Origen

- Archivo: `models/gltf_v2/airplane/b773.glb` del repositorio [mbr1376/fr24-3d-models](https://github.com/mbr1376/fr24-3d-models) en el commit `3d0a50dfddf14cff653dd4ac6c6c11e3aa58b7de`.
- URL fijada: https://raw.githubusercontent.com/mbr1376/fr24-3d-models/3d0a50dfddf14cff653dd4ac6c6c11e3aa58b7de/models/gltf_v2/airplane/b773.glb
- SHA-256 del original: `2a513928c397fe2951caf2b4211e053c17d845e6d9806deb53d680da9446915a`.
- Autoría: Aleksei Kalmykov (kalmykov) / Flightradar24, repositorio fr24-3d-models; conversión a glTF 2.0 de mbr1376.
- Procedencia aguas arriba: [FGMEMBERS/777](https://github.com/FGMEMBERS/777).
- Nota: FGMEMBERS/777 no trae archivo de licencia (solo AUTHORS: Syd Adams, Karla); fr24 publica el modelo como GPLv2.
- Licencia: GPL-2.0-only, según `LICENSE` de mbr1376/fr24-3d-models.

## Cambios (2026-11-27, ELEVANT / AVIAM)

Hechos con `frontend/private-web/scripts/models/build-aircraft-models.mjs`; las medidas de destino son las de `src/features/maps/aircraft/types.js` (73,86 × 64,80 × 18,50 m).

- Girado al marco de la app (x a la derecha, y hacia la nariz, z arriba) desde «nose-Z».
- Quitadas todas las texturas, coordenadas UV y materiales originales: la librea es un shader de la app.
- Quitadas 18 piezas (128 triángulos): Beacon01, Beacon01_001, Beacon02, Beacon02_001, Strobe01, Strobe01_001, Strobe02, Strobe02_001, Strobe03, Strobe03_001, greenflash, greenflash_001, redflash, redflash_001, redlight, redlight_001, whiteflash, whiteflash_001.
- Quitadas 71 piezas duplicadas superpuestas (6632 triángulos).
- Escalado ×0.9929 a la longitud del B77W (73,86 m).
- Góndola izquierda de Ø 3,72 a Ø 4,14 m y alargada ×1.05 (8 piezas; forma estimada).
- Góndola derecha de Ø 3,72 a Ø 4,14 m y alargada ×1.05 (8 piezas; forma estimada).
- Añadidas puntas inclinadas procedurales (forma estimada): envergadura de 60,29 a 64,80 m.
- Centrado en la envergadura y la longitud y elevado: la parte más baja queda a 1,10 m del suelo (z = 0) y la deriva a 18,41 m (18,50 m publicados); el tren lo dibuja la app (est.).
- Normales recalculadas con el ángulo de pliegue de cada pieza; vértices soldados y cuantizados con KHR_mesh_quantization; materiales unificados en tres clases (cuerpo, vidrio, oscuro) de doble cara.
- L1 simplificado con meshoptimizer de 17661 a 9713 triángulos (ratio 0.55, error relativo 0.0003), en una primitiva.

## Marcas

Los nombres de fabricantes y de tipos de avión solo identifican el tipo representado. El modelo no lleva librea, logotipos ni marcas de ninguna aerolínea ni fabricante.
