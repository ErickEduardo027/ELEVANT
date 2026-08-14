# Etapa 7 — Chat integrado Agente móvil ↔ OCC

## Resultado

- Los mensajes del agente entran en la cola local y se sincronizan automáticamente.
- El backend conserva conversaciones y mensajes en `runtime.json`.
- OCC recibe los mensajes en **Chat interno** y puede responder.
- El móvil consulta automáticamente las respuestas cada 5 segundos.
- Los reintentos usan `idempotencyKey`, por lo que no duplican mensajes.
- Se eliminan las respuestas simuladas del chat móvil y del chat OCC en ejecución real.

## Aplicación del parche

Ejecutar desde `C:\ELEVANT-DESARROLLO\ELEVANT`:

```powershell
git status
git switch Feat/backend-finanzas
git pull --ff-only origin Feat/backend-finanzas
git switch -c Feat/backend-chat-integrado

git apply --check "C:\ELEVANT-PARCHES\etapa-7-chat-integrado.patch"
git apply --index "C:\ELEVANT-PARCHES\etapa-7-chat-integrado.patch"
git diff --check
git status

cd backend-prototipo
npm test
cd ..

git commit -m "feat(prototipo): integrar chat entre agente móvil y OCC"
git push -u origin HEAD
```

## Pull request

- **base:** `Feat/backend-finanzas`
- **compare:** `Feat/backend-chat-integrado`

Después de fusionarlo, la rama de la próxima etapa debe crearse desde `Feat/backend-chat-integrado`.

## Prueba manual

1. Iniciar backend, web y aplicación móvil.
2. Iniciar sesión móvil con un agente creado y habilitado por Gestión Humana.
3. Abrir **Chat con OCC** y enviar un mensaje.
4. Esperar unos segundos y abrir **Chat interno** en OCC.
5. Seleccionar al agente y responder.
6. Regresar al chat móvil; la respuesta debe aparecer automáticamente en un máximo aproximado de 5 segundos.

La PC y el teléfono deben apuntar al mismo backend. En el archivo `.env` móvil, `EXPO_PUBLIC_API_URL` debe usar la IP local de la PC, no `localhost`.
