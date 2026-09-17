# Configuración móvil

`elevant-api.ts` lee y valida `EXPO_PUBLIC_ELEVANT_API_URL` y construye el
cliente OpenAPI compartido. Para cada operación autenticada obtiene el bearer
vigente desde SecureStore; el cliente no lo retiene ni lo registra. Los rechazos
de `fetch` se etiquetan como indisponibilidad de red para que solo ese caso pueda
usar caché. Cada solicitud tiene un límite de 15 segundos. Abortos, HTTP y
contratos malformados conservan otra clasificación.

La URL debe usar HTTPS. Solo durante desarrollo nativo se acepta HTTP hacia
direcciones loopback conocidas (`localhost`, `127.0.0.1`, `::1` y `10.0.2.2`).

Los valores `EXPO_PUBLIC_*` son configuración visible en el binario y nunca
contienen credenciales.
