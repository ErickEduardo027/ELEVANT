# Documentación ELEVANT

La documentación vive con el código. Cuando cambia un contrato técnico u operativo, el mismo PR actualiza la guía correspondiente.

Para orientarse por pregunta, evidencia y estado, usar el [Vault ELEVANT](../Vault/README.md). El [índice de fuentes](../Vault/11-referencia/README.md) enlaza contratos ejecutables y la [reconciliación documental](../Vault/11-referencia/reconciliacion-docs.md) explica discrepancias históricas corregidas. Una guía de `docs/` no sustituye al código, migraciones, OpenAPI o workflow vigente.

## Lectura inicial

1. `AGENTS.md` raíz y el más cercano al árbol que se modificará.
2. `architecture/system-overview.md` y `architecture/database-v1.md`.
3. `database/schema-v1.md` para el inventario persistente.
4. `database/migrations.md` antes de tocar EF Core.
5. `deployment/dokploy.md` para la arquitectura y `deployment/dokploy-configuration.md` para ejecutar el bootstrap manual.

## Índice

- `architecture`: límites, dependencias, monolito modular, modelo v1 e integraciones.
- `database`: propiedad, inventario y migraciones. Los ejecutables de Development están en `database/DevelopmentDB`.
- `deployment`: ambientes, Dokploy, capacidad del KVM y rollback; los controles
  operativos todavía diferidos se registran en
  [`development-hardening-backlog.md`](deployment/development-hardening-backlog.md).
- `api`: HTTP, errores, OpenAPI y consumidores.
- `workflows`: Git, desarrollo local y flujos por plataforma.
- `security`: acceso SQL, secretos y línea base.
- `onboarding`: recorridos por rol.
- `adr`: decisiones aceptadas/propuestas.
- `superpowers/plans`: planes históricos; conservar para contexto, no ejecutar como contrato vigente.

Las brechas funcionales y operativas todavía abiertas se consultan en el [Backlog transversal](../Vault/12-backlog/README.md). En particular, la entrega APK del Mobile Agent, Production y las alertas externas no se vuelven capacidades actuales porque estén documentadas.

## Convenciones

- Identificadores técnicos en inglés; operación en español claro.
- `Accepted` significa vigente; `Proposed`, pendiente de autorización.
- Ejemplos usan valores ficticios y dominios `.test`/placeholders.
- Nunca incluir secretos, PII, capturas/dumps/backups de Production o datos extraídos del prototipo.
- Los comandos parten de la raíz salvo indicación.
- Código/migración/prueba ejecutable prevalece si una guía quedó desactualizada; detenga la operación de riesgo y corrija la discrepancia.
