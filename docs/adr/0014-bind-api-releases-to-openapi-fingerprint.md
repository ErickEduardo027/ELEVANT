# ADR-0014: Vincular releases API mediante la huella OpenAPI

## Estado

Accepted — 2026-09-16. Enmienda únicamente la procedencia almacenada en
`packages/api-client/openapi/source.json`; conserva los esquemas v1 de los
manifiestos API/web y los contratos de los controladores del VPS.

## Contexto

El snapshot OpenAPI versionado debe corresponder exactamente al contrato que
expone la imagen API certificada y al contrato usado para construir las webs.
Antes, `source.json` intentaba registrar el commit, el run y el digest de una
imagen que todavía no podía existir dentro de ese mismo commit. Después de una
entrega correcta era necesario otro commit documental para reconciliar esos
datos, y ese commit podía volver a disparar los carriles de publicación.

La procedencia de una release ya existe en su manifiesto OCI inmutable: commit,
run, imagen y dependencias. Lo que el código fuente necesita declarar antes de
publicar es la identidad reproducible del **contrato**, no la identidad futura
de una ejecución de CI.

## Decisión

- `packages/api-client/openapi/source.json` es un descriptor cerrado v1 con
  exactamente `schemaVersion`, `openApiSha256` y `swaggerPath`.
- `openApiSha256` se calcula sobre JSON canónico: claves de objetos ordenadas
  recursivamente, orden de arrays preservado, serialización compacta y SHA-256
  de sus bytes UTF-8. Usa el formato `sha256:<64 hex minúsculas>` y rechaza
  enteros fuera del rango seguro de JavaScript para no perder precisión.
- Los checks del paquete exigen que el descriptor coincida con
  `openapi/elevant-v1.json`; claves adicionales, versiones desconocidas o una
  huella distinta fallan cerrado.
- Backend CI vuelve a calcular esa huella, certifica que el Swagger servido por
  la imagen exacta coincide y añade
  `io.elevant.api-release.openapi-sha256` al bundle API. La etiqueta forma parte
  del artefacto identificado por digest, sin añadir un payload ni cambiar el
  manifiesto API v1.
- Web CI valida una igualdad de tres vías: descriptor versionado, snapshot
  canónico y etiqueta del bundle API resuelto. El manifiesto inmutable del
  bundle sigue aportando commit, run e imagen API a los manifiestos web.
- Una política de paths compartida define los inputs que producen API. El
  resolver exige que el commit declarado sea el `HEAD` del checkout y acepta una
  release anterior solo si entre su commit y ese checkout no cambió ningún input
  API; si cambió, espera la release exacta nueva aunque la huella OpenAPI sea
  igual. Esos cambios también recertifican ambas webs.
- Si un alias mutable todavía apunta a un bundle anterior sin etiqueta o con
  otra huella/generación, el resolver espera una publicación compatible. Si el
  operador entrega una referencia inmutable incompatible, falla inmediatamente.
- La publicación API y las dos publicaciones web comparten un grupo de
  concurrencia con cola múltiple; así ningún carril pendiente es sustituido
  cuando llega otro. Antes de publicar, cada web vuelve a exigir que el alias
  API resuelva al mismo bundle inmutable que certificó.
- Los controladores API/web y sus estados no cambian: continúan validando los
  manifiestos, digests, imágenes y el hash OpenAPI exacto antes de promover.

## Consecuencias

- Un cambio de contrato puede compilar, certificar y publicar API y webs desde
  el mismo merge sin un commit posterior que reescriba `source.json`.
- Los carriles pueden empezar en paralelo: las webs esperan hasta que el alias
  API anuncie un bundle con la huella requerida; no publican contra un contrato
  anterior.
- Un refactor API que no cambia OpenAPI conserva el descriptor, pero produce una
  release API exacta nueva y recertifica ambas webs. Un cambio solo-web puede
  reutilizar la release existente cuando la política demuestra que sus inputs
  API no cambiaron.
- La huella demuestra igualdad de bytes JSON canónicos, no compatibilidad
  semántica ni corrección del diseño. La etiqueta y el digest tampoco son una
  attestation criptográfica externa.
- Un rerun manual de Backend CI para el mismo commit puede producir otra tupla
  exacto de run/imagen/bundle sin un nuevo push que dispare Web CI. La
  revalidación impide que una publicación web en curso use un alias cambiado; si
  se necesita recertificar las webs contra esa nueva tupla, debe rerunearse Web
  CI para el mismo commit. No se relaja el gate exacto del controlador.
- Cambiar el algoritmo o la forma del descriptor requiere otra versión de
  esquema y una transición explícita.

## Relación con decisiones anteriores

Esta decisión sustituye solo la afirmación de ADR-0007 de que `source.json`
guarda commit/run/imagen. ADR-0011 conserva la procedencia completa de la API en
su bundle, y ADR-0012 conserva la dependencia API exacta dentro de cada release
web y durante su promoción privada.
