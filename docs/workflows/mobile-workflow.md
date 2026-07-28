# Flujo de desarrollo móvil

La aplicación móvil se inicializará con Expo cuando se confirme la primera feature. El desarrollo debe considerar desde el inicio dispositivo físico, conectividad intermitente y actualización de APK.

1. Definir el flujo online y qué parte funcionará offline.
2. Diseñar idempotencia servidor-cliente antes de crear la outbox.
3. Consumir contratos mediante `packages/api-client`.
4. Encapsular cámara, almacenamiento seguro y conectividad detrás de adaptadores.
5. Probar permisos rechazados, falta de espacio, reconexión, duplicados y cierre de la aplicación.
6. Validar en una tablet representativa, no solo en navegador o emulador.
7. Generar builds de Development con identificadores y endpoints separados de Production.

Las claves de firma y tokens se custodian fuera del repositorio. Una evidencia no se elimina localmente hasta recibir confirmación persistente, y tampoco se conserva indefinidamente sin una política aprobada.
