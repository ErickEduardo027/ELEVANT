# Visión del sistema

Elevant es una plataforma con clientes web y móvil respaldados por una API .NET. El repositorio inicial establece límites técnicos y operación segura sin asumir entidades o funcionalidades de negocio que todavía no estén especificadas.

## Mapa de contexto

- La aplicación web atiende flujos de consulta y administración futuros.
- Mobile Agent atiende trabajo operativo en tablet y debe tolerar conectividad intermitente.
- La API ASP.NET Core es la única puerta de entrada a reglas, datos e integraciones.
- SQL Server 2022 persiste el estado que pertenece a Elevant.
- FlightAware es un sistema externo futuro, accesible solo a través de Infrastructure.
- Dokploy desplegará contenedores en ambientes separados cuando exista infraestructura configurada.

## Protocolos

Los clientes usan REST sobre HTTPS para consultar y modificar el estado. SignalR entrega indicaciones en tiempo real, pero después de una reconexión o evento relevante el cliente confirma el estado mediante REST. SQL Server no se publica en Internet y las credenciales de proveedores nunca llegan a un cliente.

## Estado del scaffold

El backend es una unidad autónoma bajo `backend/`, organizada con Clean Architecture,
y expone infraestructura técnica mínima como ping y health checks. Las aplicaciones
cliente son estructuras documentales sin framework. La base no contiene migración
inicial y FlightAware no tiene una implementación funcional registrada. Esta
ausencia es deliberada: evita convertir supuestos en contratos.

## Calidad crítica

- separación de Development y Production;
- operaciones de esquema explícitas y reversibles;
- contratos públicos versionados;
- secretos fuera de Git e imágenes;
- logs y errores sin detalles sensibles;
- compatibilidad con despliegue en contenedores y clientes móviles intermitentes.
