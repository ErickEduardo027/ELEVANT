# Cliente API compartido

`@elevant/api-client` es el cliente TypeScript privado y sin dependencias de
ejecución que comparten Private Web, Public Web y Mobile Agent. El contrato se
genera con Orval `8.27.0` desde un snapshot OpenAPI revisado; los consumidores
importan TypeScript fuente y configuran una instancia por contexto o petición.

## Uso

```ts
import { createElevantApiClient } from "@elevant/api-client";

const api = createElevantApiClient({
  baseUrl: "https://api.example.test",
  getAccessToken: async () => session.accessToken,
});

const status = await api.getSystemPing({ signal: abortController.signal });
```

`baseUrl` debe ser un origen HTTP(S) absoluto sin ruta final. El callback de
token se ejecuta para cada petición; el cliente no persiste ni registra el
valor. `fetch` y `defaultHeaders` se pueden inyectar para SSR, Expo y pruebas.
Los encabezados `Authorization` duraderos se rechazan: use `getAccessToken`.

Los fallos HTTP y las respuestas malformadas producen `ElevantApiError`. El
error expone solo `status`, un `title` saneado y el `traceId` opcional. Su
mensaje nunca incorpora el token, URL, cuerpo crudo ni `ProblemDetails.detail`.
Un `AbortError` conserva su identidad para que cada consumidor pueda cancelar.

## Contrato y generación

- `openapi/elevant-v1.json`: snapshot canónico certificado.
- `openapi/source.json`: commit, ejecución e imagen inmutable de procedencia.
- `generated/elevant-api.ts`: salida determinista de Orval; no se edita a mano.
- `src`: fábrica y transporte compartido, sin dependencias de ejecución.

La generación requiere Node.js 24 y npm:

```bash
npm ci
npm run generate
npm run check
```

Para comparar estructuralmente el snapshot con un archivo o una API local:

```bash
npm run check:openapi -- ./swagger.json
npm run check:openapi -- http://127.0.0.1:8080/swagger/v1/swagger.json
```

La comparación ignora espacios y el orden de propiedades JSON, pero detecta
cualquier otra deriva. CI no usa Tailscale: compila el backend del commit, lo
inicia localmente en `Testing` y compara su documento. Un cambio incompatible
exige versionar el endpoint o coordinar la migración de los tres consumidores.
