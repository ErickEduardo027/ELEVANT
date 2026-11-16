# ADR-0006: Separar Development y Production

## Estado

Accepted — 2026-07-18.

## Contexto

Compartir infraestructura entre pruebas y operación puede exponer datos reales, consumir cuota, aplicar migraciones no validadas o borrar archivos. Cambiar solo el nombre del ambiente no crea aislamiento si persisten la misma base, usuarios, volúmenes o claves.

## Decisión

Development y Production tendrán servicios, bases, usuarios, secretos, redes, volúmenes, uploads, backups, dominios y claves externas independientes. Ambos aplican las mismas migraciones para conservar el esquema, pero nunca comparten datos. Al habilitar Production se promoverá una imagen versionada e inmutable con configuración distinta por ambiente. SQL Server no se publica a Internet y las migraciones se ejecutan explícitamente por ambiente.

Production no expone Swagger. Development contiene solo datos sintéticos y no se alimenta restaurando backups productivos.

## Consecuencias

- Un experimento o migración de Development no modifica datos reales.
- La promoción a Production deberá usar el artefacto validado sin reconstruirlo.
- Aumentan recursos y gestión de configuración, pero también trazabilidad y seguridad.
- Los fallos específicos de Production se investigan con telemetría segura o reproducciones sintéticas, no copiando datos.
- Backups y restauraciones deben probarse por ambiente.

## Alternativas consideradas

- Compartir SQL Server y usar bases distintas: ofrece cierto aislamiento, pero conserva un punto administrativo y de recursos común.
- Compartir una misma base con schemas o flags: rechazado por alto riesgo de cruce.
- Crear Development bajo demanda con credenciales productivas: rechazado porque el aislamiento no es real.
