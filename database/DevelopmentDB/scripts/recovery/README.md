# Verificación de recuperación Development

`restore-check-development.sql` hace `VERIFYONLY`, restaura la copia más reciente en `ElevantDevelopmentRestoreCheck`, valida que su marcador sea Development, ejecuta `DBCC CHECKDB` y elimina esa base temporal en éxito o error.

El servicio Compose está detrás del profile `operations` y se programa semanalmente. No sustituye un procedimiento de recuperación real: para promover un restore se detienen escrituras, se preserva la base actual, se restaura con otro nombre, se valida y recién entonces se cambia la cadena de la aplicación.

Nunca restaure Production en Development ni ejecute este script con un nombre de base modificable.
