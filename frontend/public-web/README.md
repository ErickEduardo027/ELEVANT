# ELEVANT Public Web

Aplicación pública y portal de clientes/aerolíneas de AVIAM. Usa Next.js 16 y React 19. La landing es pública; el portal autenticado debe aislar todas las consultas y escrituras por organización y estaciones autorizadas desde la API.

La implementación actual es demostrativa: sesión, autorización, documentos, finanzas y la mayoría de los datos viven en adaptadores mock/locales. No representa una conexión segura con la API .NET ni con Production.

## Ejecutar y validar

Desde `frontend/public-web`:

```powershell
npm install
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
```

Para E2E, instale los navegadores de Playwright según su documentación y ejecute `npm run test:e2e`.

Variables públicas actuales:

```text
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_DEMO_FORM_MODE=preview
NEXT_PUBLIC_ELEVANT_API_URL=https://elevant-dev-api.taild2f562.ts.net
NEXT_PUBLIC_PROTOTYPE_API_URL=http://localhost:4310
```

`NEXT_PUBLIC_ELEVANT_API_URL` configura el cliente OpenAPI compartido. La variable del prototipo se conserva para migrar sus adaptadores gradualmente. Todo valor `NEXT_PUBLIC_*` queda incorporado al bundle y nunca puede contener secretos. Antes de cambiar código, lea el `AGENTS.md` de esta carpeta y la documentación incluida en la versión instalada de Next.

## Rutas observadas

- `/`: landing, propuesta comercial y solicitud demo.
- `/login`: acceso mock y afiliación local.
- `/portal`: resumen y actividad autorizada.
- `/portal/vuelos` y `/portal/vuelos/[operationId]`: búsqueda y detalle de turnarounds.
- `/portal/solicitudes`: solicitudes de servicio.
- `/portal/contratos`: vigencia, estaciones y tarifarios.
- `/portal/documentos`: documentos/evidencias autorizados.
- `/portal/finanzas`: prefacturas, facturas, conciliaciones y disputas.
- `/portal/reportes`: indicadores y exportaciones.
- `/portal/perfil`: organización, estaciones, permisos y auditoría.

## Contrato de seguridad

El navegador nunca decide el tenant confiable. La API obtiene la organización desde la membresía de la cuenta autenticada y aplica el scope de estación en cada consulta. Un `organizationId`, `airlineId` o `stationId` recibido del cliente se valida contra esa sesión; ocultar una opción o separar claves de `localStorage` no autoriza acceso.

Las escrituras previstas se limitan a capacidades expresas, como solicitudes de servicio y respuestas financieras. El portal no modifica vuelos, ejecución histórica, tarifas contractuales o auditoría. Cualquier ampliación requiere permiso de API, historial y pruebas de aislamiento entre tenants.

## Datos de demostración

La interfaz ofrece una identidad `.test` solo para UX. Es material sintético, no una cuenta de Production. El formulario comercial permanece en modo preview y no transmite solicitudes mientras no exista su contrato de backend.

## Despliegue previsto

Development usará una imagen Node no-root con salida Next `standalone`, construida en CI y desplegada aparte de AVIAM Web y API. Consumirá la misma API privada de Development. El sitio público de Production necesitará dominio público real; una URL del tailnet solo es válida para pruebas privadas.
