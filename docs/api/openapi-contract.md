# Contrato OpenAPI

La API genera un documento en `/swagger/v1/swagger.json` mediante Swashbuckle. Es
el contrato oficial entre backend, frontend web y aplicación móvil, además de la
entrada para el cliente TypeScript compartido. No sustituye reglas de producto que
requieran explicación adicional.

## Contenido esperado

- título `Elevant API` y versión clara;
- rutas y métodos versionados;
- schemas de request, response y Problem Details;
- códigos de éxito y error relevantes;
- comentarios XML útiles, sin detalles internos;
- esquema Bearer preparado para autenticación futura;
- ausencia de secretos, hosts privados y ejemplos con datos reales.

## Disponibilidad

Swagger UI y el documento se habilitan en Development. Testing puede habilitarlos mediante configuración para generar artefactos. Production no los expone. La generación para consumidores debe usar una fuente controlada y el commit exacto del backend.

## Cambios incompatibles

Eliminar o renombrar un campo, volverlo requerido, restringir valores existentes o cambiar semántica puede romper clientes aunque compile. El pull request debe comparar el documento anterior, coordinar consumidores y versionar cuando no sea posible mantener compatibilidad.

La carpeta `packages/api-client/openapi` recibe una copia reproducible cuando se defina el proceso. `generated` nunca se edita manualmente.
