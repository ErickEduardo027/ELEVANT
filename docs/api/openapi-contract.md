# Contrato OpenAPI

La API publica `/swagger/v1/swagger.json` mediante Swashbuckle. Ese documento es
el contrato oficial entre el backend y Private Web, Public Web y Mobile Agent;
los modelos EF, tipos de interfaz y fixtures de los prototipos no lo sustituyen.

## Requisitos del documento

Cada operación pública debe declarar:

- una ruta y versión explícitas;
- un `operationId` único y estable;
- schemas de request cuando aplique, respuesta y Problem Details relevantes;
- códigos de éxito y error relevantes con su tipo de contenido exacto;
- nulabilidad y miembros `required` coherentes con la serialización real;
- comentarios útiles sin detalles internos, secretos ni datos personales.

El esquema Bearer describe la autenticación JWT ya activa. La operación
`CreateSession` (`POST /api/v1/auth/session`) y el ping son anónimos;
`GetCurrentSession` (`GET` sobre la misma ruta) declara Bearer. El host aplica
además una política fallback autenticada a controllers y hubs sin una excepción
anónima; los health checks declaran esa excepción y los hubs, que no forman parte
de OpenAPI, requieren Bearer. El documento no incluye tokens ni ejemplos de
credenciales.

Además de creación y consulta de sesión, el contrato publica dos operaciones
de negocio autenticadas y de solo lectura para OCC:

- `GetOccPlanningSnapshot` (`GET /api/v1/occ/planning`) proyecta las escalas de
  una estación y fecha operativa;
- `GetOccPlanningOptions` (`GET /api/v1/occ/planning/options`) proyecta el
  catálogo de servicios del contrato aplicable y la elegibilidad de agentes
  para una escala concreta.

Ambas vuelven a resolver el actor en SQL y exigen simultáneamente el rol
`ADMIN_OCC` del portal `BackOffice`, una membresía interna activa en una
organización AVIAM y el scope de estación correspondiente. La persistencia
aplica el scope antes de materializar los recursos. Una estación o escala fuera
del scope responde igual que un recurso inexistente, sin revelar su existencia.
Si más de una versión contractual activa y aprobada resulta aplicable a la
misma aerolínea, estación y fecha, las opciones fallan cerrado con `409` en vez
de escoger una de forma implícita.

Este incremento no implica refresh, logout, revocación de `jti`, creación de
escalas, asignación de agentes, ejecución mobile ni otra escritura de negocio.

## Snapshot canónico para TypeScript

`packages/api-client/openapi/elevant-v1.json` es la entrada versionada de Orval.
Se captura del host API compilado que se propone versionar y debe coincidir con
`/swagger/v1/swagger.json` en la imagen exacta que CI certifica para el commit.
No se acepta copiar un Swagger de origen desconocido, de una imagen flotante o
de una instancia cuyo contrato no pueda demostrarse.
`packages/api-client/openapi/source.json` es un descriptor cerrado con versión,
ruta Swagger y la huella SHA-256 canónica del snapshot; no contiene credenciales,
una URL privada ni datos de una ejecución futura. Commit, run e imagen por digest
pertenecen al manifiesto inmutable de cada release.

El proceso de actualización es:

1. implementar y probar el cambio en la API;
2. actualizar el snapshot revisado y registrar su huella canónica en
   `source.json`;
3. construir y certificar la imagen inmutable del commit, exigiendo que su
   Swagger coincida con el snapshot y la huella;
4. ejecutar la generación y el check completo de `packages/api-client`;
5. revisar el diff del snapshot y de `generated` antes de fusionar.

CI no consulta el Swagger privado de Development. Reconstruye el host del commit,
lo inicia localmente en `Testing` con Swagger habilitado y compara los documentos
como JSON, ignorando únicamente el orden de claves de objetos. Después verifica
que la salida generada corresponda exactamente al snapshot comprometido.

### Gate de publicación Development

`Backend CI` ejecuta esa comparación dentro de `build-and-test`, usando la API
que acaba de compilar y antes de certificar su imagen. El job
`publish-api-image` depende explícitamente del éxito completo de
`build-and-test`; por tanto, cualquier drift entre el Swagger real y el snapshot
canónico bloquea la publicación de la imagen API, el bundle de entrega y el
movimiento final de `development-certified`.

El bundle API lleva además la etiqueta inmutable
`io.elevant.api-release.openapi-sha256`. Web CI exige que esa etiqueta, el
descriptor y el snapshot coincidan antes de certificar un cliente. La forma
canónica ordena recursivamente las claves de objetos, conserva el orden de los
arrays y serializa sin espacios antes de aplicar SHA-256 a los bytes UTF-8. Un
entero fuera del rango seguro de JavaScript falla cerrado para evitar colisiones
por pérdida de precisión.

`API Client CI` repite la comprobación como una defensa independiente para el
paquete TypeScript y sus consumidores. El gate que impide publicar el backend
vive dentro de `Backend CI` y no depende de que otro workflow termine primero.

La identidad del contrato y la procedencia de la release son conceptos
separados. Esta frontera evita un commit posterior dedicado únicamente a anotar
la imagen que el commit anterior todavía no podía haber producido. Véase
[ADR-0014](../adr/0014-bind-api-releases-to-openapi-fingerprint.md).

## Compatibilidad y orden de despliegue

Son normalmente compatibles las rutas nuevas y las propiedades opcionales de
respuesta. Pueden romper consumidores:

- eliminar o renombrar una ruta, operación, campo o valor existente;
- volver requerido un campo antes opcional o cambiar su nulabilidad;
- restringir entradas antes válidas;
- cambiar código de estado, tipo de contenido, formato o semántica;
- reutilizar un `operationId` para otro comportamiento.

Un cambio incompatible requiere versionar el endpoint o acordar una migración con
ventana de compatibilidad. La versión compatible de la API se publica primero;
luego se actualizan los clientes, que se despliegan de manera independiente, y al
final se retira el contrato anterior.

## Disponibilidad

Swagger UI y el JSON están habilitados en Development y pueden activarse en
Testing para certificación y CI. Production no los expone. La disponibilidad del
Swagger de Development a través de Tailscale es una comodidad operativa, no una
fuente para builds reproducibles.

`packages/api-client/generated` nunca se edita manualmente. La URL de cada entorno
y los tokens tampoco se hornean en OpenAPI ni en el código generado.
