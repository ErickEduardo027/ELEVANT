# Flujo de desarrollo web

Existen dos aplicaciones web con entregas independientes:

| Aplicación | Fuente | Runtime Development | Identidad de entrega |
| --- | --- | --- | --- |
| AVIAM Web | `frontend/private-web` | Vite estático + Nginx no-root | `aviam-web` |
| Public Web | `frontend/public-web` | Next.js `standalone` + Node no-root | `public-web` |

Ambas usan npm y su propio `package-lock.json`, comparten
`packages/api-client` y consumen la misma Elevant API versionada. No comparten
necesariamente framework, sesión UI ni ciclo de despliegue. Nunca se conectan a
SQL Server ni a proveedores de aviación directamente.

## Trabajo cotidiano

1. Crear una rama feature desde `Development` y seleccionar una capability con
   contrato OpenAPI existente o coordinado.
2. Definir tenant, roles y station scopes que la API aplicará. La interfaz no
   concede autorización por mostrar u ocultar controles.
3. Actualizar el cliente compartido cuando cambie OpenAPI y conservar la huella
   verificable del contrato; cada release conserva su propia procedencia.
4. Mantener adaptadores mock/remoto fuera de los componentes. Los mocks son
   evidencia de workflow, no una base ni contrato paralelos.
5. Diseñar carga, éxito, vacío, error recuperable y no autorizado; probar
   aislamiento, accesibilidad y el happy path.
6. Ejecutar los scripts declarados en el `package.json` de la aplicación antes
   del PR. Cada frontend conserva su propia validación.
7. Fusionar mediante PR a `Development`. Un cambio relevante publica solo el
   carril afectado después de CI; cambiar el cliente compartido puede requerir
   certificar ambos.

OpenAPI es la frontera cliente/servidor. Public Web nunca confía un tenant
enviado por el navegador y AVIAM Web nunca obtiene privilegios por navegación
o estado local.

## Configuración de build Development

Los valores `VITE_*` y `NEXT_PUBLIC_*` se incorporan durante build, son
observables por el navegador y no admiten secretos. GitHub Actions obtiene los
orígenes de variables de repositorio:

```text
ELEVANT_DEV_API_ORIGIN
ELEVANT_DEV_AVIAM_WEB_ORIGIN
ELEVANT_DEV_PUBLIC_WEB_ORIGIN
```

Cada valor es un origen HTTPS exacto y sin `/` final. Las plantillas del
repositorio conservan placeholders; no contienen nombres de tailnet vivos. El
build certificado de Development rechaza un origen `localhost`, credenciales,
query/fragment o una ruta adicional.

Mientras algunos adaptadores todavía usan el contrato prototipo, su URL de
compatibilidad se fija al mismo `ELEVANT_DEV_API_ORIGIN`. Por eso una operación
aún no implementada falla de forma visible en la API real en lugar de intentar
alcanzar `localhost` en el equipo del usuario. `backend-prototipo` nunca se
despliega para simular funcionalidad.

## CI y publicación

En pull requests, `Pull request CI` selecciona las aplicaciones afectadas y
llama a Web CI. Cada una instala dependencias bloqueadas, ejecuta sus pruebas,
construye con orígenes sintéticos seguros y certifica imagen/runtime. El gate
final del PR exige que todos los carriles seleccionados, Vault y el escaneo de
secretos terminen bien; un job omitido por error no cuenta como éxito. El PR no
publica ni accede al VPS.

En un push relevante a `Development`, `Development delivery` ordena Backend CI
antes de Web CI si cambió una entrada API. Un cambio exclusivo de una web no
reconstruye backend y selecciona solo esa aplicación. Cada carril aplicable:

1. valida el descriptor contra el snapshot, resuelve un bundle API certificado
   cuya etiqueta OpenAPI tenga esa misma huella, comprueba que no haya inputs API
   pendientes entre su commit y el checkout, y extrae su manifiesto inmutable;
2. construye una sola imagen con los tres orígenes revisados y la etiqueta de
   procedencia del commit;
3. certifica health, rutas/shell, configuración horneada, ausencia de localhost
   y endurecimiento del runtime;
4. publica la imagen y la identifica mediante `@sha256:`;
5. genera un manifiesto cerrado que fija imagen, hash Compose, fingerprint de
   configuración, bundle/imagen/run API exactos y hash canónico de OpenAPI;
6. empaqueta manifiesto + Compose exacto en su bundle OCI v1, vuelve a extraer
   ambos payloads y exige igualdad byte a byte;
7. mueve al final el alias `development-certified` del bundle propio.

El alias API es solo descubrimiento. Cuando el mismo push requiere API nueva,
Backend CI entrega a Web CI la referencia inmutable del bundle publicado; si
no llega, Web CI falla cerrado. Cuando no hay input API nuevo, el resolver
consulta una sola vez el alias y exige una release compatible en la misma
historia. Una referencia API inmutable incompatible falla inmediatamente. Los
mismos paths API disparan la recertificación de ambas webs. Antes de publicar
se vuelve a comparar el alias con el bundle usado en el build, y
API/AVIAM/Public comparten una exclusión de publicación con cola múltiple
para no sustituir carriles pendientes. No hay un runner esperando durante
minutos a que aparezca un alias API nuevo.

Las imágenes son `elevant-private-web` y `elevant-public-web`; los bundles son
`elevant-aviam-web-release-manifest` y
`elevant-public-web-release-manifest`. Tags/aliases ayudan al descubrimiento,
pero solo los digests forman parte de una entrega o rollback.

## Promoción en el VPS

Dokploy usa dos recursos Compose / Raw con AutoDeploy desactivado. No usa el
provider GitHub para reconstruir o desplegar estas aplicaciones. El controlador
genérico [`ops/dokploy/web-cd`](../../ops/dokploy/web-cd/README.md) mantiene dos
perfiles y estados independientes, exige la API exacta y promueve una web por
vez:

```text
aviam-web  -> 127.0.0.1:18081 -> contenedor 8080
public-web -> 127.0.0.1:18082 -> contenedor 3000
```

Cada web usa una red runtime propia, sin `elevant-dev-data`. Tailscale Serve es
el único ingreso HTTPS; Dokploy Domain y Funnel permanecen desactivados. Los
polls se ejecutan cada minuto, escalonados en `:30` para AVIAM Web y `:45` para
Public Web después de Database `:00` y API `:15`. Los locks compartidos son la
protección real frente a solapamientos.

La instalación, primer despliegue, adopción y habilitación de schedules son
checkpoints manuales del operador. Versionar este flujo no modifica el VPS. Una
promoción fallida vuelve al último par imagen/Compose sano; un fallo del
rollback pausa solo el perfil afectado.

## Alcance funcional actual

El primer rollout publica previews técnicos para que el equipo desarrolle y
valide integración remota. Health y las shells pueden estar operativos aunque
la API todavía no implemente autenticación o endpoints de negocio usados por
las pantallas prototipo. Una UI visible no demuestra que ese flujo sea
funcional, autorizado o listo para Production.

Mobile Agent no participa de este despliegue: se ejecuta en emulador/tablet,
consume la misma API por HTTPS/Tailscale y se distribuye por APK/EAS cuando
corresponda.
