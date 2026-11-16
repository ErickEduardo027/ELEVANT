# ADR-0007: Generar el cliente TypeScript compartido con Orval

## Estado

Accepted — 2026-09-05.

## Contexto

Private Web, Public Web y Mobile Agent consumen una sola API versionada, pero se
ejecutan respectivamente sobre Vite, Next.js y Expo/React Native. Duplicar DTOs y
llamadas HTTP en esos tres clientes permitiría que cada implementación se desvíe
del contrato real de ASP.NET.

El generador debe producir una salida reproducible, utilizable en navegador y
React Native, y no puede convertir al VPS privado ni a Tailscale en dependencias
del desarrollo local o de CI. La lógica sensible al runtime —URL base,
autenticación, cancelación y errores— también necesita una frontera pequeña y
auditable que no dependa de un framework de UI.

## Decisión

- `packages/api-client` es un paquete npm privado e independiente, consumido por
  las tres aplicaciones como `@elevant/api-client`.
- Orval `8.27.0` queda fijado exactamente en `devDependencies` y en el lockfile.
  La generación y CI usan Node.js 24 y npm; no dependen del antiguo workspace
  pnpm del prototipo.
- `openapi/elevant-v1.json` es el snapshot canónico, versionado y revisable del
  contrato. Se obtiene del host API compilado que se propone versionar; CI exige
  después que `/swagger/v1/swagger.json` en la imagen exacta del commit coincida.
  Nunca se descarga del endpoint privado del VPS durante CI.
- `openapi/source.json` describe el contrato con una versión de esquema, la ruta
  Swagger y la huella SHA-256 canónica del snapshot, sin credenciales. La
  procedencia de una release concreta vive en sus manifiestos OCI inmutables,
  según la enmienda de [ADR-0014](0014-bind-api-releases-to-openapi-fingerprint.md).
- Orval transforma ese snapshot en `generated`. Tanto el snapshot como la salida
  generada se versionan para que un pull request muestre el cambio contractual.
  `generated` es solo salida y no se edita manualmente.
- Una capa manual y pequeña basada en `fetch`, fuera de `generated`, adapta la URL
  base, un callback opcional que entrega el token vigente, un `fetch` inyectable,
  `AbortSignal` y Problem Details. No mantiene tokens ni configuración global, no
  registra credenciales y no introduce dependencias de React, Next.js o Expo.
- Cada petición recibe explícitamente su contexto. Los consumidores siguen siendo
  dueños del almacenamiento de sesión, la navegación, los reintentos y la
  presentación de errores.
- El paquete no añade dependencias npm de runtime y conserva una API pública
  deliberada; detalles internos de Orval no se importan desde las aplicaciones.
- El workflow activo del paquete instala con `npm ci`, reconstruye la API del
  commit de forma aislada para detectar deriva entre código y snapshot, y ejecuta
  el check determinista completo. No accede al VPS, GHCR privado ni a Tailscale.

## Flujo del contrato

1. El cambio del backend define `operationId`, respuestas, tipos de contenido y
   schemas estables, y actualiza sus pruebas.
2. El documento aprobado se copia a `openapi/elevant-v1.json` y su huella
   canónica se registra en `openapi/source.json` antes de publicar.
3. Se regenera `generated` y se revisan juntos el diff del snapshot y de la salida.
4. CI reproduce la generación, certifica la imagen exacta y falla ante archivos
   desactualizados o deriva entre snapshot, Swagger servido y huella del bundle.
5. Private Web, Public Web y Mobile Agent actualizan sus adaptadores cuando vayan
   reemplazando mocks. No se requiere migrar los tres prototipos en un único PR.

## Compatibilidad

La API y sus clientes se despliegan de forma independiente. Por defecto, los
cambios son aditivos: rutas nuevas y propiedades de respuesta opcionales. Eliminar
o renombrar operaciones/campos, volver obligatorio algo antes opcional, restringir
valores aceptados o cambiar su semántica exige una versión nueva o un rollout
coordinado API-first con una ventana de compatibilidad.

## Consecuencias

- El contrato HTTP queda separado de entidades EF, modelos de interfaz y datos de
  los prototipos.
- Los diffs generados aumentan el tamaño de algunos pull requests, pero permiten
  revisar y reproducir exactamente lo que compilarán los consumidores.
- Actualizar Orval o Node requiere un PR explícito que regenere, pruebe y documente
  su salida.
- La capa manual debe permanecer pequeña; reglas de producto y estado de UI no
  pertenecen al paquete.

## Alternativas consideradas

- **Kiota:** buena generación fuertemente tipada, con una abstracción de runtime
  más amplia de la necesaria para los tres clientes actuales.
- **NSwag:** cercano al ecosistema .NET, pero menos directo para una salida npm
  compartida entre navegador y Expo.
- **Cliente completamente manual:** sencillo al inicio, pero duplicaría tipos y
  facilitaría la deriva respecto de OpenAPI.
- **Compartir tipos de C#:** rechazado porque no representa serialización,
  respuestas ni semántica del contrato HTTP.
