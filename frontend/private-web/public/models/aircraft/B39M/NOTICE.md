# B39M: aviso de origen, licencia y cambios

Modelo 3D del B39M (Boeing 737 MAX 9) para los mapas del OCC de ELEVANT (AVIAM). Es una obra derivada de un modelo publicado con licencia GPL-2.0-only y se distribuye con la misma licencia: el texto completo está en `LICENSE`.
Se construye a partir del modelo del Boeing 737 MAX 9.

## Origen

- Archivo: `Models/737-9.ac` del repositorio [REXO-77/737-MAX](https://github.com/REXO-77/737-MAX) en el commit `fc4316a01c1ec488789725bb54ed2f454f931ac6`.
- URL fijada: https://raw.githubusercontent.com/REXO-77/737-MAX/fc4316a01c1ec488789725bb54ed2f454f931ac6/Models/737-9.ac
- SHA-256 del original: `9372aadb7a2c4b2f7a1d4386f0f02fe0a4916d48f36b62f8070d3dbd117fcbec`.
- Autoría: REXO-77/737-MAX: Israel Emmanuel (naviat-dev), SP-NTX, Captain Jake, Semir Gebran (CaptB), Marsdolphin y otros; «Original model by omri_ha_muglob».
- Procedencia aguas arriba: [REXO-77/737-MAX](https://github.com/REXO-77/737-MAX).
- Licencia: GPL-2.0-only, según `LICENSE` de REXO-77/737-MAX.

## Cambios (2026-11-27, ELEVANT / AVIAM)

Hechos con `frontend/private-web/scripts/models/build-aircraft-models.mjs`; las medidas de destino son las de `src/features/maps/aircraft/types.js` (42,16 × 35,92 × 12,29 m).

- Girado al marco de la app (x a la derecha, y hacia la nariz, z arriba) desde «nose-X».
- Quitadas todas las texturas, coordenadas UV y materiales originales: la librea es un shader de la app.
- Quitadas 61 piezas (17932 triángulos): beacon, interior.aft, interior.fwd, light.strobeA, light.strobeL, light.strobeR, lightning.elevatorL, lightning.elevatorR, lightning.rudder, lightning.vstab, lightning.wingL, lightning.wingR, lights.landing, mlg.armL1, mlg.armL2, mlg.armL3, mlg.armR1, mlg.armR2, mlg.armR3, mlg.axleL, mlg.axleR, mlg.coverL1, mlg.coverL2, mlg.coverL3, mlg.coverR1, mlg.coverR2, mlg.coverR3, mlg.coverarmL, mlg.coverarmR, mlg.lowerL, mlg.lowerR, mlg.scissorLL, mlg.scissorLR, mlg.scissorUL, mlg.scissorUR, mlg.tireL, mlg.tireR, mlg.upperL, mlg.upperR, nlg.arm, nlg.arm.001, nlg.arm.002, nlg.arm.003, nlg.axle, nlg.doorL, nlg.doorR, nlg.lower, nlg.scissorsL, nlg.scissorsU, nlg.tire, nlg.upper, overlay.cdoor.aftO, overlay.cdoor.fwd, overlay.doorAL, overlay.doorAR, overlay.doorFL, overlay.doorFR, overlay.engine1, overlay.engine2, overlay.engine3, overlay.fuse1.
- Escalado ×1.0021 a la longitud del B39M (42,16 m).
- Centrado en la envergadura y la longitud y elevado: la parte más baja queda a 0,30 m del suelo (z = 0) y la deriva a 12,33 m (12,29 m publicados); el tren lo dibuja la app (est.).
- Normales recalculadas con el ángulo de pliegue de cada pieza; vértices soldados y cuantizados con KHR_mesh_quantization; materiales unificados en tres clases (cuerpo, vidrio, oscuro) de doble cara.
- L1 simplificado con meshoptimizer de 25982 a 14285 triángulos (ratio 0.55, error relativo 0.0003), en una primitiva.

## Marcas

Los nombres de fabricantes y de tipos de avión solo identifican el tipo representado. El modelo no lleva librea, logotipos ni marcas de ninguna aerolínea ni fabricante.
