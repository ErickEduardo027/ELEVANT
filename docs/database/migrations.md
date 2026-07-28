# Migraciones de base de datos

Las migraciones de EF Core residen en Elevant.Infrastructure y se crean con la herramienta local fijada por el repositorio. La API no ejecuta `Database.Migrate()` al arrancar.

`ElevantDevelopmentDb` y la futura `ElevantProductionDb` aplican la misma secuencia de migraciones para conservar el esquema. Sus datos, credenciales, instancias y volúmenes permanecen separados.

## Crear una migración

1. Confirmar que el cambio de modelo corresponde a un requisito aprobado.
2. Configurar una conexión local desechable mediante variable de ambiente.
3. Ejecutar `backend/scripts/add-migration.ps1` con un nombre descriptivo.
4. Revisar archivos generados y SQL resultante.
5. Probar avance en una base limpia y en una base con el esquema anterior.
6. Añadir pruebas y documentar compatibilidad/rollback.

## Aplicar una migración

Usar `backend/scripts/update-database.ps1` indicando el ambiente. Production requiere el switch y la confirmación textual definidos por el script. Una aprobación de pull request no sustituye la autorización operativa de aplicar el esquema.

## Despliegue compatible

Para cambios destructivos aplicar expand/contract:

1. agregar estructuras compatibles;
2. desplegar código que lea/escriba ambas formas si hace falta;
3. migrar datos y verificar;
4. retirar el uso antiguo;
5. eliminar la estructura en una liberación posterior.

Los scripts no muestran cadenas de conexión. Ante fallo, detener, preservar evidencia segura y seguir el plan de recuperación; no editar manualmente la tabla de historial salvo procedimiento aprobado.
