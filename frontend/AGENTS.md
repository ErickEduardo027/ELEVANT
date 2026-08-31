# Frontend agent guide

The three applications have different audiences but one API and one logical database per environment:

- `private-web`: internal AVIAM staff, including OCC, administration and departments.
- `public-web`: airline customers; all operational data must be restricted to the authenticated organization and allowed stations by the server.
- `mobile-agent`: native ramp-agent tablet application for Android/iOS; the initial distributable is an APK and a later Production release may use Play Store/App Store channels.

No frontend may connect to SQL Server, call FlightAware directly, contain server credentials or treat browser/device storage as an authorization boundary. Tailscale controls Development network reachability but does not replace JWT, roles, tenant isolation or station scope in the API.

## Working with prototypes

Mocks are useful product evidence, not persistent-model definitions. Preserve user-visible vocabulary and workflows while mapping identifiers, relationships, history and authorization through API contracts. Do not persist duplicated arrays, derived counters or display labels merely because a fixture contains them.

Keep mock and remote adapters replaceable. Components should not decide which data source is active. Every remote view needs loading, success, empty, recoverable-error and unauthorized states. Treat server errors as Problem Details and never render internal exception text.

## Application-specific rules

- AVIAM Web is currently Vite 6 + React 18. Its public API variable is `VITE_PROTOTYPE_API_URL`; anything prefixed `VITE_` is visible in the browser.
- Public Web is Next.js 16 + React 19. Read its nested `AGENTS.md` and the installed Next documentation before code changes. `NEXT_PUBLIC_*` values are build-time public configuration, never secrets.
- Mobile Agent is Expo 54 + React Native. Native requests are not governed by browser CORS. Offline writes must send a stable device ID and idempotency key and reconcile the API result; local data is a cache, not the source of truth.

Use the npm commands and `package-lock.json` inside each application. Do not reuse obsolete pnpm/package-name assumptions from old workflow templates. Mobile builds produce signed install artifacts; the mobile application is not hosted as a web service on the VPS.

When an API contract changes, update OpenAPI/client generation and all affected consumers. Deploy independent clients only with backward-compatible API/database changes; otherwise coordinate an explicit API-first release.
