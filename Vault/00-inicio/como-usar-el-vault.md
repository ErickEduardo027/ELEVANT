---
id: inicio-como-usar-vault
title: "Cómo usar el Vault"
type: guide
area: vault
status: documented
maturity: stable
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "pending"
sources:
  - AGENTS.md
  - docs/README.md
  - .obsidian/app.json
  - .obsidian/core-plugins.json
  - .obsidian/templates.json
  - scripts/vault/core.mjs
tags:
  - inicio
  - obsidian
  - github
  - contribucion
---

# Cómo usar el Vault

## Leer en GitHub

- Empieza en [Home](home.md).
- Usa los enlaces Markdown relativos; no necesitas software adicional.
- GitHub renderiza las tablas y los diagramas Mermaid incluidos en las notas.
- Usa la búsqueda del repositorio para conceptos técnicos exactos, nombres de módulos o mensajes de error.
- Si un enlace apunta al código o a `docs/`, esa fuente puede ser más autoritativa que el resumen del Vault.

## Abrir en Obsidian

1. Clona el repositorio completo.
2. En Obsidian selecciona **Open folder as vault**.
3. Elige la raíz del monorepo `ELEVANT`, no la subcarpeta `Vault`.
4. Mantén habilitadas las funciones nativas necesarias para Markdown, backlinks, Canvas, Bases, Properties y Templates.
5. No instales plugins comunitarios para poder leer el conocimiento base.

La configuración compartida vive en `.obsidian/` en la raíz. Al abrir todo el monorepo, los enlaces del Vault hacia código, `docs/`, contratos y workflows permanecen navegables en Obsidian y GitHub. El filtro inicial del grafo se concentra en `Vault/`; puedes retirarlo temporalmente para explorar backlinks del resto del repositorio.

## Tres formas de encontrar una respuesta

### Por pregunta

Abre [Respuestas rápidas](respuestas-rapidas.md) o sigue el [Mapa de preguntas](mapa-de-preguntas.md). Es la ruta más rápida cuando no conoces la estructura del monorepo.

### Por búsqueda

Busca primero el concepto funcional y después su identificador técnico. Ejemplo: `turnaround`, luego la entidad, endpoint o migración relacionada. Filtra por `status`, `evidence`, `area` y `tags` cuando uses Properties o Bases.

### Por relaciones

Usa los enlaces salientes y backlinks para seguir una capacidad desde producto hasta arquitectura, contrato, operación y decisión. Un backlink es contexto, no prueba: siempre revisa `sources` y la evidencia declarada.

Para interpretar colores, filtros y clústeres consulta la [Leyenda del grafo](../diagrams/leyenda-grafo.md). Si empiezas sin memoria de una sesión anterior, sigue el [Protocolo de recuperación](protocolo-recuperacion-contexto.md).

## Cómo interpretar una nota

1. **Frontmatter:** identidad, área, vigencia, madurez y evidencia.
2. **Resumen:** qué responde y para quién.
3. **Estado:** implementado, documentado, diferido o histórico.
4. **Contenido:** comportamiento, límites, decisiones y fallos conocidos.
5. **Fuentes:** archivos o evidencia que permiten verificarla.
6. **Relaciones:** notas que amplían o dependen del tema.

No interpretes `documented` como “desplegado” ni `planned` como “aprobado”. Consulta [Metadatos](../08-gobernanza/metadatos.md) para los valores exactos.

## Cómo editar sin degradar el conocimiento

1. Lee [`AGENTS.md`](../../AGENTS.md) y el `AGENTS.md` más cercano al subárbol afectado.
2. Comprueba código, tests, migraciones, OpenAPI y workflows antes de reescribir una afirmación.
3. Parte de la [plantilla adecuada](../99-plantillas/README.md).
4. Conserva el `id` de una nota existente aunque cambie su título o ubicación.
5. Añade fuentes repo-relative en el frontmatter y enlaces Markdown en el cuerpo.
6. Distingue estado actual, historia y futuro con las etiquetas correctas.
7. Actualiza `last_verified` y `verified_commit` solo después de verificar la nota completa.
8. Ejecuta las validaciones del Vault y las del subárbol afectado.
9. Explica en el PR qué conocimiento cambió, qué evidencia se usó y qué continúa pendiente.

## Seguridad editorial

Nunca copies al Vault:

- contraseñas, tokens, claves privadas o connection strings reales;
- correos o datos personales innecesarios;
- IP públicas, nombres reales del tailnet o FQDN privados;
- dumps, backups, salidas SQL con datos de negocio o evidencias sin sanear;
- variables protegidas, material de firma o credenciales demo del prototipo;
- capturas que revelen secretos, identidades o infraestructura sensible.

Usa placeholders inequívocos como `<SERVICE_NAME>`, `<PRIVATE_FQDN>` y dominios reservados `.test`. La política completa está en [Evidencia y fuentes](../08-gobernanza/fuentes-y-evidencia.md).

## Si encuentras una contradicción

1. No ejecutes una operación riesgosa basándote en la nota.
2. Identifica la fuente con mayor precedencia.
3. Registra la discrepancia en el PR o issue correspondiente.
4. Corrige el comportamiento o la documentación dentro del alcance autorizado.
5. Si no puede resolverse, baja `status` a `draft` o `evidence` a `unknown` y explica el bloqueo.

No ocultes el conflicto ni elijas la versión más conveniente.

## Qué no hace el Vault

- No despliega al VPS.
- No ejecuta migraciones.
- No sustituye revisión humana ni checks CI.
- No concede acceso a Development o Production.
- No contiene secretos para “facilitar” operaciones.
- No garantiza que un servicio esté sano ahora mismo; documenta cómo comprobarlo.

## Siguiente lectura

- [Home](home.md)
- [Estado inicial](estado-inicial.md)
- [Mantenimiento](../08-gobernanza/mantenimiento-del-vault.md)
- [Plantillas](../99-plantillas/README.md)
