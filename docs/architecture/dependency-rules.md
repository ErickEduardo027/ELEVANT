# Reglas de dependencia

## Dependencias de código

| Proyecto | Puede depender de | No puede depender de |
| --- | --- | --- |
| Domain | BCL y abstracciones neutrales indispensables | Application, Contracts, Infrastructure, Api, EF Core, ASP.NET |
| Application | Domain | Infrastructure, Api, detalles HTTP o SQL |
| Contracts | BCL y tipos públicos mínimos | Domain, Application, Infrastructure, Api |
| Infrastructure | Application, Domain | Api y Contracts salvo una decisión revisada |
| Persistence | Domain | Application, Infrastructure, Api y Contracts |
| DatabaseTool | Persistence | Api y clientes web/móvil |
| Api | Application, Contracts, Infrastructure, Persistence | clientes web/móvil |

El composition root de Api registra Infrastructure y Persistence. EF Core,
Identity y las migraciones pertenecen a Persistence, físicamente bajo
`database/DevelopmentDB`; Infrastructure reserva adaptadores externos no
persistentes. Que Api los referencie para composición no habilita a los
controllers a usar directamente el `DbContext` o clientes externos.

## Dependencias de datos

- Los clientes solo dependen del contrato HTTP y de mensajes SignalR documentados.
- Los contratos HTTP no dependen de la forma de las tablas.
- Las integraciones se adaptan a modelos internos neutrales.
- Una migración pertenece al mismo ensamblado que la persistencia del backend.

## Aplicación

Las pruebas de arquitectura verifican referencias de proyecto y ciclos. La revisión de código complementa lo que el compilador no detecta: filtración de entidades, uso de datos privados de otro módulo, acoplamiento por strings y lógica de negocio en endpoints.
