# Etapa 8 — Reportes financieros integrados

Esta etapa reemplaza los datos simulados del reporte financiero por información persistida del flujo real. Registra cada exportación y genera Excel compatible y vista de impresión PDF.

```powershell
git status
git switch Feat/backend-chat-integrado
git pull --ff-only origin Feat/backend-chat-integrado
git switch -c Feat/backend-reportes
git apply --check "C:\ELEVANT-PARCHES\etapa-8-reportes.patch"
git apply --index "C:\ELEVANT-PARCHES\etapa-8-reportes.patch"
git diff --check
cd backend-prototipo
npm test
cd ..
git commit -m "feat(prototipo): integrar reportes financieros y exportaciones"
git push -u origin HEAD
```

Pull request: base `Feat/backend-chat-integrado`, compare `Feat/backend-reportes`.
