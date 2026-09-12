---
id: plantillas-indice
title: "Plantillas del Vault"
type: index
area: governance
status: verified
maturity: stable
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "300f0be1dcd5a27b7cf5d432c577e78a6b9a7b43"
sources:
  - Vault/08-gobernanza/metadatos.md
  - Vault/08-gobernanza/fuentes-y-evidencia.md
tags:
  - plantillas
  - gobernanza
  - autoria
---

# Plantillas del Vault

Elige la plantilla más específica. Cada archivo es una nota válida para que el checker pueda auditarlo y puede duplicarse con la función nativa **Templates** de Obsidian.

| Plantilla | Úsala para |
| --- | --- |
| [Página](pagina.md) | Guía, concepto, arquitectura, referencia, historia o índice nuevo |
| [ADR](adr.md) | Decisión con contexto, alternativas y consecuencias |
| [Runbook](runbook.md) | Operación manual reproducible, con gates y rollback |
| [Capacidad](capacidad.md) | Trazabilidad de extremo a extremo desde usuario hasta datos y entrega |
| [Incidente](incidente.md) | Registro saneado, cronología, causa y acciones correctivas |

## Al duplicar una plantilla

1. Cambia `id` por un valor único y estable.
2. Cambia `title`, `type` y `area`.
3. Empieza con `status: draft` salvo que ya exista una verificación integral.
4. Usa `evidence: unknown` o `planned` hasta reunir evidencia.
5. Reemplaza fecha, SHA completo y `sources`.
6. Elimina instrucciones entre comentarios y secciones que no apliquen.
7. Enlaza la nota desde su mapa de contenido; no dejes páginas huérfanas.
8. Ejecuta el checker del Vault antes del PR.

No copies una plantilla y conserves su frontmatter original: duplicaría identidad y atribuiría evidencia falsa.

Consulta [Metadatos](../08-gobernanza/metadatos.md), [Evidencia](../08-gobernanza/fuentes-y-evidencia.md) y [Mantenimiento](../08-gobernanza/mantenimiento-del-vault.md).
