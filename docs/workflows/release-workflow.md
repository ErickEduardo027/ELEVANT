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

SQL Server y sus volúmenes nunca participan del auto-deploy de API/web. Los
cambios destructivos usan expand/contract en releases distintos.

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

## Carriles posteriores

1. terminar API y el flujo mínimo G.H. -> credenciales de agente -> login en
   Mobile Agent, probado localmente con SQL local y emulador Android;
2. publicar/desplegar API con su CI/CD propio, siempre después de una entrega DB
   compatible;
3. desplegar AVIAM Web y Public Web al final, cada uno con imagen y CI/CD
   separados;
4. Mobile Agent genera APK/EAS por su canal y nunca se despliega como servicio
   Dokploy.

## Fallo

Detenga la promoción. El controlador no vuelve a intentar automáticamente el
mismo bundle. Una corrección publica otro digest; repetir exactamente el
mismo artefacto exige `--retry` manual y evidencia de que la causa externa fue
corregida.

Revertir imagen no revierte esquema. No edite `__EFMigrationsHistory`, no
ejecute `Down` improvisado y no restaure automáticamente sobre la base origen.
Siga `docs/deployment/rollback.md` y preserve evidencia sanitizada.
