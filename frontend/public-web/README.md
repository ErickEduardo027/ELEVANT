# ELEVANT Public Web

Aplicación web de ELEVANT con landing comercial, afiliación y portal demostrativo responsive para aerolíneas clientes de AVIAM. La sesión, los datos y las acciones de esta entrega son locales: no se conectan a una operación ni a un backend real.

## Acceso demostrativo

- Correo: `operaciones@demo.elevant.test`
- Contraseña: `ElevantDemo2026!`
- Rol: `AIRLINE_ADMIN`
- Aerolínea: ELEVANT Demo Airlines
- Estación primaria: PUJ

El botón **Usar credenciales de demostración** completa el formulario. La pestaña de afiliación registra una solicitud local con referencia `ELV-AFL-*`; no crea una cuenta ni inicia sesión.

## Rutas

- `/`: landing comercial, recorrido operativo, preview del producto, piloto PUJ y solicitud de demostración.
- `/login`: acceso mock y solicitud de afiliación.
- `/portal`: resumen consultivo, KPIs, vuelos activos, cambios y notificaciones.
- `/portal/vuelos`: búsqueda, filtros y detalle de cada rotación autorizada.
- `/portal/solicitudes`: creación, consulta y cancelación controlada de solicitudes recibidas.
- `/portal/contratos`: vigencia, estaciones y tarifarios exportables.
- `/portal/documentos`: reportes/evidencias autorizados, descarga PDF y auditoría.
- `/portal/finanzas`: prefacturas, facturas, conciliaciones, disputas y reclamos.
- `/portal/reportes`: indicadores, gráficas accesibles y exportaciones CSV.
- `/portal/perfil`: organización, estaciones, permisos, zona horaria y auditoría.

## Alcance del portal mock

La experiencia prioriza consultas. Las únicas escrituras permitidas son solicitudes de servicio y respuestas financieras (aceptar, disputar o reclamar). No permite modificar vuelos, servicios ejecutados, contratos, documentos ni importes.

El repositorio aplica aislamiento por aerolínea y estación, permisos de sesión, procedencia de datos y persistencia por tenant en `localStorage`. Desde Perfil se puede restablecer únicamente el estado demo del portal.

## Experiencia gráfica

El hero de la landing usa Three.js con geometría procedural original y selecciona automáticamente uno de tres niveles:

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

El formulario comercial funciona en modo `preview`: valida los datos en el navegador, no los transmite y comunica ese límite de forma explícita.

La suite Playwright cubre escritorio, tablet y móvil, incluidos autenticación, guard, navegación, persistencia, acciones controladas, overflow horizontal y accesibilidad Axe.
