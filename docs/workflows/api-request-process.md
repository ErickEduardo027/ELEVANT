# Proceso para solicitar cambios de API

Una necesidad de web o móvil comienza con el resultado de usuario, no con un endpoint prediseñado.

```text
Laisha o Eliezer definen la necesidad
                ↓
Erick define el contrato REST
                ↓
Erick implementa y despliega en Development
                ↓
El equipo valida con Swagger, Postman o cliente HTTP
                ↓
Web o móvil integra el endpoint
```

## Solicitud

Documentar:

- actor y objetivo;
- datos mínimos de entrada y salida;
- estados vacío, pendiente y error;
- autorización y sensibilidad de los campos;
- volumen y frecuencia esperados;
- necesidad offline o de tiempo real;
- compatibilidad requerida con versiones instaladas.

## Diseño

Backend propone método, ruta versionada, códigos, Problem Details, paginación e idempotencia. Si el cambio depende de un proveedor, el contrato Elevant no copia ciegamente su DTO. Un reviewer de cliente confirma que el contrato permite representar todos los estados.

## Entrega

Se implementan pruebas y se actualiza OpenAPI. Tras una revisión de compatibilidad se regenera el cliente compartido. Web y móvil integran primero contra Development. La versión anterior se retira únicamente cuando no haya consumidores activos o exista una migración acordada.

Una solicitud urgente no autoriza exponer SQL Server, compartir una clave o agregar campos sensibles sin revisión.
