# Contrato OpenAPI

La API publica `/swagger/v1/swagger.json` mediante Swashbuckle. Ese documento es
el contrato oficial entre el backend y Private Web, Public Web y Mobile Agent;
los modelos EF, tipos de interfaz y fixtures de los prototipos no lo sustituyen.

## Requisitos del documento

Cada operación pública debe declarar:

- una ruta y versión explícitas;
- un `operationId` único y estable;
- schemas de request, respuesta y Problem Details;
- códigos de éxito y error relevantes con su tipo de contenido exacto;
- nulabilidad y miembros `required` coherentes con la serialización real;
- comentarios útiles sin detalles internos, secretos ni datos personales.

El documento mantiene el esquema Bearer para autenticación. La presencia del
esquema no autoriza a incluir tokens ni ejemplos de credenciales.

## Snapshot canónico para TypeScript

`packages/api-client/openapi/elevant-v1.json` es la entrada versionada de Orval.
Debe proceder de `/swagger/v1/swagger.json` en la imagen API exacta certificada
para el mismo commit. No se acepta copiar un Swagger de origen desconocido, de
una imagen flotante o de una instancia cuyo commit no pueda demostrarse.
`packages/api-client/openapi/source.json` conserva esa procedencia —commit e
imagen por digest— y no contiene credenciales ni una URL privada operativa.

El proceso de actualización es:

1. implementar y probar el cambio en la API;
2. construir y certificar la imagen inmutable del commit;
3. ejecutar esa imagen de forma controlada, copiar su JSON al snapshot y registrar
   la procedencia en `source.json`;
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

`API Client CI` repite la comprobación como una defensa independiente para el
paquete TypeScript y sus consumidores. El gate que impide publicar el backend
vive dentro de `Backend CI` y no depende de que otro workflow termine primero.

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
