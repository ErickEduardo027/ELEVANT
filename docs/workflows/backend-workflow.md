# Flujo de backend

1. Definir el caso de uso y sus límites, sin comenzar por una tabla o un controller.
2. Modelar reglas invariantes en Domain únicamente si el negocio las exige.
3. Crear el slice en Application con entrada, salida y puertos mínimos.
4. Implementar adaptadores en Infrastructure.
5. Publicar un contrato versionado en Contracts y traducirlo en Api.
6. Añadir pruebas unitarias, de integración y de arquitectura según el riesgo.
7. Actualizar OpenAPI y las guías operativas afectadas.

Si cambia el esquema, se genera la migración mediante la herramienta local fijada y el script del repositorio. Se inspecciona el SQL, se prueba en una base desechable y nunca se aplica a Production desde el arranque de la API.

Un endpoint nuevo debe aceptar cancelación, validar entrada, aplicar autorización cuando exista, producir Problem Details coherente y no registrar payloads sensibles.

