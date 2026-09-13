# Proceso para solicitar cambios de API

Una necesidad de web o móvil comienza con el resultado de usuario, no con un endpoint prediseñado.

```text
El cliente afectado define la necesidad
                ↓
Backend y consumidor revisan el contrato REST
                ↓
Backend implementa; CI valida el commit
                ↓
Tras merge y gates verdes, el carril aplicable publica; el controlador evalúa
                ↓
El equipo verifica aceptación y el cliente integra el endpoint
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

Se implementan pruebas y se actualiza OpenAPI. Tras una revisión de
compatibilidad se regenera el cliente compartido. Una API nueva no está
disponible solo porque un PR se pueda fusionar: el CI de PR, la publicación
posterior al merge y la promoción privada son pasos distintos. Web integra
contra Development cuando el endpoint exista y esté aceptado. Mobile Agent
todavía usa adaptadores de negocio del prototipo; su integración real se hará
por contrato OpenAPI en un cambio posterior. La versión anterior se retira
únicamente cuando no haya consumidores activos o exista una migración
acordada. Véanse [entrega](../../Vault/07-entrega/README.md) y
[estado Mobile](../../Vault/05-aplicaciones/mobile-agent.md).

Una solicitud urgente no autoriza exponer SQL Server, compartir una clave o agregar campos sensibles sin revisión.
