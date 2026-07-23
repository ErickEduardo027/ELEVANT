# Documentación de Elevant

La documentación se mantiene junto al código y describe decisiones técnicas, operación y formas de trabajo. Cuando el comportamiento del sistema cambie, el mismo pull request debe actualizar la guía afectada.

## Índice

- `architecture`: límites, dependencias, monolito modular, vertical slices, tiempo real e integraciones.
- `workflows`: desarrollo local, Git, pull requests y flujos por plataforma.
- `api`: convenciones HTTP, versionado, errores, OpenAPI y SignalR.
- `database`: propiedad de datos y migraciones; los artefactos operativos viven en
  `backend/database` y respaldo/recuperación en `backend/infrastructure/backups`.
- `deployment`: ambientes, Docker, Dokploy, KVM 2 y rollback.
- `security`: línea base, secretos y respuesta a incidentes.
- `onboarding`: recorridos iniciales por rol.
- `adr`: registro de decisiones de arquitectura.

## Convenciones

- El código y los identificadores técnicos pueden estar en inglés; las guías operativas se escriben en español claro.
- `Accepted` identifica una decisión vigente; `Proposed`, una opción todavía no autorizada.
- Nunca se incluyen secretos, datos personales, capturas de Production ni archivos extraídos de documentación privada.
- Los ejemplos usan dominios, identificadores y valores ficticios.
- Los comandos se ejecutan desde la raíz del repositorio salvo indicación contraria.

Si una guía contradice una prueba automatizada o el código desplegado, se detiene la operación de riesgo, se verifica la fuente de verdad y se corrige la discrepancia en un cambio revisado.
