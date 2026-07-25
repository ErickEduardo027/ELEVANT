# Elevant Web

Esqueleto de la aplicación web. El framework todavía no está decidido: puede inicializarse con Next.js o Astro cuando exista una historia de usuario que permita evaluar renderizado, autenticación y despliegue. Hasta entonces este directorio no simula una aplicación ejecutable.

Laisha es responsable de `frontend/web`. Su destino predeterminado durante el
desarrollo será `https://api-dev.elevant.com`; no necesita ejecutar el backend
ni instalar SQL Server localmente.

## Inicialización futura

La elección entre Next.js, Astro u otra tecnología se hará en una Pull Request
independiente. Antes de ejecutar el CLI oficial, conservar este README y las
carpetas acordadas; los directorios que genere el framework deben mapearse a
`src/app`, `components`, `features`, `hooks`, `lib`, `services`, `types` y `config`,
sin borrar convenciones ni documentación útil.

## Límite de la aplicación

La web se comunica únicamente con la API Elevant mediante HTTPS y, cuando corresponda, con sus hubs SignalR. No debe:

- conectarse a SQL Server;
- llamar directamente a FlightAware u otro proveedor;
- contener credenciales, tokens de servidor o cadenas de conexión;
- duplicar contratos que puedan generarse desde OpenAPI.

Los valores con prefijos `NEXT_PUBLIC_`, `PUBLIC_` o equivalentes se entregan al navegador y, por tanto, nunca son secretos.

## Configuración local

1. Copiar `.env.example` al archivo local que use el framework elegido.
2. Activar una sola familia de variables: `NEXT_PUBLIC_*` para Next.js o `PUBLIC_*` para Astro.
3. Apuntar la URL base a la API del ambiente correspondiente, sin terminarla en `/api/v1` para que el cliente conserve explícito el versionado.
4. Mantener el archivo local de ambiente fuera de Git.

El modo mock debe ser reemplazable: una feature consume una interfaz o adaptador local, y ese adaptador selecciona datos simulados o el cliente de `packages/api-client`. Los componentes de presentación no deben conocer esa decisión.

## Estructura prevista

- `src/app`: composición, rutas y providers del framework elegido.
- `src/components`: componentes reutilizables sin reglas de negocio.
- `src/features`: cortes por capacidad del producto.
- `src/hooks`: hooks compartidos del framework elegido.
- `src/lib`: configuración, cliente HTTP, SignalR y utilidades técnicas.
- `src/services`: adaptadores de API y capacidades del navegador.
- `src/types`: tipos propios de interfaz no generados desde OpenAPI.
- `src/config`: lectura y validación de variables públicas.
- `public`: recursos estáticos públicos, nunca documentos privados.
- `tests`: configuración y pruebas transversales.

Cada vista que consulte datos debe diseñar y probar al menos estos estados: carga, éxito, resultado vacío, error recuperable y acceso no autorizado. Los errores HTTP se interpretan como Problem Details; no se muestran mensajes internos del servidor.

## Contratos y OpenAPI

El backend publica el documento OpenAPI. El flujo esperado es:

1. obtener un documento válido del ambiente de desarrollo o de un artefacto de CI;
2. guardarlo de forma reproducible en `packages/api-client/openapi`;
3. ejecutar el generador que se seleccione en ADR-0007;
4. revisar el cambio generado y ejecutar validaciones de frontend;
5. importar exclusivamente desde la superficie pública de `packages/api-client`.

No se edita manualmente `packages/api-client/generated`.

## Criterios antes de inicializar

- decisión registrada de framework y gestor de estado, si hace falta;
- versión de Node y pnpm fijadas en la raíz;
- estrategia de autenticación acordada con el backend;
- contrato OpenAPI accesible;
- pipeline web habilitado a partir de la plantilla de CI.
