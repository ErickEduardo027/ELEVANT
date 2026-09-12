---
id: diagram-leyenda-grafo
title: "Leyenda y uso del grafo de conocimiento"
type: diagram
area: vault
status: documented
maturity: stable
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "pending"
sources:
  - .obsidian/graph.json
  - Vault/README.md
  - Vault/08-gobernanza/metadatos.md
tags:
  - graph
  - obsidian
  - navegacion
---

# Leyenda y uso del grafo de conocimiento

El Graph nativo de Obsidian representa el cerebro navegable de ELEVANT: los nodos son notas y fuentes Markdown, las líneas son relaciones explícitas y el color combina estado, área y evidencia. Su configuración compartida enfoca el Vault junto con `docs/`, `ops/dokploy`, reglas y README; oculta plantillas para que el mapa principal sea legible.

## Gramática visual

| Color | Significado dominante | Pregunta que ayuda a responder |
| --- | --- | --- |
| Coral | `draft` o evidencia `unknown` | ¿Qué no debo asumir todavía? |
| Ámbar | `deferred`, `planned` o tipo `backlog` | ¿Qué está diseñado para después o mantiene una brecha visible? |
| Gris | Histórico, deprecado o área de historia | ¿Qué explica el pasado pero no gobierna el presente? |
| Violeta | Inicio, diagramas, mapas y recuperación de contexto | ¿Por dónde entro? |
| Magenta | Producto y dominio | ¿Qué problema y vocabulario compartimos? |
| Azul | Arquitectura, backend y datos | ¿Cómo está construido? |
| Cian | Aplicaciones y experiencias | ¿Dónde vive cada flujo de usuario? |
| Turquesa | Desarrollo y contratos de cliente | ¿Cómo lo cambio de forma segura? |
| Índigo | CI/CD y entrega | ¿Qué se valida y publica? |
| Verde azulado | Operaciones | ¿Qué se observa, mantiene y recupera? |
| Cobre | Seguridad | ¿Qué límite o permiso rige? |
| Lavanda | Gobernanza y referencia | ¿Cómo pruebo o consulto una afirmación? |
| Pizarra | Fuentes Markdown fuera del Vault | ¿Dónde compruebo la explicación? |

El color nunca es la única señal: abre el nodo y lee `status`, `evidence`, `maturity`, `verified_commit` y `sources`. Los estados de riesgo aparecen antes que los grupos de área en la configuración para mantenerlos visibles. Entrega, Operaciones y Seguridad tienen ahora grupos propios, aunque sus notas diferidas conservan el ámbar prioritario.

## Vistas recomendadas

1. **Graph global:** descubre áreas aisladas, hubs y conexiones faltantes.
2. **Local graph:** abre una nota y limita la profundidad para recorrer sus dependencias inmediatas.
3. **Backlinks:** identifica qué conocimiento debe revisarse cuando cambia una fuente.
4. **Base del atlas:** usa [Atlas de conocimiento](atlas-conocimiento.base) para filtrar por propiedades, no sólo por forma visual.

Filtros nativos útiles:

```text
[area:database]
[area:mobile]
[status:deferred]
[evidence:unknown]
path:"Vault/00-inicio"
```

## Cómo interpretar la forma

- Un nodo grande suele recibir muchos enlaces; es un punto de entrada o una dependencia compartida, no necesariamente una fuente superior.
- Un nodo aislado publicado indica una brecha de navegación y debe corregirse; el CI también exige alcance desde `Vault/README.md`.
- Un clúster denso muestra conocimiento relacionado, pero la autoridad sigue definida por `sources`.
- Una zona ámbar o coral no es un error visual: revela deuda, decisiones futuras o evidencia incompleta.

## Diseño intencional

La separación, repulsión y longitud de enlace se ajustan para evitar una “bola” compacta a medida que crece el repositorio. El grafo abre con flechas, etiquetas visibles y una escala moderada; los tags se ocultan como nodos para privilegiar relaciones entre documentos. Las carpetas generadas y dependencias locales se excluyen antes de indexar. No se versionan posiciones personales ni workspaces: cada colaborador puede explorar sin ensuciar Git.

Volver a [Home](../00-inicio/home.md), abrir el [Atlas general](atlas-elevant.md) o seguir el [Protocolo de recuperación](../00-inicio/protocolo-recuperacion-contexto.md).
