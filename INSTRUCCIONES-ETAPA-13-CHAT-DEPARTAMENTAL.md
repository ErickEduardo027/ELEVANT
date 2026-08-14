# Etapa 13 — Chat departamental integrado

Esta etapa agrega un canal persistente entre los departamentos del prototipo.

## Incluye

- Mensajes reales entre Contratos y Finanzas desde sus módulos de Comunicaciones.
- Persistencia en `backend-prototipo/data/database.json`.
- Selección del departamento destinatario.
- Actualización automática de la conversación cada cinco segundos.
- Registro de lectura de los mensajes recibidos.
- Notificación para el departamento destinatario.
- API preparada para Administrador/OCC y Gestión Humana; sus pantallas se conectarán al mismo canal en la próxima etapa.

## Rama base y rama de esta etapa

- Base: `Feat/bandeja-notificaciones`
- Nueva rama: `Feat/chat-departamental`

## Aplicar el parche

Ejecuta desde la raíz del repositorio:

```powershell
git status
git switch Feat/bandeja-notificaciones
git pull --ff-only origin Feat/bandeja-notificaciones
git switch -c Feat/chat-departamental

git apply --check "C:\ELEVANT-PARCHES\etapa-13-chat-departamental.patch"
git apply --index "C:\ELEVANT-PARCHES\etapa-13-chat-departamental.patch"
git diff --cached --check
```

Si `Feat/chat-departamental` ya existe localmente, usa:

```powershell
git switch Feat/chat-departamental
```

## Validar

Backend:

```powershell
cd backend-prototipo
npm test
cd ..
```

Web:

```powershell
cd frontend\web
npm ci
npm test -- --run
npm run build
cd ..\..
```

## Confirmar y subir

```powershell
git status
git commit -m "feat(prototipo): integrar chat entre Contratos y Finanzas"
git push -u origin HEAD
```

En GitHub crea el Pull Request con:

- `base`: `Feat/bandeja-notificaciones`
- `compare`: `Feat/chat-departamental`

## Prueba manual

1. Inicia el backend y la web.
2. Entra como Contratos y abre **Comunicaciones**.
3. Envía un mensaje a Finanzas.
4. Cierra sesión y entra como Finanzas.
5. Abre **Comunicaciones** y comprueba que aparece el mensaje.
6. Responde a Contratos y confirma la respuesta desde la cuenta de Contratos.
