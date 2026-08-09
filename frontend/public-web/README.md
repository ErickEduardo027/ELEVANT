# ELEVANT Public Web

Aplicación pública de ELEVANT. Esta primera entrega contiene la landing promocional responsive y una pantalla transparente de preparación para el futuro portal de aerolíneas.

## Rutas

- `/`: experiencia comercial, recorrido operativo, preview de producto, alcance del piloto PUJ y formulario de demostración.
- `/login`: estado honesto del futuro acceso para aerolíneas; todavía no implementa autenticación.

## Experiencia gráfica

El hero usa Three.js con geometría procedural original y selecciona automáticamente uno de tres niveles:

- `FULL`: escritorio con WebGL, texturas completas y mayor detalle.
- `LITE`: tablet/móvil o dispositivos con recursos limitados.
- `STATIC`: movimiento reducido, ahorro de datos, red lenta o WebGL no disponible.

No se descarga ningún modelo 3D ni recurso multimedia desde terceros durante la ejecución. La procedencia y las licencias están documentadas en `public/assets/README.md` y `public/assets/3d/manifest.json`.

## Comandos

```powershell
npm install
npm run dev
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

El formulario de demostración funciona inicialmente en modo `preview`: valida los datos en el navegador, no los transmite y comunica ese límite de forma explícita.

La suite Playwright cubre Chrome de escritorio, tablet y móvil, incluidos overflow horizontal, navegación, formulario y accesibilidad Axe.
