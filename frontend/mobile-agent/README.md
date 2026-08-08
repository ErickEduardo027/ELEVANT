# Elevant Mobile Agent

## Prototipo funcional

Esta versión incluye un prototipo navegable para demostrar el trabajo del Agente de Rampa:

- inicio de sesión local;
- vuelos y tareas asignadas;
- inicio y fin de atención operativa;
- checklist del puente de abordaje;
- registro de incidencias y fotografías;
- almacenamiento local de operaciones pendientes;
- pantalla de conectividad y sincronización simulada.

La aplicación usa datos de demostración. Todavía no autentica contra la API ni envía información al backend.

## Cómo abrirlo por primera vez en Windows

1. Instalar Node.js LTS desde `https://nodejs.org`.
2. Instalar **Expo Go** en el teléfono Android o iPhone.
3. Abrir PowerShell en la carpeta `frontend/mobile-agent`.
4. Ejecutar:

```powershell
npm install
npx expo start
```

No es necesario ejecutar `npm install` ni crear `node_modules` en la raíz de
ELEVANT. `metro.config.js` mantiene la resolución de dependencias dentro de
`frontend/mobile-agent`, respetando los límites de trabajo del repositorio.

Si Metro informa que no puede resolver `expo-asset`, ejecutar solamente dentro
de `frontend/mobile-agent`:

```powershell
npx expo install expo-asset
npx expo start --clear
```

5. Conectar la computadora y el teléfono a la misma red Wi-Fi.
6. Escanear el código QR con Expo Go. En iPhone también puede escanearse con la cámara.

Si la red bloquea la conexión local, usar:

```powershell
npx expo start --tunnel
```

Para probarlo en el navegador, presionar `w` en la terminal después de iniciar Expo.

### Datos de demostración

- Usuario: `agente.rampa`
- Contraseña: `123456`

La pantalla acepta cualquier usuario y contraseña no vacíos porque la autenticación real está pendiente.

## Antes de subir los cambios a GitHub

Crear una rama propia para no modificar directamente la rama principal:

```powershell
git checkout -b feature/mobile-agent-prototype
git add frontend/mobile-agent
git commit -m "feat: add mobile agent functional prototype"
git push -u origin feature/mobile-agent-prototype
```

Después, solicitar al administrador del repositorio que revise o integre la rama mediante un Pull Request.

Esqueleto de la aplicación móvil para agentes. Se prevé Expo y Expo Router, pero `create-expo-app` no se ejecuta todavía para evitar fijar versiones y decisiones antes de contar con una feature móvil implementable.

Eliezer es responsable de `frontend/mobile-agent`. La aplicación consumirá normalmente
`https://api-dev.elevant.com` y no necesita que él ejecute el backend ni
instale SQL Server localmente.

## Límite de la aplicación

La aplicación consume la API Elevant por HTTPS y recibe notificaciones operativas mediante SignalR. Nunca se conecta directamente a SQL Server ni a FlightAware. Las variables `EXPO_PUBLIC_*` se incluyen en la aplicación instalada y no pueden guardar secretos.

Los tokens de sesión futuros deben residir en almacenamiento seguro de la plataforma. No deben guardarse en variables públicas, código fuente, AsyncStorage sin protección, logs ni reportes de errores.

## Configuración local

1. Copiar `.env.example` al archivo local aceptado por Expo.
2. Usar una URL alcanzable desde la tablet o el emulador; `localhost` apunta al propio dispositivo y normalmente no alcanza la API del equipo de desarrollo.
3. Mantener el archivo local fuera de Git.
4. No incluir claves de firma de APK, tokens ni credenciales de proveedor.

## Estructura prevista

- `src/app`: rutas de Expo Router cuando se inicialice el proyecto.
- `src/components`: interfaz reutilizable.
- `src/features`: flujos por capacidad operativa.
- `src/hooks`: hooks reutilizables de la aplicación.
- `src/config`: lectura y validación de configuración pública.
- `src/services`: adaptadores de cámara, archivos y capacidades del dispositivo.
- `src/storage`: persistencia local y almacenamiento seguro.
- `src/database`: esquema y migraciones del almacenamiento local.
- `src/synchronization`: outbox, reintentos e idempotencia.
- `src/types`: tipos de interfaz y capacidades nativas.
- `src/assets`: recursos públicos empaquetados en la aplicación.
- `tests`: configuración, dobles y pruebas transversales.

## Operación sin conexión

Las acciones que puedan ocurrir con conectividad intermitente deben escribirse primero en una outbox local. Cada operación requiere un identificador idempotente estable, estado de sincronización, contador de intentos y fecha del último error. Al recuperar red, un worker envía operaciones en orden seguro y acepta que el servidor confirme una operación ya procesada.

No se debe prometer soporte offline para datos que no hayan sido almacenados previamente. La interfaz distingue entre pendiente, sincronizando, confirmado y requiere intervención.

## Cámara y evidencias

- solicitar permisos justo antes de usar la cámara;
- conservar únicamente los archivos necesarios para el flujo autorizado;
- no registrar rutas locales, metadatos sensibles ni contenido en logs;
- subir mediante un contrato de API autenticado, con límites de tamaño y tipo;
- borrar la copia temporal solo después de una confirmación persistente;
- documentar retención y acceso antes de habilitar evidencias reales.

## SignalR

SignalR sirve para avisos servidor-cliente y actualización de interfaz; no reemplaza la API REST como fuente de verdad. Después de reconectar, la aplicación vuelve a consultar el estado por REST. Debe tolerar mensajes duplicados, fuera de orden y conexiones perdidas.

## Entrega a tablet

Antes de generar una APK se deben definir identificador de aplicación, canales de firma, ambientes, estrategia de actualización y custodia de claves. Una APK de Development nunca comparte URL, credenciales ni almacenamiento con Production.

Mobile Agent no se aloja como una aplicación web en el VPS. La APK se compila, se
instala en la tablet y consume mediante HTTPS la API que está alojada en el KVM.
