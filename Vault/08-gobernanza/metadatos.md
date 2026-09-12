---
id: gobernanza-metadatos
title: "Esquema de metadatos"
type: policy
area: governance
status: documented
maturity: stable
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "pending"
sources:
  - Vault/README.md
  - Vault/08-gobernanza/fuentes-y-evidencia.md
tags:
  - gobernanza
  - metadata
  - yaml
---

# Esquema de metadatos

Toda nota Markdown del Vault empieza con frontmatter YAML. Las doce propiedades siguientes son obligatorias, en este orden, incluso si una nota es plantilla, índice o histórica.

```yaml
---
id: identificador-estable-unico
title: "Título legible"
type: guide
area: development
status: documented
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "YYYY-MM-DD"
verified_commit: "SHA_COMPLETO"
sources:
  - ruta/desde/raiz.md
tags:
  - etiqueta
---
```

## Propiedades

| Propiedad | Regla |
| --- | --- |
| `id` | Kebab-case, único e inmutable. No depende del título ni de la ruta. |
| `title` | Título humano en español; nombres técnicos conservan su forma oficial. |
| `type` | Clase documental controlada de la nota. |
| `area` | Mapa de contenido responsable. Solo un área primaria. |
| `status` | Vigencia editorial según la política de evidencia. |
| `maturity` | Profundidad/estabilidad del conocimiento, no estado de despliegue. |
| `evidence` | Tipo de respaldo de la afirmación central. |
| `owner` | Rol o equipo responsable; no correo ni identidad personal innecesaria. |
| `last_verified` | Fecha ISO entre comillas de la última verificación integral. |
| `verified_commit` | SHA Git completo contrastado; `pending`, `unknown` o `not-applicable` sólo durante el ciclo editorial permitido. Nunca un nombre de rama mutable. |
| `sources` | Lista no vacía de rutas repo-relative con `/`. |
| `tags` | Lista corta de términos en minúscula/kebab-case para descubrimiento. |

## Enum de `type`

| Valor | Uso |
| --- | --- |
| `index` | Home o mapa de contenido. |
| `guide` | Explicación práctica o recorrido de desarrollo. |
| `concept` | Término de producto o dominio. |
| `architecture` | Estructura, límites, dependencias o flujo técnico. |
| `decision` | ADR o decisión con alternativas y consecuencias. |
| `runbook` | Procedimiento operativo reproducible y reversible. |
| `capability` | Capacidad funcional de extremo a extremo. |
| `incident` | Registro saneado de un incidente y su aprendizaje. |
| `status` | Fotografía versionada de estado/cobertura. |
| `reference` | Inventario, contrato, glosario o tabla de consulta. |
| `history` | Cronología o reconstrucción histórica. |
| `policy` | Regla normativa del proyecto o del conocimiento. |
| `template` | Base para crear otra nota. |
| `diagram` | Representación visual nativa o su equivalente portable. |
| `backlog` | Trabajo diferido con dependencias y criterio de cierre. |

## Enum de `area`

`vault`, `product`, `architecture`, `domain`, `applications`, `backend`, `database`, `private-web`, `public-web`, `mobile`, `api-client`, `development`, `ci-cd`, `operations`, `security`, `governance`, `history`, `reference` o `backlog`.

El área refleja quién mantiene la nota, no todas las áreas mencionadas. Usa `tags` y enlaces para relaciones secundarias.

## Enum de `status`

`verified`, `documented`, `draft`, `deferred`, `deprecated` o `historical`.

- Solo `verified` afirma una comprobación integral en fecha y commit.
- `documented` no significa desplegado.
- `deferred` no significa en progreso.
- `historical` no se actualiza para aparentar el presente; se enlaza a la nota vigente.

## Enum de `maturity`

| Valor | Significado |
| --- | --- |
| `seed` | Cobertura inicial suficiente para orientar; faltan capas o relaciones. |
| `evolving` | Útil y mantenida, con áreas conocidas por completar. |
| `stable` | Cobertura y estructura consolidadas; cambia con su contrato. |
| `retired` | Conservada por trazabilidad, reemplazada para uso actual. |

Madurez no equivale a implementación. Un diseño `deferred` puede estar bien documentado y `stable`; una capacidad desplegada puede tener documentación `seed`.

## Enum de `evidence`

`repo-verified`, `operator-recorded`, `planned` o `unknown`. La definición y criterios están en [Política de evidencia y fuentes](fuentes-y-evidencia.md).

## Reglas de fechas y commits

- Usa la fecha real en que se revisó toda la nota, no la fecha de una edición cosmética.
- Usa el SHA completo de la fuente verificada.
- Una nota nueva puede apuntar al commit base desde el que se contrastó.
- Si su fuente nace en el mismo cambio y todavía no tiene un SHA direccionable, usa temporalmente `status: documented` y `verified_commit: pending`. No declares `verified` hasta que esa fuente exista en un commit anterior comprobable.
- Si no se realizó verificación, usa `status: draft`, `evidence: unknown` y explica la brecha; no falsifiques fecha o commit.
- Los generadores pueden actualizar inventarios derivados, pero no deben elevar automáticamente una nota a `verified`.

## Reglas de `sources`

- La ruta parte de la raíz del repositorio: `docs/api/openapi-contract.md`.
- No uses rutas absolutas de una estación de trabajo.
- No uses URLs privadas ni recursos que requieran un secreto en la ruta.
- Prefiere archivos específicos sobre directorios.
- Para evidencia externa pública, cita la URL en el cuerpo y conserva en `sources` una nota/ADR versionada que explique su uso.
- Una nota de testimonio o estado operativo enlaza su registro saneado versionado.

## Reglas de `tags`

- Entre dos y seis etiquetas normalmente bastan.
- Minúsculas, sin tildes y en kebab-case.
- No repitas `type`, `area` y `status` salvo que ayude a una búsqueda humana.
- No incluyas personas, secretos, hosts o identificadores efímeros.

## Identidad y movimientos

`id` permite conservar backlinks conceptuales aunque el archivo se renombre. Al mover una nota:

1. conserva `id`;
2. actualiza enlaces relativos entrantes y salientes;
3. deja una nota de redirección solo si hay consumidores externos conocidos;
4. no dupliques el contenido vigente;
5. ejecuta el validador de enlaces y unicidad.

## Validación editorial mínima

Una nota falla revisión si altera el orden del contrato, falta una propiedad, deja vacíos `sources` o `tags`, usa un enum desconocido, duplica un `id`, declara una fuente inexistente, contiene un enlace roto o usa una fecha/commit que no corresponde a una verificación real. Cuando el estado es `verified`, el checker comprueba que el SHA completo exista y que cada fuente exista en ese commit.

Relacionados: [Plantilla general](../99-plantillas/pagina.md), [Mantenimiento](mantenimiento-del-vault.md), [Home](../00-inicio/home.md).
