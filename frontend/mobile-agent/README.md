# Elevant Mobile Agent

Aplicación nativa para agentes de rampa en tablets Android/iOS. Usa Expo 54, Expo Router y React Native. La primera distribución prevista es una APK firmada para pruebas; posteriormente se prepararán canales de Play Store y, cuando corresponda, App Store. No se aloja como aplicación web en el VPS.

## Estado actual

El prototipo permite explorar:

- inicio de sesión contra el backend prototipo;
- vuelos/turnarounds y tareas asignadas;
- inicio y cierre de atención;
- checklists y hitos;
- incidencias y selección de fotografías;
- cola local y sincronización con conectividad intermitente;
- chat y estado de red demostrativos.

Todavía no consume los contratos de `Elevant.Api` .NET ni constituye autenticación productiva. La memoria local es una caché/outbox del dispositivo, no la fuente de verdad.

## Ejecutar

Desde `frontend/mobile-agent`:

```powershell
npm install
npm run start
npm run lint
npm run typecheck
npm run test:api-client-bundle
```

También puede usar `npm run android`, `npm run ios` o `npm run web` para desarrollo. Expo Go sirve para la exploración temprana, pero las capacidades y permisos finales deben verificarse en un development build/app firmada.

Copie `.env.example` a su archivo local y use una URL alcanzable desde la tablet:

```text
EXPO_PUBLIC_ELEVANT_API_URL=https://<PRIVATE_API_SERVICE>.<TAILNET_DNS_NAME>.ts.net
EXPO_PUBLIC_API_URL=http://<DEV_LAN_IP>:4310
```

`EXPO_PUBLIC_ELEVANT_API_URL` configura el cliente OpenAPI compartido; `EXPO_PUBLIC_API_URL` conserva temporalmente los adaptadores del prototipo. `localhost` desde la tablet se refiere a la propia tablet. La tablet de prueba deberá poder acceder al tailnet para alcanzar la API privada de Development. `EXPO_PUBLIC_*` se incluye en el binario y nunca contiene secretos.

## Autorización y almacenamiento

La API determina la cuenta, el perfil de agente y las estaciones autorizadas. El dispositivo no puede ampliar ese scope enviando otro agent/person/station ID. Los tokens futuros deben almacenarse con mecanismos seguros de la plataforma, no en variables públicas, código, logs o AsyncStorage sin protección.

Las evidencias reales están deshabilitadas hasta definir almacenamiento S3-compatible, tamaño/tipos, retención y autorización. SQL Server no almacenará binarios; una futura tabla conservará solo metadatos y object keys.

## Sincronización offline

Cada escritura offline debe conservar:

- un identificador estable del dispositivo registrado;
- una clave de idempotencia estable por comando;
- tipo, payload/versionado y momento local;
- estado pendiente/sincronizando/confirmado/requiere intervención;
- intentos y último error sanitizado.

El servidor registra la combinación dispositivo + clave y devuelve el mismo resultado ante reintentos. REST recupera el estado canónico después de reconectar; SignalR solo acelera avisos y puede llegar duplicado o fuera de orden.

## Entrega APK y tiendas

Antes de una APK compartida se deben fijar application ID, perfil Development, custodia de claves, versión, permisos, URL API y estrategia de actualización. Las claves de firma nunca se suben a Git. Un build Development no comparte URL, credenciales, storage ni firma con Production.

Play Store/App Store será una fase posterior con identificadores estables, políticas de privacidad, ficha, firma administrada, pruebas internas/cerradas y promoción controlada. La URL privada del tailnet no se usará como endpoint de una app pública de Production.
