# ELEVANT — Etapa 2: Gestión Humana y acceso móvil

Esta entrega amplía `Feat/backend-auth`. No incluye vuelos, asignaciones operativas ni checklist.

## Funcionalidad incluida

- Gestión Humana registra usuarios mediante su formulario existente.
- Al seleccionar el rol **Agente de Rampa**, se crea una cuenta móvil persistente.
- El correo registrado funciona como usuario móvil.
- Contraseña temporal del prototipo: `Elevant2026!`.
- Desactivar el usuario bloquea el inicio de sesión móvil.
- Reactivarlo restablece el acceso.
- La sesión del agente se conserva localmente en la aplicación.

## Preparar la rama

Desde la raíz del repositorio:

```powershell
git switch Feat/backend-auth
git pull --ff-only origin Feat/backend-auth
git switch -c Feat/backend-agentes
```

Extrae el ZIP sobre la raíz del repositorio y permite reemplazar los archivos indicados.

## Configurar el móvil

La aplicación física no puede conectarse a `localhost` de la computadora. Consulta la IPv4 del equipo:

```powershell
ipconfig
```

En `frontend/mobile-agent`, crea `.env` a partir de `.env.example` y sustituye la IP:

```text
EXPO_PUBLIC_API_URL=http://192.168.1.100:4310
```

El teléfono y la computadora deben estar en la misma red. El firewall debe permitir Node.js en redes privadas.

## Ejecutar

Terminal 1:

```powershell
cd backend-prototipo
npm start
```

Terminal 2:

```powershell
cd frontend\web
npm ci
npm run dev
```

Terminal 3:

```powershell
cd frontend\mobile-agent
npm ci
npx expo start --clear
```

## Probar el flujo

1. Inicia sesión en web como `gestionhumana@elevant.test` con `Elevant2026!`.
2. Registra un usuario con el rol **Agente de Rampa** y un correo único.
3. Abre ELEVANT Mobile.
4. Inicia sesión con el correo registrado y `Elevant2026!`.
5. Desactiva el usuario desde Gestión Humana y comprueba que el acceso móvil quede bloqueado.
6. Reactívalo y comprueba que pueda entrar nuevamente.

## Confirmar y subir

```powershell
git add backend-prototipo frontend/web/src/services/humanResourcesUsersService.js frontend/mobile-agent/.env.example frontend/mobile-agent/src/app frontend/mobile-agent/src/services/mobile-auth.ts ETAPA-2-INSTRUCCIONES.md
git commit -m "feat(prototipo): integrar agentes de rampa con acceso movil"
git push -u origin HEAD
```

En GitHub crea el Pull Request con:

- Base: `Feat/backend-auth`
- Compare: `Feat/backend-agentes`
