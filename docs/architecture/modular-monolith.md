# Monolito modular

El backend se entrega como un único proceso, pero no como una colección indiscriminada de clases. La modularidad se hace visible mediante proyectos, namespaces, carpetas por feature y pruebas de referencias.

## Regla de dependencias

El grafo productivo exacto, exigido por las pruebas de arquitectura, es:

- `Domain`: ninguna referencia a proyectos Elevant.
- `Application` → `Domain`.
- `Contracts`: ninguna referencia a proyectos Elevant.
- `Infrastructure` → `Application` y `Domain`.
- `Persistence` → `Domain`.
- `DatabaseTool` → `Persistence`.
- `Api` → `Application`, `Contracts`, `Infrastructure` y `Persistence`.

`Persistence` y `DatabaseTool` viven bajo `database/DevelopmentDB` pero son
proyectos de la misma solución. Que Api referencie Persistence para componerlo
no convierte el `DbContext` en una dependencia permitida para los controllers.

Las pruebas pueden referenciar los proyectos necesarios para observarlos, pero no cambian el grafo productivo. No se permite un ciclo, una referencia de Domain a Entity Framework, ni una referencia de Application a Api o Infrastructure.

## Fronteras de módulo

Al introducir una capacidad de negocio se define:

- vocabulario y reglas del dominio;
- comandos o consultas que constituyen su interfaz interna;
- contratos HTTP separados de entidades de dominio;
- persistencia detrás de puertos de Application;
- eventos que comunican hechos sin filtrar detalles de infraestructura;
- tests de reglas, aplicación y frontera HTTP.

Un módulo no debe consultar las tablas privadas de otro para evitar su interfaz.
La base física es compartida por la única API; la revisión y los tests de casos
de uso deberán hacer cumplir esa frontera cuando existan módulos funcionales.
Las tablas y entidades actuales no prueban que ya existan handlers de negocio.

## Cuándo extraer un servicio

La extracción se considera únicamente si hay evidencia de al menos uno de estos factores: escalado muy diferente, ciclo de despliegue independiente sostenido, frontera de propiedad clara, aislamiento regulatorio o fallos que no puedan mitigarse dentro del proceso. Antes de extraer se mide el costo de consistencia distribuida, red, observabilidad y operación.
