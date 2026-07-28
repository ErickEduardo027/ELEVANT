# Base de datos

Este directorio reserva material operativo, semillas y scripts SQL excepcionales. La API es la única propietaria de SQL Server; web, móvil y procesos externos no acceden directamente a la base.

Las migraciones de Entity Framework pertenecen al proyecto Infrastructure del backend, junto al `DbContext`. No se duplican aquí y no se ejecutan automáticamente al iniciar la API o un contenedor.

## Reglas

- No versionar archivos `.bak`, `.mdf`, `.ldf`, volcados, exportaciones ni datos de Production.
- No guardar cadenas de conexión, contraseñas o tokens en scripts.
- Toda modificación de esquema normal debe ser una migración EF revisable.
- Un script SQL manual requiere objetivo, ambiente, precondiciones, consulta de verificación y estrategia de reversión.
- Development y Production comparten el esquema mediante migraciones revisadas, pero usan instancias, bases, usuarios, datos, volúmenes y copias independientes. Las bases activas viven en volúmenes de SQL Server, no en este directorio.
- SSMS es una herramienta de administración, no una dependencia de la aplicación.

Consulte `docs/database/migrations.md` para migraciones y
`backend/infrastructure/backups/README.md` para respaldo y restauración.
