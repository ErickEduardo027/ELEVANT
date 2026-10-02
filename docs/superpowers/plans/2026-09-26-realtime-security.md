# Realtime Hub Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing SignalR route identify accounts from the actual `sub` claim and reject browser WebSocket origins outside the configured allowlist.

**Architecture:** The API host owns SignalR identity and handshake protection. JWT validation remains the authentication boundary; Origin is an additional browser cross-origin guard. These pieces precede the durable change-feed and dispatcher plans.

**Tech Stack:** .NET 10, ASP.NET Core SignalR, xUnit v3, API integration tests.

**Spec:** `docs/superpowers/specs/2026-09-26-integrated-development-cycle.md`

## Global Constraints

- The API and SQL Server remain shared by three clients; no client may trust its own role, tenant or station claims.
- Existing JWTs contain one `sub` GUID and no `ClaimTypes.NameIdentifier` because `MapInboundClaims=false`.
- The API Development route remains private over Tailscale; no Production change.
- No access token or query string containing one may enter logs or test artifacts.

## Review Focus

- A missing, duplicated or malformed `sub` must yield no SignalR user ID; Task 1 tests each.
- A NameIdentifier claim inconsistent with `sub` must not redirect events; Task 1 tests it.
- An unexpected or malformed Origin must fail a WebSocket handshake; Task 2 tests both.
- A native client without Origin must still authenticate by JWT; Task 2 tests this.
- HTTP CORS behavior must remain unchanged; Task 2 runs the existing API suite.

---

### Task 1: Resolve SignalR account identity

**Files:**
- Create: `backend/Elevant.Api/Hubs/AccountHubUserIdProvider.cs`
- Create: `backend/tests/Elevant.IntegrationTests/Api/AccountHubUserIdProviderTests.cs`
- Modify: `backend/Elevant.Api/Extensions/ServiceCollectionExtensions.cs`

**Interfaces:**
- Consumes: JWT `sub` issued by `JwtAccessTokenIssuer`.
- Produces: `AccountHubUserIdProvider : IUserIdProvider`; `Resolve(ClaimsPrincipal?)` returns a canonical GUID string or null.

- [ ] **Step 1: Write failing tests**

```csharp
Assert.Equal(accountId.ToString("D"), AccountHubUserIdProvider.Resolve(
    new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", accountId.ToString("D"))]))));
Assert.Null(AccountHubUserIdProvider.Resolve(new ClaimsPrincipal()));
Assert.Null(AccountHubUserIdProvider.Resolve(new ClaimsPrincipal(
    new ClaimsIdentity([new Claim("sub", accountId.ToString("D")), new Claim("sub", accountId.ToString("D"))]))));
```

- [ ] **Step 2: Verify RED**

Run: `dotnet test backend/tests/Elevant.IntegrationTests/Elevant.IntegrationTests.csproj --configuration Release --no-restore --filter FullyQualifiedName~AccountHubUserIdProviderTests`
Expected: compilation fails because `AccountHubUserIdProvider` does not exist.

- [ ] **Step 3: Implement minimal provider and DI registration**

```csharp
public string? GetUserId(HubConnectionContext connection) => Resolve(connection.User);
```

`Resolve` accepts exactly one nonempty `sub` GUID and returns `D` format; register it as `IUserIdProvider` with singleton lifetime.

- [ ] **Step 4: Verify GREEN**

Run: `dotnet test backend/Elevant.sln --configuration Release --no-restore`
Expected: all unit, architecture and integration tests pass.

- [ ] **Step 5: Commit**

Run: `git add backend/Elevant.Api/Hubs/AccountHubUserIdProvider.cs backend/Elevant.Api/Extensions/ServiceCollectionExtensions.cs backend/tests/Elevant.IntegrationTests/Api/AccountHubUserIdProviderTests.cs && git commit -m "feat(realtime): resolve hub users from JWT subject"`

### Task 2: Guard WebSocket Origin

**Files:**
- Create: `backend/Elevant.Api/Hubs/HubOriginGuard.cs`
- Create: `backend/tests/Elevant.IntegrationTests/Api/HubOriginGuardTests.cs`
- Modify: `backend/Elevant.Api/Extensions/ApplicationBuilderExtensions.cs`

**Interfaces:**
- Consumes: existing `Cors:AllowedOrigins` exact origins.
- Produces: `HubOriginGuard.IsAllowed(PathString, bool, StringValues, string[])`; middleware returning 403 for disallowed browser WebSocket handshakes on `/hubs/*` while leaving native clients without Origin to JWT authentication.

- [ ] **Step 1: Write failing tests**

```csharp
Assert.True(HubOriginGuard.IsAllowed("/hubs/operations", true,
    "https://private-web.elevant.test", ["https://private-web.elevant.test"]));
Assert.False(HubOriginGuard.IsAllowed("/hubs/operations", true,
    "https://evil.test", ["https://private-web.elevant.test"]));
Assert.True(HubOriginGuard.IsAllowed("/hubs/operations", true,
    StringValues.Empty, ["https://private-web.elevant.test"]));
```

- [ ] **Step 2: Verify RED**

Run: `dotnet test backend/tests/Elevant.IntegrationTests/Elevant.IntegrationTests.csproj --configuration Release --no-restore --filter FullyQualifiedName~HubOriginGuardTests`
Expected: compilation fails because `HubOriginGuard` does not exist.

- [ ] **Step 3: Implement exact-origin guard**

```csharp
if (!HubOriginGuard.IsAllowed(context.Request.Path,
    context.WebSockets.IsWebSocketRequest, context.Request.Headers.Origin,
    allowedOrigins)) { context.Response.StatusCode = 403; return; }
```

Reject `null`, wildcard, malformed and multi-value Origin when present; do not replace JWT authentication.

- [ ] **Step 4: Verify GREEN**

Run: `dotnet test backend/Elevant.sln --configuration Release --no-restore`
Expected: all unit, architecture and integration tests pass.

- [ ] **Step 5: Commit**

Run: `git add backend/Elevant.Api/Hubs/HubOriginGuard.cs backend/Elevant.Api/Extensions/ApplicationBuilderExtensions.cs backend/tests/Elevant.IntegrationTests/Api/HubOriginGuardTests.cs && git commit -m "feat(realtime): validate browser hub origins"`
