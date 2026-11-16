# Operations agent guide

This subtree contains secret-free, reviewable templates for the ELEVANT Development control plane. It does not authorize an agent to connect to, mutate or deploy a VPS. The human operator executes every remote change manually and supplies sanitized evidence for the next checkpoint.

## Invariants

- Development control-plane access is private through Tailscale Services; Funnel stays off.
- Public ingress is limited to ICMP/ICMPv6 and UDP 41641 after bootstrap.
- Never publish SSH, Dokploy, monitoring, SQL Server, Docker API or Swarm ports.
- Manage only ELEVANT-owned firewall chains. Never flush or persist the complete Docker/Tailscale ruleset.
- Use immutable image digests. A tag may aid discovery but is not a deployment identity.
- Do not commit real emails, tailnet names, IP addresses, PAT, auth keys, notification URLs, passwords, connection strings, backups or generated state.
- A rollback must be installed and tested before a firewall or SSH cutover.
- SQL networks/volumes have a separate lifecycle and are never deleted by control-plane scripts.

## Change discipline

- Keep firewall, Tailscale and observability changes independently reviewable.
- Preserve placeholders in repository templates. Actual values live in the operator's password manager, Tailscale console or restricted Dokploy Environment.
- Update `docs/deployment/dokploy-configuration.md` whenever an operational contract changes.
- Prefer fail-closed validation and explicit phases over automatic detection that could widen ingress.

## Validation

Run, as applicable:

```text
bash -n <shell scripts>
shellcheck <shell scripts>
docker compose --env-file <example env> -f <compose> config --quiet
git diff --check
pwsh -File scripts/repository/check-secrets.ps1
```

A successful syntax check does not authorize deployment. Validate every live checkpoint, including IPv4/IPv6 external probes and a reboot, before accepting the host.
