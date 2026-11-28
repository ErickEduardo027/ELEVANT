# Logotipos de texto de las libreas (plan M5)

Los logotipos que la capa 3D de los mapas del OCC pinta en la deriva de los modelos de aviones (`src/features/maps/aircraft/liveryMaterial.js`, ranura `logoTexture` de `liveries.js`). Son logotipos de texto o de formas simples tomados de Wikimedia Commons, donde están marcados como de dominio público ({{PD-textlogo}} o {{PD-shape}}) y como marcas registradas ({{Trademarked}}).

La app los dibuja en un solo color, el del texto de la deriva de cada librea, sin sus colores de marca.

## Archivos

| Archivo | Aerolínea | Archivo de Commons | Etiquetas | Subido | SHA-256 |
| --- | --- | --- | --- | --- | --- |
| `AA.svg` | American Airlines | <https://commons.wikimedia.org/wiki/File:American_Airlines_wordmark_(2013).svg> | {{PD-textlogo}} + {{Trademarked}} | 2016-03-04 | `b44d2633b3841971…` |
| `AC.svg` | Air Canada | <https://commons.wikimedia.org/wiki/File:Air_Canada_2017.svg> | {{PD-textlogo}} + {{Trademarked}} | 2020-05-16 | `c99d40d1e794ac1a…` |
| `AV.svg` | Avianca | <https://commons.wikimedia.org/wiki/File:Avianca_2023_wordmark.svg> | {{PD-shape}} + {{Trademarked}} | 2025-11-23 | `1fea8f4c4de4ce84…` |
| `B6.svg` | JetBlue | <https://commons.wikimedia.org/wiki/File:JetBlue_Airways_Logo.svg> | {{PD-textlogo}} + {{Trademarked}} | 2012-08-31 | `b8a822879347b600…` |
| `DL.svg` | Delta Air Lines | <https://commons.wikimedia.org/wiki/File:Delta_logo.svg> | {{PD-textlogo}} + {{Trademarked}} | 2018-12-18 | `9dcdd6acba0a4e0f…` |
| `F9.svg` | Frontier Airlines | <https://commons.wikimedia.org/wiki/File:Frontier_Airlines_logo.svg> | {{PD-textlogo}} + {{Trademarked}} | 2020-03-09 | `51c0d56f11230166…` |
| `NK.svg` | Spirit Airlines | <https://commons.wikimedia.org/wiki/File:Spirit_Airlines_logo_2014.svg> | {{PD-textlogo}} + {{Trademarked}} | 2017-05-03 | `6f2665dca6c14eb1…` |
| `P5.svg` | Wingo | <https://commons.wikimedia.org/wiki/File:Wingo_logo_2016.svg> | {{PD-shape}} + {{Trademarked}} | 2025-06-05 | `deb9c79ec900eafc…` |
| `UA.svg` | United Airlines | <https://commons.wikimedia.org/wiki/File:United_Airlines_wordmark.svg> | {{PD-textlogo}} + {{Trademarked}} | 2026-10-09 | `9e2c130d056482dd…` |
| `UX.svg` | Air Europa | <https://commons.wikimedia.org/wiki/File:Air_Europa_Logo_(2015).svg> | {{PD-textlogo}} + {{Trademarked}} | 2016-03-13 | `356d5834c0c66afd…` |
| `WG.svg` | Sunwing Airlines | <https://commons.wikimedia.org/wiki/File:Sunwings_logo_2015.svg> | {{PD-textlogo}} + {{Trademarked}} | 2016-02-23 | `f9cb914fe7f52be6…` |
| `WS.svg` | WestJet | <https://commons.wikimedia.org/wiki/File:WestJetLogo2018.svg> | {{PD-textlogo}} + {{Trademarked}} | 2025-07-26 | `85a532f798ed3a9d…` |

`logos.json` guarda, para cada archivo, la página y el archivo original de Commons, su SHA-1 en Commons, la fecha de subida, las etiquetas leídas, el tamaño y el SHA-256 completo de la copia servida. Las etiquetas se comprobaron el 2026-11-28 con la API de Commons: `LicenseShortName` «Public domain» y la plantilla en el wikitexto de cada página.

## Sin logotipo

Estas aerolíneas no tienen logotipo aquí. La deriva lleva su código IATA en la letra de la app.

- Copa (`CM`) y Arajet (`DM`): en Commons solo hay un PNG o un JPG, no un SVG.
- Southwest (`WN`), Air Transat (`TS`) y Air France (`AF`): no se buscó un archivo de texto con esas etiquetas.

Por decisión del plan no se usan los símbolos con derechos de autor: la «AA» (Flight Symbol) de American, el globo de United ni las colas con animales de Frontier. De American, United y Frontier se usa solo el logotipo de texto.

## Cambios

`scripts/models/fetch-livery-logos.mjs` descarga cada archivo y comprueba su licencia y su SHA-1. Luego lo limpia con `scripts/models/lib/svg.mjs`:

- quita el prólogo XML, el doctype, los comentarios y los metadatos;
- quita los espacios de nombres de los editores (Inkscape, Sodipodi, Illustrator);
- quita los scripts, los atributos de eventos, `foreignObject`, las imágenes incrustadas y los enlaces que salen del archivo;
- añade el ancho y el alto desde su `viewBox` cuando faltan.

Las formas no cambian. Para rehacer la carpeta, desde `frontend/private-web`:

```sh
node scripts/models/fetch-livery-logos.mjs [--only AA,DL]
```

## Aviso de marcas

Estos logotipos son marcas de sus aerolíneas. Que sean de dominio público en cuanto a derechos de autor, según el criterio de Commons y sobre todo de la ley de Estados Unidos, no concede ningún derecho de marca. El texto de {{Trademarked}} dice: «This work includes material that may be protected as a trademark in some jurisdictions. If you want to use it, you have to ensure that you have the legal right to do so and that you do not infringe any trademark rights.»

ELEVANT los usa solo para identificar a qué aerolínea pertenece cada avión en los mapas internos del OCC de AVIAM. No indica ningún patrocinio, aval ni relación con esas aerolíneas. Si se van a usar de otra forma, o fuera de la herramienta interna, hay que pedir antes permiso o los recursos de marca a cada aerolínea.
