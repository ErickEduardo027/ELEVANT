# Flujo de liberación

## Preparación

- CI verde en el commit exacto y referencias de imagen por digest.
- contratos/migraciones revisados y drift cero;
- variables/secretos disponibles sin imprimirlos;
- backup verificado si el ambiente contiene datos no reconstruibles;
- compatibilidad, señales de aborto y rollback definidos;
- responsable/ventana operativa acordados.

## Orden general

1. verificar nombre/marcador del target;
2. ejecutar bundle de migraciones con login migrator;
3. ejecutar seed solo en Development con login seeder;
4. desplegar API compatible y validar `/health`, `/health/ready` y ping;
5. desplegar AVIAM Web/Public Web; distribuir Mobile por su canal;
6. observar errores, latencia y flujo crítico.

SQL Server y sus volúmenes nunca participan de una promoción API/web. Los
recursos Dokploy conservan AutoDeploy desactivado y los cambios destructivos
usan expand/contract en releases distintos.

## Entrega automática de base Development

La base tiene un carril propio. En un push directo a `Development`, CI primero
determina si cambió un artefacto que puede alterar las imágenes de operaciones,
el bundle EF, las migraciones, el modelo, el seed o sus Compose. Los cambios
exclusivos de API/contratos no publican una entrega DB.

Cuando el carril aplica:

1. no se cancela por un push posterior ajeno a DB; las publicaciones DB se
   serializan y vuelven a clasificar `Development` inmediatamente antes de cada
   alias mutable. Un avance DB-owned detiene el run anterior y el controlador
   tampoco acepta un `runId` que retroceda. GHCR no aporta compare-and-swap de
   tags, por lo que queda una ventana mínima entre el último gate y el push;
2. ejecuta restore/build/tests, drift cero, SQL idempotente y certificación
   completa contra SQL Server 2022;
3. publica `elevant-db-ops` y `elevant-db-release` por commit y obtiene sus
   digests inmutables;
4. genera y valida el manifiesto con commit, run, digests, hashes de Compose y
   fingerprints de migraciones/modelo/seed, y lo empaqueta con los dos Compose
   exactos como los tres payloads del bundle OCI v1;
5. publica el bundle por commit, vuelve a extraer y comparar sus tres payloads y
   mueve **al final** el alias privado `development-certified`;
6. el controlador privado de Dokploy descubre el alias, resuelve su digest,
   valida labels/bundle/manifiesto/hashes, cachea ambos Compose por contenido,
   rechaza un `runId` que no avance respecto del último aceptado y ejecuta
   únicamente las referencias `@sha256:` y Compose certificados;
7. bajo un lock común ejecuta backup previo, migración, seed Development,
   verificación, backup posterior y restore-check;
8. registra éxito/fallo en su estado persistente, los logs de Dokploy y el
   commit status de GitHub cuando el token opcional está configurado.

La instalación inicial del controlador, sus rutas a los dos proyectos Compose,
el token de status y la adopción de la versión viva siguen siendo acciones
manuales del operador. Antes de cada operación compara el modelo canónico de
los Compose certificados con los Raw vivos sin interpolar secretos: diferencias
de formato/comentarios son inocuas y el drift semántico falla cerrado. Los jobs
de backup/restore existentes se sustituyen en una ventana controlada por jobs
del mismo controlador para evitar solapamientos.

En el trabajo cotidiano, migraciones/modelo/seed y tooling DB pasan por esta
ruta sin intervención. Si cambia un Compose, CI certifica sus bytes nuevos, pero
la promoción falla cerrada mientras el Raw vivo tenga otra semántica. Operaciones
aplica y valida manualmente los cambios reales de red, volumen, permiso o
servicio; un simple reordenamiento o comentario no exige reconciliación. El
controlador nunca reescribe el provider Raw.

El repositorio privado está temporalmente en GitHub Free. Se acepta que un push
directo de un colaborador con write pueda disparar esta secuencia; los gates de
artefactos no equivalen a branch protection. Consulte
[`BRANCH_PROTECTION.md`](../../.github/BRANCH_PROTECTION.md).

## Entrega automática de API Development

La API tiene imagen, bundle OCI y controlador propios. Una entrega certificada
fija su Compose y el estado DB compatible. `api-cd` resuelve el alias a digest,
espera la base requerida, despliega la imagen inmutable y exige health,
readiness, ping y Swagger. El recurso sigue siendo Compose Raw con AutoDeploy
desactivado; GitHub Actions no inicia conexiones al VPS ni recompila en él.

Cuando API y Persistence cambian juntos, Database CD promueve primero. Un fallo
DB conserva la API anterior. Un fallo API no revierte el esquema y por eso las
migraciones deben ser backward-compatible. Consulte
[ADR-0011](../adr/0011-pull-based-api-development-cd.md).

## Entrega automática de las webs Development

AVIAM Web y Public Web son dos carriles independientes. En un pull request se
validan y construyen con orígenes sintéticos; en un push relevante a
`Development`, cada carril aplicable usa los orígenes HTTPS de las variables de
repositorio, certifica una imagen y publica un bundle OCI v1 independiente:

```text
elevant-private-web       + elevant-aviam-web-release-manifest
elevant-public-web        + elevant-public-web-release-manifest
```

El bundle contiene un manifiesto cerrado y el Compose exacto. Fija el digest de
imagen, hash Compose, fingerprint de configuración y la entrega API exacta con
la que se construyó: bundle, `runId`, imagen y hash OpenAPI. Solo después de
volver a extraer y comparar el payload se mueve su alias
`development-certified`.

En el VPS, el mismo paquete `web-cd` ejecuta perfiles `aviam-web` y
`public-web`, pero conserva configuración, estado, historia y rollback
separados. Antes de mutar un servicio valida:

1. identidad y labels OCI, esquema, paths y hashes del bundle;
2. equivalencia semántica entre Compose certificado y Raw vivo;
3. estado `succeeded/complete`, digest, `runId`, imagen y OpenAPI de la API
   exacta;
4. imagen web inmutable y procedencia del commit.

Un candidato que espera otra API se difiere sin registrar intento. Una
promoción fallida restaura el último par imagen/Compose sano; si el rollback
falla, se pausa solo ese perfil. El controlador no ejecuta
`docker compose down`, no toca SQL y no reescribe el Raw.

Los polls comparten la jerarquía de locks `database -> API -> web -> perfil` y
se escalonan cada minuto: DB `:00`, API `:15`, AVIAM Web `:30`, Public Web
`:45`. Los sleeps reducen la contención ordinaria; los locks son la garantía de
exclusión. El primer despliegue, la instalación, adopción y habilitación de jobs
siguen siendo acciones manuales con evidencia por cada aplicación.

Las webs permanecen tailnet-only, sin Domain/Funnel y sin red SQL. El rollout
inicial es un preview técnico: una shell saludable no implica que ya existan en
la API los endpoints de autenticación o negocio del prototipo. Consulte
[ADR-0012](../adr/0012-pull-based-web-development-cd.md).

## Carril Mobile Agent

Mobile Agent se prueba localmente con emulador/tablet y consume la misma API
Development por HTTPS/Tailscale. Genera APK/EAS por su propio canal y nunca se
despliega como servicio Dokploy.

## Fallo

Detenga la promoción afectada. Los controladores no vuelven a intentar
automáticamente un bundle que ya falló. Una corrección publica otro digest;
repetir exactamente el mismo artefacto exige `--retry` manual y evidencia de
que la causa externa fue corregida.

Revertir imagen no revierte esquema. No edite `__EFMigrationsHistory`, no
ejecute `Down` improvisado y no restaure automáticamente sobre la base origen.
Siga `docs/deployment/rollback.md` y preserve evidencia sanitizada.
