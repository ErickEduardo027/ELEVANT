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
