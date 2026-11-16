# Airline contract read vertical slice

**Goal:** Replace the Public Web contracts preview with authorized, historical contract data from the Development API. This is a read-only slice of the larger integrated cycle, not an invoice or contract-approval implementation.

## Contract and scope

- `GET /api/v1/airline/portal/contracts` derives exactly one airline organization from the current account's active airline-portal role and membership. It accepts no tenant identifier.
- Return published contract versions (`Approved` or later `Superseded`), including versions whose validity or parent contract has ended; this preserves the airline's own contract history. Do not expose drafts, rejected versions, other tenants or inactive airline organizations.
- Return bounded, paginated contract summaries with station coverage and service rates. Include stable public IDs, code, status, version number, validity, currency, rate unit, amount and minimum quantity. No synthetic values.
- API responses are private/no-store and use the existing 401/403/404 conventions.

## TDD sequence

1. RED SQL integration: own approved version and rates visible, expired history visible, another tenant absent, draft version absent, pagination deterministic.
2. GREEN persistence + application authorization + endpoint contract and API tests. Keep all predicates in SQL and use public IDs only in responses.
3. Regenerate certified OpenAPI and shared API client; test wrapper validation and typecheck.
4. RED Public Web route tests for a real contract list and honest empty state; GREEN connect contracts view with existing session, no simulated cards or active actions.
5. Run backend solution, API client and Public Web suites/build; update README and Vault note, regenerate inventory, inspect diff and commit. No VPS promotion in this slice.
