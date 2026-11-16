# Bases de datos de ELEVANT

La API compartida utiliza una base lógica por ambiente. Este directorio separa claramente lo que hoy es ejecutable en Development del límite futuro de Production:

- `DevelopmentDB/`: proyecto EF Core, migraciones, herramienta one-shot, Compose, scripts SQL, backup, restore-check y certificación.
- `ProductionDB/`: reservado y vacío salvo `.gitkeep`; no existe todavía un despliegue Production autorizado.

Los clientes web y móvil nunca acceden directamente a SQL Server. Los cambios de esquema nacen como migraciones revisadas en DevelopmentDB. Una futura promoción a Production deberá aplicar únicamente el esquema aprobado, con confirmación explícita y sin copiar fixtures ni datos sintéticos.
