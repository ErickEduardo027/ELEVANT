# ADR-0023: Verificación de aerolíneas en un registro público

## Estado

Accepted — 2026-11-02.

## Contexto

El paso 2 del asistente público ofrece las aerolíneas que el superadministrador publica. Hasta
ahora solo había una verificación manual: el superadministrador marcaba «Verificada» con una
URL de fuente, sin ninguna consulta externa. Se pidió comprobar con una API abierta que la
aerolínea existe, con un check verde visible.

## Decisión

### Fuentes

1. **Wikidata (en vivo).**
   - Consulta SPARQL a `query.wikidata.org` por designador IATA (P229) o ICAO (P230).
   - Obtiene la etiqueta, el país (P17 → ISO P297) y la fecha de disolución (P576).
   - Los datos son CC0 y no requiere clave.
   - El texto de la consulta se arma solo con códigos validados, el endpoint es fijo y la
     petición tiene un timeout de 8 segundos.
2. **OpenFlights (sin conexión).**
   - Copia de `airlines.dat` (ODbL 1.0) generada por
     `scripts/data/generate-openflights-airlines.mjs` desde un commit fijo, con su SHA-256
     comprobado, e incrustada en Infrastructure.
   - Responde cuando Wikidata falla, o cuando Wikidata no encuentra los códigos.
   - Sus datos son más antiguos, así que el resultado siempre muestra la fuente.

### Veredicto

`AirlineRegistryMatcher` decide con los códigos y compara el nombre sin tildes, signos ni
palabras genéricas («Airlines», «S.A.», «Líneas Aéreas»…):

| Estado | Significado | Sello |
|---|---|---|
| `Found` | Nombre y códigos coinciden con una aerolínea en operación | Verde |
| `Mismatch` | Los códigos existen, pero el nombre o el otro código no coinciden (se listan las diferencias) | Ámbar |
| `Defunct` | La aerolínea que coincide ya no opera | Rojo |
| `NotFound` | Ningún registro usa esos códigos | Rojo |
| `Unavailable` | Ningún registro respondió; no se guarda y se conserva el estado anterior | Gris |

### Uso

- `POST governance/airlines/{id}/registry-check`, solo para el superadministrador.
  - Guarda en `commercial.airline_profiles` el estado, la fuente, la fecha y la URL de la
    entidad de Wikidata, y lo audita.
  - Si el nombre o los códigos cambian entre la lectura y el guardado, responde 409.
- Cambiar el nombre visible o un código anula el check.
- **Publicación:** una aerolínea solo se publica para el paso 2 con un check `Found` vigente o
  con la verificación manual con su fuente (`registry_check_required` en otro caso).
- El catálogo público añade `registrySource` solo a las aerolíneas con check verde, y el
  asistente muestra «Verificada en registro público (Wikidata)».
- El campo se omite cuando es nulo: los clientes publicados antes de este cambio rechazan
  claves desconocidas, y así siguen leyendo el catálogo hasta actualizarse (fase de expansión).
  Conviene desplegar Public Web antes del primer check verde.

## Consecuencias

- El check depende de que la aerolínea tenga códigos IATA o ICAO correctos. Sin códigos solo
  queda la verificación manual.
- Wikidata es editable por cualquiera, así que un check verde no sustituye la verificación
  legal de Contratos (razón social y permisos, ADR-0024).
- Las pruebas no usan la red: los adaptadores se prueban con respuestas grabadas y con la copia
  de OpenFlights. La prueba contra Wikidata en vivo solo corre con `ELEVANT_LIVE_REGISTRY=1`.

## Ampliación (15 de noviembre de 2026): comprobación automática en la solicitud y bloqueo de la aprobación

Corrección del profesor: una aerolínea inexistente no debe llegar a contrato.

- **Cuándo corre.** Sin intervención de nadie, (a) al enviar una solicitud pública con una
  aerolínea propuesta (no está en el catálogo) y (b) cada vez que Contratos aprueba una solicitud.
  Usa los mismos registros y el mismo orden (vuelos observados, Wikidata en vivo con 8 s,
  OpenFlights sin red); nunca AeroDataBox. Todos juntos tienen 10 s; si no responden, el veredicto
  es `Unavailable` y el formulario público no falla.
- **Dónde queda.** En la solicitud (`commercial.service_requests.registry_status`,
  `registry_source`, `registry_checked_at` y `registry_detail`, migración
  `20261115233439_AddAirlineTaxRegistrationAndRequestRegistryCheck`). Mientras la solicitud no
  tiene veredicto propio, la bandeja muestra el último check de la ficha del catálogo que hizo
  Superadministración. Contratos lo lee en español: «Encontrada en OpenFlights», «No encontrada en
  registros públicos», «Inactiva», «No coincide: …» o «No se pudo comprobar».
- **Bloqueo.** La aprobación con `NotFound`, `Defunct` o `Mismatch` responde 409
  `airline_not_in_public_registry` («Superadministración debe verificarla a mano con una fuente
  oficial antes de aprobar»). El veredicto rechazado se guarda después de la respuesta, de modo que
  la relectura que exige el 409 lo muestra. `Unavailable` no bloquea; la bandeja avisa.
- **Excepción.** La ficha está verificada con una fuente (`verified_at`, `verified_by_account_id`
  y `verification_source_url`, ya auditados) por una cuenta que es superadministradora. En ese caso
  la aprobación no consulta los registros y la bandeja muestra «Verificada a mano por Superadmin ·
  fuente». Confirmar la misma identidad y la misma fuente ya no reemplaza a quien verificó, tanto en
  Contratos como en Superadministración. Si un superadministrador guarda en **Aerolíneas** una
  ficha verificada por Contratos, la toma como suya.
- **Alcance.** La regla vive en `DecideCommercialRequestHandler`, que es el camino de la API.
  `ICommercialWorkflowStore.DecideAsync` sin la compuerta no la aplica; lo usan las pruebas de
  persistencia. Las pruebas automáticas inyectan registros falsos y nunca consultan Wikidata.

## Ampliación (16 de noviembre de 2026): ficha propuesta sin publicar, RNC de la ficha y fichas AVIAM

- **La ficha de una aerolínea propuesta nace sin publicar.** «Crear ficha verificada» de Contratos crea la
  ficha con `is_published = 0` (la auditoría `commercial.airline.created` lo registra). La aprobación de esa
  solicitud la publica en la misma transacción, con `commercial.airline.published`
  (`airline.published` False → True), y avisa al asistente público. Rechazar o cancelar la deja sin publicar.
  Vincular la solicitud a una ficha existente no cambia su publicación, y una ficha que Superadministración
  archivó sigue archivada. Superadministración puede publicarla a mano con la regla de este ADR. El catálogo
  público sigue filtrando por `is_published`.
- **RNC de la ficha.** `commercial.airline_profiles` guarda `tax_registration` y
  `tax_registration_country_code` (migración `20261116145344_AddAirlineProfileTaxRegistration`), validados
  con `TaxRegistrations`. No es evidencia de la identidad: cambiarlo no anula el check del registro ni la
  verificación manual.
- **Fichas AVIAM.** `AviamAirlineReference.Verified` usa, además de las seis identidades IATA, los códigos de
  la copia de OpenFlights del repositorio, cotejados por nombre. «Completar fichas AVIAM» se aplica a las
  fichas que ninguna persona editó: `updated_at` del seed, o solo auditorías `commercial.airline.enriched` y
  `commercial.airline.registry_checked`, sin aerolínea canónica. Nunca reutiliza un designador que otra ficha
  verificada tenga, y unos códigos nuevos limpian el check anterior.
