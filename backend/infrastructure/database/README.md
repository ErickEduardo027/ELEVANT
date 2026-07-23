# SQL Server

La API es la única propietaria y consumidora directa de SQL Server. Web, móvil, jobs externos y herramientas de analítica deben usar contratos de la API o una integración aprobada; nunca credenciales de la base.

- Motor objetivo: SQL Server 2022, nivel de compatibilidad `160`.
- Local: el puerto `1433` se liga a `127.0.0.1` para SSMS u otras herramientas del desarrollador.
- Testing y Production: no existe publicación de puerto; el acceso ocurre únicamente por la red interna del stack.
- El arranque de la API no crea ni migra la base.
- Las migraciones viven en `backend/src/Elevant.Infrastructure` y se operan con los scripts controlados de `backend/scripts`.

SSMS es una herramienta externa, no una dependencia de la solución. Un acceso administrativo temporal debe usar túnel o canal privado auditado, nunca una regla permanente que exponga SQL a Internet.
