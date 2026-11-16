# Finance approved-service evidence slice

## Objective

Replace the synthetic AVIAM Finance approved-services table with a bounded,
station-scoped read of services belonging to OCC-approved operations. This
slice provides immutable billing evidence for a later preinvoice; it does not
create an invoice, accept a payment, or mark a row reviewed in browser memory.

## Contract and invariants

- `GET /api/v1/finance/approved-services?stationId&from&to` requires a live
  `FINANZAS` back-office role, AVIAM internal membership and station grant.
  The requested inclusive local operation-date interval is at most 31 days.
- Return up to 200 services in stable date/operation/line order, with
  `hasMore`. Each line carries public operation/turnaround/service ids,
  airline, flight, station, contract reference, status, approved submission,
  executed quantity, frozen unit/price/currency and a computed amount only
  when billable. A nonbillable line remains visible with an explicit reason.
- An OCC-approved operation with its latest approved submission is the sole
  evidence source. The API must not infer approval from a completed service
  alone or use a current mutable contract rate in place of the operation's
  snapshot. No cross-station or cross-role data is returned.
- AVIAM shows genuine empty/loading/error states and disables the old local
  "mark reviewed" action. Browser storage and prototype finance API are not
  authority.

## Execution

1. RED: policy and handler tests for billability, date bounds and access.
2. Implement the read store and SQL integration tests for approval, scope,
   snapshots, blocked rows and pagination.
3. Add HTTP/OpenAPI/shared-client tests and refresh the certified snapshot.
4. Replace the AVIAM table's local data service; test filters, status and
   permission/error behavior.
5. Run focused and affected full suites, Vault and secret checks, then commit
   this cohesive slice. Browser and full invoice/payment drills remain
   required before the broader cycle can be called complete.
