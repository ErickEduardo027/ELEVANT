# Solicitud comercial, contrato y gobernanza

Este recorrido está integrado en `Development` por el merge #114. La integración en el repositorio no demuestra una publicación ni una aceptación operativa en el VPS. La API y la base compartida siguen siendo la autoridad para los tres clientes.

El acceso heredado a `/login?mode=register` redirige al formulario canónico `/solicitar-acceso`; no debe abrir una segunda alta con contraseña. Si una edición del catálogo o una verificación de aerolínea se confirmó en la API pero falla el aviso SignalR, la respuesta conserva el resultado persistido. El Public Web relee el catálogo por HTTP al reconectar y cada 25 segundos como respaldo; el aviso en vivo no es la fuente de verdad.

## Recorrido

1. Desde el botón **Solicitar acceso** de la landing, la aerolínea abre `/solicitar-acceso`. Selecciona uno o varios servicios publicados en el carrusel. Contratos controla nombre, descripción, imagen, video, orden y visibilidad de cada servicio en **Servicios**. La solicitud conserva una copia del nombre y unidad elegidos aunque el catálogo cambie después.
   La API vuelve a comprobar que cada servicio siga activo y publicado al recibir el POST. Conocer el UUID de un servicio interno no permite incluirlo en una solicitud pública.
2. El cliente selecciona una aerolínea predefinida. Los campos de identidad y el logo son de solo lectura. La lista inicial conserva únicamente nombres de la referencia histórica de AVIAM; razón social, país, IATA, ICAO y logo aparecen pendientes hasta que Contratos los verifique con una fuente HTTPS. Un nombre en esa lista no acredita identidad legal.
3. El representante indica nombre, cargo, correo, teléfono y declara su autoridad. El navegador envía un UUID estable con los servicios y la aerolínea. Repetir el mismo cuerpo y UUID devuelve la misma referencia; reutilizarlo con otros datos da conflicto. El formulario público nunca recibe ni elige una contraseña.
4. **Contratos → Solicitudes** recibe un aviso interno y revisa la petición. La aprobación exige identidad legal verificada y estaciones activas; crea aerolínea canónica, contrato y versión en borrador con los servicios seleccionados. El rechazo exige motivo. Ninguna de las dos decisiones emite credenciales automáticamente.
5. **Superadministrador → Inicio** recibe la tarea de acceso aprobada. Introduce un correo y una contraseña temporal que cumple la política de Identity. La cuenta queda vinculada a la aerolínea y obliga a cambiar la contraseña antes de emitir un JWT. El operador entrega las credenciales por un canal manual autorizado; no se envían correos desde ELEVANT.
6. La aerolínea entra en el portal, consulta la propuesta y envía observaciones. Contratos ajusta condiciones, vigencia, moneda y tarifas en **Borradores**. La activación exige cuenta creada, términos, servicios y estaciones; solo entonces el contrato aparece como aprobado y activo para el portal y la cobertura operativa.

## Roles y avisos

El login interno admite `SUPERADMIN` en `/superadmin`, con **Inicio**, **Usuarios** y **Configuración**. Usuarios administra cuentas, contraseñas temporales y roles personalizados. Un rol personalizado puede recibir lectura o lectura/escritura de catálogo y solicitudes comerciales; el espacio de trabajo muestra solo los módulos otorgados. El API comprueba permisos vigentes en cada operación. Los roles base y el último superadministrador activo están protegidos. Configuración muestra política de acceso y auditoría reciente.

Las modificaciones del catálogo, las solicitudes, la provisión, los comentarios y los borradores crean avisos internos por destinatario en el outbox y feed recuperable. SignalR anuncia cambios; los clientes vuelven a leer REST con autorización vigente. El catálogo público usa un hub sin datos de solicitud y una nueva lectura HTTP al recibir el aviso. No hay notificaciones por correo. Una instalación de varios nodos requiere certificar transporte compartido de SignalR antes de prometer latencia entre nodos.

## Datos y despliegue

Las migraciones `PublicCommercialIntake`, `CommercialGovernance`, `CommercialProvisioning` y `ContractDraftConversation` son aditivas y no incluyen DML de negocio. El seed sintético de Development carga siete servicios de rampa con fotos existentes, los nombres históricos de aerolíneas y, cuando se suministra `ELEVANT_DEV_SUPERADMIN_ACCOUNT_PASSWORD`, la cuenta `super.admin@dev.elevant.test`. Ese valor es un secreto de despliegue, nunca parte del repositorio. La ejecución del seed conserva claves existentes y no crea una cuenta en un ambiente remoto por el solo hecho de integrar esta rama.

Los logos, datos legales y videos reales requieren validación y publicación por Contratos. La lista histórica y las fotos de presentación no autorizan copiar credenciales ni datos personales del prototipo B2B. El esquema y los endpoints son para Development; Production conserva su frontera vacía hasta una aprobación separada.

Fuentes: [API compartida](../../backend/README.md), [migraciones](../database/migrations.md), [cliente público](../../frontend/public-web/README.md), [cliente interno](../../frontend/private-web/README.md) y [contrato OpenAPI](../../packages/api-client/README.md).
