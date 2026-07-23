# ADR-0006: Separar Testing y Production

## Estado

Accepted — 2026-07-18.

## Contexto

Compartir infraestructura entre pruebas y operación puede exponer datos reales, consumir cuota, aplicar migraciones no validadas o borrar archivos. Cambiar solo el nombre del ambiente no crea aislamiento si persisten la misma base, usuarios, volúmenes o claves.

## Decisión

Testing y Production tendrán servicios, bases, usuarios, secretos, redes, volúmenes, uploads, backups, dominios y claves externas independientes. Una imagen puede promoverse entre ambos, pero recibe configuración distinta. SQL Server no se publica a Internet y las migraciones se ejecutan explícitamente por ambiente.

Production no expone Swagger. Testing contiene solo datos sintéticos y no se alimenta restaurando backups productivos.

## Consecuencias

- Un experimento o migración de Testing no modifica datos reales.
- La promoción de un artefacto es reproducible sin reconstruirlo.
- Aumentan recursos y gestión de configuración, pero también trazabilidad y seguridad.
- Los fallos específicos de Production se investigan con telemetría segura o reproducciones sintéticas, no copiando datos.
- Backups y restauraciones deben probarse por ambiente.

## Alternativas consideradas

- Compartir SQL Server y usar bases distintas: ofrece cierto aislamiento, pero conserva un punto administrativo y de recursos común.
- Compartir una misma base con schemas o flags: rechazado por alto riesgo de cruce.
- Crear Testing bajo demanda con credenciales productivas: rechazado porque el aislamiento no es real.

