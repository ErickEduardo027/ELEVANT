# Preparación de generación y firma contractual

## Estado y alcance

La implementación está en la rama local; no está promovida a Development ni a
Production. `ContractSigning:Enabled` permanece en `false` en la configuración
versionada. Existen dos métodos separados: `AcademicLocal` genera y conserva un
PDF individual desde datos SQL y registra dos aceptaciones electrónicas en
Development/Test; `Adobe` requiere la plantilla privada, las licencias y el
almacenamiento descritos abajo. La evidencia local identifica expresamente que
no hubo certificación externa. Ninguno de los dos modos autoriza despliegue.

El modelo estático anterior se retiró de los portales. Contratos revisa el PDF
individual de una versión aprobada, la emite explícitamente y AVIAM acepta
primero. La cuenta verificada del representante de la aerolínea revisa el mismo
hash y acepta después. El PDF final y la evidencia se conservan antes de
formalizar y habilitar servicios.

## Ensayo local en Development/Test

Configurar el proceso de la API mediante variables de entorno locales (fuera de
Git), con `ASPNETCORE_ENVIRONMENT=Development` o `Test`,
`ContractSigning__Mode=AcademicLocal`, `ContractSigning__Enabled=true` y
`ContractSigning__LocalArchiveDirectory` apuntando a un directorio **absoluto y
privado fuera del repositorio**. El guard de inicio rechaza el modo local en
otros entornos, rutas relativas, rutas dentro del repositorio y directorios
enlazados. No se necesitan credenciales Adobe ni S3 en este modo. La API guarda
PDF borrador, PDF final y evidencia como archivos inmutables; verifica sus
SHA-256 al leerlos. Hacer copia de seguridad del directorio de ensayo si se
necesita conservar los expedientes.

Aplicar las migraciones de Development por el proceso revisado antes de probar
las solicitudes con paquetes. La aprobación de Finanzas deja el contrato sin
habilitación; ambas aceptaciones del PDF emitido lo formalizan desde la fecha
UTC de formalización. Para corregir datos contractuales, crear otra versión y
preservar el expediente anterior. No copiar archivos del ensayo al repositorio
ni tratar la evidencia local como firma certificada.

## Entregables antes de activar

| Responsable | Entregable verificable |
| --- | --- |
| AVIAM Legal y Contratos | DOCX final con versión, campos de combinación y reglas comerciales aprobados; texto de firma y representación; cuenta AVIAM firmante autorizada. Registrar ambas aprobaciones fuera de la configuración de ejemplo. |
| Responsable de privacidad y archivo | Política aprobada de tratamiento, acceso, retención, eliminación y recuperación del contrato y su auditoría. Definir la evidencia y plazo que debe conservar ELEVANT. |
| Administrador Adobe | Acceso separado a Document Generation API de PDF Services y a Acrobat Sign REST v6; aplicación OAuth de Sign con permisos de lectura/escritura de acuerdos para el alcance aprobado, cuenta emisora, URL regional `api_access_point`, client ID, client secret y refresh token. Verificar licencia y límites contratados con Adobe. |
| Operador Development | Bucket privado S3 compatible con lectura/escritura de la API, copia de seguridad y restauración probada; configuración de la API por el gestor privado de secretos. Seguir el [runbook de medios](../../ops/dokploy/media-storage/README.md). |
| Equipo ELEVANT | Migración EF revisada y aplicada mediante el proceso de Database Release; API y ambas webs del mismo commit promovidas por sus controles existentes; permisos `contracts.signing.preview` y `contracts.signing.issue` asignados solo a cuentas autorizadas. |

Adobe documenta [la generación desde DOCX y JSON](https://developer.adobe.com/document-services/docs/overview/document-generation-api/gettingstarted),
[OAuth y el `api_access_point` regional](https://developer.adobe.com/acrobat-sign/docs/overview/developer_guide/gstarted),
y [el acuerdo, enlace alojado, PDF combinado y auditoría](https://developer.adobe.com/acrobat-sign/docs/overview/developer_guide/apiusage).
La cuenta de desarrollo sirve para ensayos con documentos sintéticos; su
disponibilidad no equivale a autorización para contratos reales.

## Contrato de plantilla

El backend mezcla exclusivamente datos SQL: `Contract` (`ContractCode`,
`VersionNumber`, `CurrencyCode`, `ValidFrom`, `ValidTo`, `Terms`), `Airline`
(`Name`, `IataCode`, `IcaoCode`), `Stations[]` (`Code`, `Name`), `Services[]`
(`Code`, `Name`, `BillingUnit`, `UnitPrice`, `MinimumQuantity`) y `Signers`
(`AviamEmail`, `AirlineEmail`). Legal y Contratos deben revisar cada campo y
las condiciones de ausencia, formato, moneda y redondeo en un PDF de muestra
con datos sintéticos. Las tarifas deben estar confirmadas, y la versión debe
tener estaciones y términos. El DOCX aprobado se carga como objeto **privado**;
registrar su clave, versión inmutable y SHA-256 del archivo exacto. En Windows,
`Get-FileHash -Algorithm SHA256 -LiteralPath <ruta-del-docx>` obtiene el hash.
No guardar la plantilla contractual ni datos reales en el repositorio.

## Configuración privada de la API

Mantener `ContractSigning__Enabled=false` durante la preparación. ASP.NET
Core traduce `__` en `:`. El operador carga las siguientes claves únicamente
en el gestor de secretos del entorno, no en Git, frontend, logs ni tickets:

| Grupo | Claves |
| --- | --- |
| Aprobaciones | `ContractSigning__PolicyApproved`, `ContractSigning__RetentionApproved`, `ContractSigning__Template__LegalApproved`, `ContractSigning__Template__ContractsApproved` |
| Plantilla | `ContractSigning__Template__ObjectKey`, `ContractSigning__Template__Version`, `ContractSigning__Template__Sha256` |
| PDF Services | `ContractSigning__AdobePdf__ClientId`, `ContractSigning__AdobePdf__ClientSecret` |
| Acrobat Sign | `ContractSigning__AdobeSign__ApiBaseUrl`, `ContractSigning__AdobeSign__ClientId`, `ContractSigning__AdobeSign__ClientSecret`, `ContractSigning__AdobeSign__RefreshToken` |
| Almacenamiento | `MediaStorage__Endpoint`, `MediaStorage__Region`, `MediaStorage__Bucket`, `MediaStorage__AccessKey`, `MediaStorage__SecretKey` |

`AdobeSign__ApiBaseUrl` debe ser el `api_access_point` de la cuenta que autorizó
OAuth, no la URL de inicio de sesión. La configuración versionada mantiene
banderas falsas y valores vacíos. El chequeo `Ready()` solo valida presencia
de valores: no prueba licencia, permisos OAuth, conectividad, contenido de la
plantilla ni restauración del bucket. La renovación periódica o reautorización
del refresh token debe quedar bajo operación; Adobe documenta su caducidad por
inactividad en [OAuth](https://developer.adobe.com/acrobat-sign/docs/overview/developer_guide/oauth).

## Ensayo y autorización final

1. Probar primero con simuladores y datos sintéticos: versión aprobada sin
   habilitación operativa, previsualización con hash estable, emisión
   idempotente, firmas incompletas, cancelación, duplicados, recuperación de
   errores y aislamiento entre aerolíneas.
2. En un entorno de ensayo Adobe y almacenamiento privado, verificar el DOCX
   exacto y un PDF sintético, OAuth y alcance, enlace alojado para la cuenta
   representante, ambas firmas en orden, PDF y auditoría descargados con hash
   verificado. No usar datos ni firmantes reales para este ensayo.
3. Revisar con Legal, Contratos, privacidad y operaciones los resultados y la
   política de archivo. Solo con aprobaciones registradas, activar
   `ContractSigning__Enabled=true` mediante el proceso de despliegue aprobado.
4. Verificar después de la promoción el estado de la API, la migración, la
   previsualización autorizada, el rechazo a cuentas ajenas y la descarga
   privada. La formalización debe ocurrir únicamente tras ambas firmas y
   evidencia conservada; una fecha anterior nunca habilita servicios.

Fuentes ejecutables: [gate de emisión](../../database/DevelopmentDB/Elevant.Persistence/Commercial/EfContractSigningStore.cs),
[adaptador PDF](../../backend/Elevant.Infrastructure/Commercial/AdobeContractDocumentGenerator.cs),
[adaptador Sign](../../backend/Elevant.Infrastructure/Commercial/AdobeContractSignGateway.cs),
[configuración base](../../backend/Elevant.Api/appsettings.json) y
[migración](../../database/DevelopmentDB/Elevant.Persistence/Persistence/Migrations/20261020000446_AddContractSigningEnvelope.cs).
