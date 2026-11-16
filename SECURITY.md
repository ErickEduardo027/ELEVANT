# Política de seguridad

## Reporte de vulnerabilidades

Las vulnerabilidades deben comunicarse de forma privada a Erick o mediante una
advisory privada de GitHub. No publique detalles técnicos, credenciales ni pruebas
de explotación en Issues, Pull Requests o canales públicos.

## Reglas obligatorias

- Nunca subir claves de FlightAware, JWT, contraseñas, connection strings reales,
  tokens, certificados o archivos `.env`.
- No compartir credenciales entre Development y Production; deben rotarse después de
  una exposición o cambio de personal autorizado.
- SQL Server solo será accesible por Elevant API. El puerto 1433 no se publicará en
  Development ni Production.
- El acceso a Production, Dokploy, backups y secretos queda restringido a Erick y a
  personal expresamente autorizado.
- Web y móvil solo pueden incluir URLs y configuración pública; cualquier valor
  embebido en JavaScript o en una APK debe considerarse extraíble.
- Los backups deben cifrarse, probarse y almacenarse también fuera del mismo VPS.

Antes de cada Pull Request ejecute `scripts/repository/check-secrets.ps1` y revise
manualmente los cambios binarios y de configuración.
