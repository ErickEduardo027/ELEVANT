# Map glyphs of the visual suite

The OCC map style (`src/features/maps/style/occStyle.js`) asks the OpenFreeMap glyph server for its labels
(`https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf`), and it uses only the three stacks that server has:
Noto Sans Regular, Noto Sans Bold and Noto Sans Italic. The visual suite (`tests/visual`, `npm run test:visual`)
never lets the browser reach that server: `tests/visual/support/isolate.mjs` answers the `0-255` range of each
stack from these files and answers every other range with an empty 404.

| File | Size | SHA-256 |
| --- | --- | --- |
| `Noto Sans Regular/0-255.pbf` | 76 580 bytes | `ef1f38a3f1978591e846e9eaddf8a54f7047f546fc6aaed7872cc53151a5de78` |
| `Noto Sans Bold/0-255.pbf` | 81 170 bytes | `f60ce4cb899455c2203bd8293b550394ade53ffce8032bf9cc7f59255e49259c` |
| `Noto Sans Italic/0-255.pbf` | 79 907 bytes | `ae9c8894b4d2b6297da76a2e875685046f1f037f1a571ae006160a5540406086` |

## Origin

Downloaded once, unmodified, on 2026-11-13 from the OpenFreeMap font server:

```bash
curl -sS --fail -o "Noto Sans Regular/0-255.pbf" "https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/0-255.pbf"
curl -sS --fail -o "Noto Sans Bold/0-255.pbf" "https://tiles.openfreemap.org/fonts/Noto%20Sans%20Bold/0-255.pbf"
curl -sS --fail -o "Noto Sans Italic/0-255.pbf" "https://tiles.openfreemap.org/fonts/Noto%20Sans%20Italic/0-255.pbf"
```

Each file is a MapLibre glyph protobuf: one font stack, the range `0-255` and 223 signed-distance-field glyphs
(Latin-1). The stack name inside each file lists the Noto families OpenFreeMap combines (Noto Sans first; the Latin-1
glyphs come from Noto Sans). Replace them the same way, all three together, and update the table above.

## License

The glyphs are renderings of the Noto fonts, licensed under the SIL Open Font License, Version 1.1:
[OFL.txt](OFL.txt). They are test fixtures and are not served by the application.
