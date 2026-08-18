# Datos de prueba

Las pruebas construyen sus datos sintéticos mediante builders/seeders en código. No se versionan copias de bases, dumps o backups.

Las pruebas SQL crean bases temporales con prefijo exacto `ElevantDbV1Test_`, migran y eliminan únicamente esos targets. Validan Production vacío, seed Development idempotente, preservación de filas existentes, rechazo por marcador y ausencia de DML de negocio en migraciones.
