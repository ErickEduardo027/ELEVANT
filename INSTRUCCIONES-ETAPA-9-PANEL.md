# Etapa 9 — Panel de desarrollo ocultable

El panel de estados simulados de OCC inicia oculto, se abre desde el botón flotante inferior derecho y recuerda su estado durante la sesión del navegador.

```powershell
git status
git switch Feat/backend-reportes
git pull --ff-only origin Feat/backend-reportes
git switch -c Feat/panel-desarrollo-ocultable
git apply --check "C:\ELEVANT-PARCHES\etapa-9-panel-ocultable.patch"
git apply --index "C:\ELEVANT-PARCHES\etapa-9-panel-ocultable.patch"
git diff --check
cd backend-prototipo
npm test
cd ..
git commit -m "fix(web): permitir ocultar el panel de vista previa"
git push -u origin HEAD
```

Pull request: base `Feat/backend-reportes`, compare `Feat/panel-desarrollo-ocultable`.
