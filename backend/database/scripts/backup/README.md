# Backup Development

`backup-development.sql` genera un full backup nativo de `ElevantDevelopmentDb` con `COPY_ONLY`, `INIT`, `CHECKSUM` y `COMPRESSION`. El wrapper verifica la copia con una identidad DBA y solo entonces elimina copias que excedan la retención de siete.

Los `.bak` viven en el volumen externo `elevant-dev-sql-backups`, nunca en Git ni en el volumen primario. Una tarea nocturna se configura en Dokploy después del primer despliegue. Sin copia cifrada off-host, la pérdida del VPS implica reconstrucción por migraciones + seed y solo se permiten datos sintéticos.
