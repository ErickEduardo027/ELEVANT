# Guía para consumidores de la API

## URL y versión

La URL base llega desde configuración pública del cliente. Los endpoints de negocio se consumen bajo `/api/v1`; el cliente no concatena hosts codificados en fuente. Development usa `https://api-dev.elevant.com`.

## Solicitudes

- Enviar JSON y aceptar JSON cuando el endpoint lo indique.
- Propagar cancelación al abandonar una pantalla o flujo.
- No reintentar automáticamente comandos salvo que el contrato sea idempotente.
- Usar claves de idempotencia cuando un endpoint las defina.
- Evitar registrar bodies, tokens o URLs con parámetros sensibles.

## Respuestas y errores

Tratar todos los códigos documentados. Los errores usan Problem Details o Validation Problem Details; la interfaz muestra un mensaje seguro y puede conservar un identificador de correlación para soporte. No basar lógica en el texto humano de `detail`.

## Salud y tiempo real

`/health` y `/health/ready` son para plataforma y diagnóstico, no para sondeo frecuente desde cada cliente. SignalR avisa cambios; ante reconexión el cliente consulta REST.

## Compatibilidad

Regenerar el cliente al cambiar OpenAPI y revisar el diff. Los consumidores ignoran campos JSON desconocidos y no asumen el orden de propiedades. Un campo requerido nuevo o cambio de significado necesita versión o una estrategia compatible.
