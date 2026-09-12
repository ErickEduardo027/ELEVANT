# ELEVANT Vault agent guide

The Vault is the committed, shared knowledge entry point for people and agents.
It is written primarily in Spanish and must remain readable in both GitHub and
Obsidian without community plugins.

## Evidence and status

- Read `README.md`, `00-inicio/home.md` and the relevant map before editing a
  note.
- Verify every claim against the sources listed in the note frontmatter. Follow
  the source precedence documented in `08-gobernanza/fuentes-y-evidencia.md`.
- Use `repo-verified` only for facts checked against repository evidence and
  `operator-recorded` only for sanitized operational acceptance already
  documented by the operator.
- Mark missing human context as `unknown`. Never infer a product origin,
  requirement, deployment or implementation from a title, mock or plan.
- Preserve the distinction between current, prototype, historical, deferred
  and future behavior.

## Editing rules

- Every note uses the complete frontmatter contract and a globally unique
  kebab-case `id`.
- Use standard relative Markdown links rather than wiki-link-only syntax.
- Keep executable commands in their reviewed code-adjacent runbook. Vault
  pages explain intent, prerequisites, decision points and link to that source.
- Pair native Canvas or Bases views with a Markdown/Mermaid representation for
  GitHub readers.
- Never include real credentials, PII, private FQDNs, IP addresses, container
  IDs, secret-bearing output or unsanitized runtime evidence.
- Do not edit files under `_generated` by hand.

## Validation

From the repository root, regenerate derived inventory when sources change and
then run the checks:

```text
npm run vault:generate
npm run vault:check
npm run check
```

Generated files are committed only when their source inventory changed. A
change is incomplete while the generator leaves a diff or any Vault check
fails.
