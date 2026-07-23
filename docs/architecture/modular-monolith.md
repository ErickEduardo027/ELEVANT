# Monolito modular

El backend se entrega como un único proceso, pero no como una colección indiscriminada de clases. La modularidad se hace visible mediante proyectos, namespaces, carpetas por feature y pruebas de referencias.

## Regla de dependencias

El grafo permitido es:

- `Domain`: ninguna referencia a proyectos Elevant.
- `Application` → `Domain`.
- `Contracts`: ninguna referencia a proyectos Elevant.
- `Infrastructure` → `Application` y `Domain`.
- `Api` → `Application`, `Contracts` e `Infrastructure`.

Las pruebas pueden referenciar los proyectos necesarios para observarlos, pero no cambian el grafo productivo. No se permite un ciclo, una referencia de Domain a Entity Framework, ni una referencia de Application a Api o Infrastructure.

## Fronteras de módulo

Al introducir una capacidad de negocio se define:

- vocabulario y reglas del dominio;
- comandos o consultas que constituyen su interfaz interna;
- contratos HTTP separados de entidades de dominio;
- persistencia detrás de puertos de Application;
- eventos que comunican hechos sin filtrar detalles de infraestructura;
- tests de reglas, aplicación y frontera HTTP.

Un módulo no consulta las tablas privadas de otro para evitar su interfaz. Mientras exista una sola base física, esa restricción se mantiene por código, revisiones y permisos futuros, no por microservicios artificiales.

## Cuándo extraer un servicio

La extracción se considera únicamente si hay evidencia de al menos uno de estos factores: escalado muy diferente, ciclo de despliegue independiente sostenido, frontera de propiedad clara, aislamiento regulatorio o fallos que no puedan mitigarse dentro del proceso. Antes de extraer se mide el costo de consistencia distribuida, red, observabilidad y operación.

