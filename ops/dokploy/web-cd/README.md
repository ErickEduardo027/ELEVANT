# ELEVANT Development Web CD controller

This package promotes the two browser applications independently on the
Development VPS:

| Controller profile | Source application | Image / bundle repository suffix | Published port |
| --- | --- | --- | --- |
| `aviam-web` | `frontend/private-web` | `elevant-private-web` / `elevant-aviam-web-release-manifest` | loopback-only `18081` |
| `public-web` | `frontend/public-web` | `elevant-public-web` / `elevant-public-web-release-manifest` | loopback-only `18082` |

Both profiles use the same controller implementation but have separate
configuration, state, attempts, logs, images and release-manifest aliases.
Neither profile joins a SQL network. Browser clients call only the versioned
API. Tailscale Serve is the private ingress; Funnel, Dokploy Domains and
provider AutoDeploy remain off.

This directory is a reviewed template. Running its scripts against a real host
is a manual operator action and is outside repository automation.

## Release protocol

The active `development-certified` tag is discovery only. The controller first
resolves it to one immutable GHCR digest and then pulls that exact digest. A web
bundle is a scratch OCI image containing exactly:

```text
/manifest.json
/compose/compose.development.web.yml
```

After extraction the local validation directory must contain exactly
`manifest.json` and `compose.development.web.yml`. Payloads are regular,
non-symlink files between 1 byte and 1 MiB. The manifest has a closed v1 schema:

```json
{
  "schemaVersion": 1,
  "environment": "Development",
  "application": "aviam-web",
  "source": {
    "repository": "OWNER/REPOSITORY",
    "ref": "refs/heads/Development",
    "commit": "40_HEX",
    "runId": "POSITIVE_GITHUB_RUN_ID",
    "runAttempt": 1,
    "workflowUrl": "https://github.com/OWNER/REPOSITORY/actions/runs/RUN_ID"
  },
  "images": {
    "web": "ghcr.io/NAMESPACE/IMAGE@sha256:IMMUTABLE_DIGEST"
  },
  "compose": { "webSha256": "64_HEX" },
  "api": {
    "requiredManifest": "ghcr.io/NAMESPACE/elevant-api-release-manifest@sha256:DIGEST",
    "requiredRunId": "POSITIVE_GITHUB_RUN_ID",
    "requiredImage": "ghcr.io/NAMESPACE/elevant-api@sha256:DIGEST",
    "openApiSha256": "sha256:CANONICAL_JSON_DIGEST"
  },
  "build": { "configurationSha256": "sha256:DIGEST" },
  "endpoints": {
    "containerPort": 8080,
    "healthPath": "/healthz",
    "smokePaths": ["/healthz", "/", "/dashboard"]
  },
  "publishedAt": "RFC3339_UTC"
}
```

For `public-web`, the endpoint tuple is exactly port `3000`, health `/health`
and smoke paths `[/health, /, /login]`. Endpoint tuples are fixed by profile,
not selected by a release. The OpenAPI
fingerprint is `sha256:` plus SHA-256 of canonical JSON: object keys sorted
recursively, array order preserved and no insignificant whitespace.

The web image and bundle both carry these labels, which must agree with the
manifest and the configured source:

```text
org.opencontainers.image.revision
org.opencontainers.image.source
io.elevant.application
io.elevant.environment
io.elevant.source.run-id
io.elevant.api.required-manifest
io.elevant.openapi.sha256
```

The web image additionally carries `io.elevant.web.api-origin`, the browser
runtime's exact API base origin. It must equal the installed profile's
`ELEVANT_WEB_CD_EXPECTED_API_ORIGIN`, which is one canonical, non-loopback
HTTPS origin without a trailing slash. This check applies to adoption,
promotion and rollback, preventing a correctly signed image built for a
different API ingress from being activated.

The bundle additionally carries:

```text
io.elevant.web-release.schema-version=1
io.elevant.web-release.bundle-version=1
io.elevant.web-release.media-type=application/vnd.elevant.web-release-bundle.v1
```

Unexpected manifest keys, a mutable image, a byte-different Compose payload,
wrong labels or a non-Development source fail closed.

## Exact API gate

A web candidate is deployable only when all five facts match:

1. API CD `last-success.json` is `succeeded` at `complete`.
2. Its manifest digest and GitHub run ID exactly equal `requiredManifest` and
   `requiredRunId`.
3. Its immutable API image exactly equals `requiredImage`.
4. Exactly one running container has the configured API Compose project and
   service labels; it is healthy, has zero restarts and its configured image
   exactly equals `requiredImage`.
5. Swagger obtained from inside that exact API container's network namespace
   has the exact canonical `openApiSha256`.

An otherwise valid web candidate whose required API is not active is deferred
without recording an attempt. OpenAPI drift while API state claims the exact
release is treated as an integrity failure. This avoids guessing whether a
newer API remains compatible; a new web bundle can be certified against it.

The controller does **not** treat `127.0.0.1:18080` inside Dokploy as the VPS
host: container loopback is namespace-local. It selects the API by the exact
configured `com.docker.compose.project` and `com.docker.compose.service=api`
labels, verifies its identity, then starts a short-lived immutable
`docker.io/curlimages/curl@sha256:...` probe with
`--network container:API_ID`. The probe requests
`http://127.0.0.1:8080/swagger/v1/swagger.json` from that shared namespace and
is removed immediately. It is read-only, capability-free, constrained by
memory/CPU/PIDs, has no logging and can speak only HTTP. The API container is
re-inspected after the request to detect replacement or health drift.

Consequently, the Dokploy task never joins the API runtime network, the probe
does not join by network name, and no additional port is published. Pin the
reviewed probe image by digest in each installed profile; tags are rejected.

## Concurrency and failure behavior

Mutating commands acquire non-blocking locks in this global order:

```text
database controller -> API controller -> common web controller -> app profile
```

The order is protocol. Do not invert it in jobs or operator commands. Database,
API and either web cannot be recreated concurrently. The two web profiles also
cannot overlap, while their pause markers and histories remain independent.
Both profiles must use the canonical common lock
`/etc/dokploy/elevant/web-cd/state/controller.lock`; alternate paths are
rejected. The database and API locks are likewise fixed to their installed
controller paths under `/etc/dokploy/elevant/database-cd/state` and
`/etc/dokploy/elevant/api-cd/state`. The database, API, common-web and
selected-profile lock paths must also be pairwise distinct.

Only the selected image variable in the restricted Raw-resource `.env` is
changed. The controller never prints that file, rewrites the live Compose, runs
`docker compose down`, removes networks or touches the other application. It:

1. validates the bundle, image, exact API and live/certified Compose semantics;
2. pulls and certifies the candidate image, and proves the last-success image
   and cached Compose are already available locally, before changing `.env`;
3. runs `compose up -d --pull never --no-build --no-deps --force-recreate SERVICE`;
4. requires one healthy container with zero restarts whose configured image is
   exactly the expected immutable reference;
5. runs every certified smoke path inside that container;
6. atomically records `current`, `last-success` and the digest attempt.

Failure after deployment begins restores the prior immutable image with its
cached certified Compose, then repeats health and baseline smoke checks. A
successful rollback records the failed digest and disables automatic retries
for it. A rollback failure writes the failure and pauses only that profile.
Interrupted rollback-drill attempts are recovered only when the operator
supplies that same digest. Recovery validates the persisted A/B API tuple
against the active API using the already-local probe before restoring A. If
that gate does not pass, the attempt remains `running/interrupted`, the profile
remains paused and `--resume` is rejected until the exact API returns and
recovery is invoked again. A different requested digest is rejected without
mutation. There is no image pull after `.env` changes: both deployment and
rollback use only prevalidated local images with `--pull never`, so a registry
outage cannot turn an otherwise viable local rollback into `rollback_failed`.

An interrupted ordinary promotion is kept distinct from a rollback drill. On a
paused profile, the first `--resume` either reconciles an already committed
success locally or restores the prior certified baseline with the ordinary
rollback path. It records the result and deliberately leaves the profile
paused; a second `--resume` is required after operator review. Ambiguous state,
any `rollbackStatus=failed`, and every terminal rollback-drill failure remain
fail-closed and cannot clear the pause.

If an ordinary attempt is still running while its profile was not already
paused, the next automatic `--poll` performs the same local containment or
reconciliation before resolving the registry alias. That poll returns non-zero
and creates the pause marker. Every later automatic poll is an absolute no-op
until the operator reviews the state and explicitly resumes the profile.

The acceptance rollback drill is an explicit, paused-profile operation. Given
the exact advertised bundle digest, it requires a healthy accepted baseline A,
a strictly newer certified candidate B and exact equality of the API manifest,
run ID, image and OpenAPI fingerprint across A, B and the active API. It pulls,
caches and validates every required artifact before the first live mutation,
then performs B -> A -> B. Every leg uses `--pull never` and must pass container
health plus all certified smoke paths. Success leaves the profile paused with
`status=succeeded`, `stage=complete` and `rollbackStatus=succeeded`; the
operator must still inspect runtime and isolation before resuming it. Any
failure leaves the profile paused, restores A when possible and requires an
explicit operator action. The ordinary schedule is never used to manufacture
or simulate this drill.

## Install without enabling

From an operator-reviewed package on the VPS:

```bash
sudo bash ./install-controller
sudo /etc/dokploy/elevant/web-cd/verify-runtime --host-container dokploy
```

The installer preserves existing `config.aviam-web.env`,
`config.public-web.env` and all state. A first install creates restricted
placeholder configs. Replace every `REPLACE_*` value in those installed copies
only, retaining `root:root 0600`. Repository examples never contain live
resource names, tailnet names or credentials. Because upgrades preserve live
configs, an installation created before the API-origin gate must be updated
manually with `ELEVANT_WEB_CD_EXPECTED_API_ORIGIN` before validation or resume.

Before either controller is enabled, the operator separately creates:

- a Raw Compose resource with AutoDeploy off;
- its external runtime bridge network;
- a restricted `.env` containing exactly one immutable image setting plus any
  reviewed runtime settings;
- a loopback-only port mapping (`18081` or `18082`);
- private Tailscale Serve routing after its service approval.

The initial image and Compose are manually reviewed and tested before adoption.
No web resource gets a database network.

For a semantic Compose change on an adopted profile, disable its poll and pause
the profile first. Preserve restricted copies of the accepted A Raw text and
on-disk `ELEVANT_WEB_CD_COMPOSE`. Save the certified B Compose in Dokploy Raw
without deploying; reopen it and check the contents. Dokploy may leave the
on-disk Compose at A until deployment, so the operator must stage that same B
file there with an atomic replacement while the profile is paused. Do not
change `.env`, the image, or the running container during staging. Verify both
representations and run `--dry-run` before the explicit B -> A -> B drill. The
controller checks live/certified Compose semantics and never writes live Raw.
If the drill fails and A is restored, restore both A Compose representations
from the restricted copies before resuming or re-enabling the poll. Keep the
profile paused on any mismatch. The full operator sequence is in
[`docs/deployment/dokploy-configuration.md`](../../../docs/deployment/dokploy-configuration.md).

Each installed profile also records the exact API Compose project (not a
container name), fixed service `api`, container port `8080`, Swagger path and
an immutable `curlimages/curl` probe digest. It also records the exact private
HTTPS API origin expected by that web image. Both profiles must point at the
same existing API resource and normally use the same API origin. These are
identifiers, not credentials.

## Commands

Run inside the private Dokploy container or through a single validated Dokploy
task ID:

```bash
C=/etc/dokploy/elevant/web-cd/elevant-web-cd

$C --app aviam-web --status
$C --app aviam-web --dry-run
$C --app aviam-web --adopt-current
$C --app aviam-web --promote-with-rollback-drill sha256:64_HEX
$C --app aviam-web --poll
$C --app aviam-web --pause
$C --app aviam-web --resume

$C --app public-web --status
$C --app public-web --dry-run
$C --app public-web --adopt-current
$C --app public-web --promote-with-rollback-drill sha256:64_HEX
$C --app public-web --poll
```

`--adopt-current` is one-time only and refuses a pre-existing baseline. It
verifies image provenance, the exact active API, Compose validity, Docker
health and in-container smoke before writing `adopted-current`.

`--promote-with-rollback-drill` accepts only an exact `sha256:` bundle digest
that is currently advertised and strictly newer than the accepted baseline.
The selected profile must already be paused and remains paused whether the
command succeeds or fails. Do not run a normal poll after B is published and
before this command, because B must still be a new candidate for the drill. An
interrupted rollback-drill attempt must be recovered by invoking this command
with the digest reported by `--status`; `--resume` fails closed while the
current state or its matching digest attempt remains `running`. It also rejects
terminal drill failures and any failed rollback; a new or retried drill must
first finish successfully.

`--resume` is not a blind removal of the pause marker. If it finds an ordinary
promotion interrupted in `preflight`, `deploy`, `health` or `smoke`, it performs
or reconciles containment locally and remains paused. Review `--status`, then
invoke `--resume` a second time only after that result is safe. A running drill
must instead be recovered with its exact digest as described above.

`--dry-run` never changes the image or state. `--poll` makes accepted and
previously failed digests no-ops. A failed digest may be retried only when it is
still the advertised alias and the operator explicitly supplies:

```bash
$C --app aviam-web --retry sha256:64_HEX
```

## Schedules

Create two disabled Dokploy schedules. Keep each one disabled through controller
installation, adoption, a dry run against a strictly newer candidate, the safe
rollback drill and verification of controller state, runtime and isolation.
Only after a successful drill may the operator resume that profile, run its
disabled schedule manually and require a certified no-op, then enable it. Both
use cron `* * * * *`:

| Schedule | Command | Offset |
| --- | --- | --- |
| ELEVANT AVIAM Web CD - Poll | `jobs/aviam-web-poll.job.sh` | 30 seconds |
| ELEVANT Public Web CD - Poll | `jobs/public-web-poll.job.sh` | 45 seconds |

Database normally starts at second 0 and API at second 15. The sleeps reduce
ordinary contention; locks remain authoritative.

## Acceptance evidence

For each profile, retain sanitized evidence of:

- installed ownership and modes (`0700` directories, `0555` executables,
  `0600` configs/state/cached Compose);
- runtime verification and Compose `config --quiet`;
- immutable image and one healthy, zero-restart container;
- loopback-only listener and absence of SQL networks;
- API selection by one exact Compose project/service, immutable image equality
  and namespace-scoped OpenAPI probe with no extra published port;
- local health/smoke and private Tailscale HTTPS checks;
- controller adoption and a paused B -> A -> B promotion drill ending at
  `succeeded/complete` with `rollbackStatus=succeeded`;
- post-resume manual no-op before enabling the schedule, followed by an
  automatic no-op;
- API and database still healthy, no failed systemd units;
- post-reboot recovery, schedules resuming and Funnel remaining off.

The deployed frontends are Development previews. Their presence does not imply
that prototype-only authentication or business endpoints exist in the real API.
Never deploy `backend-prototipo` to make an unfinished screen appear functional.
