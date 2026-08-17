# Seed Development

El seed ejecutable vive en `src/Elevant.Infrastructure/Persistence/Seed` y lo invoca `Elevant.DatabaseTool`. Esta carpeta no contiene dumps JSON/SQL alternativos.

Fixtures permitidos: catálogos y escenarios completamente sintéticos, deterministas, revisables e idempotentes. Las identidades usan dominios `.test`. Nunca copiar datos, contraseñas, vuelos, documentos o evidencia del prototipo/Production.

Production no tiene seed. Agregar `HasData` o DML de negocio a una migración viola esta política.
