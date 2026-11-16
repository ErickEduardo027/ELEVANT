# Development preinvoice draft slice

## Boundary

Persist a non-fiscal draft from OCC-approved service evidence. A draft groups
one airline, station and currency over at most 31 operation dates. It is not
an invoice, tax document, payment request, receipt or external accounting
entry. No client may fabricate a draft from browser state.

## Invariants

- A live internal `FINANZAS` account with station grant is required to create
  and read a draft. Airline readers must later be tenant-scoped by their live
  membership and historical operation entitlement.
- The request contains a stable UUID idempotency key and 1–100 unique public
  operation-service IDs. A retry with the same key and payload returns the
  same draft; the same key with different content conflicts.
- Every selected service must belong to the requested airline/station and
  date interval, be in the latest OCC-approved submission and have unchanged
  approved execution evidence and frozen unit/price/currency. A blocked line
  rejects the whole request; it is never silently dropped.
- The draft and immutable line snapshots commit together. A unique source
  service key prevents overlapping drafts or double billing under races.
  All foreign keys are NO ACTION. The draft total equals its line amounts,
  uses decimal precision and excludes tax.
- A durable account-change hint is written in the same transaction for
  authorized Finance users. Read paths revalidate current access.

## Sequence

1. RED policy and handler tests for selection, amount, idempotency and scope.
2. Add EF entities/configuration and generate the additive migration using
   the repository script. Review SQL, constraints and clean/upgrade paths.
3. Implement transactional SQL writer, bounded reader and real SQL tests for
   duplicate requests, overlap, approval changes, station and airline scope.
4. Add HTTP/OpenAPI/shared client and AVIAM draft creation/read views; keep
   issuing, disputes, PDF, payment and receipt disabled until real endpoints.
5. Full affected suites, secret/Vault checks, and a cohesive feature commit.
