# Application layer

Use cases are organized as vertical slices under `Features`. This layer depends only on `Elevant.Domain`; infrastructure implementations are injected through abstractions.

The future `CreateFlight` slice, for example, should keep its command, validator, handler and result together inside `Features/Flights/CreateFlight`. It is documentation only until its rules and public contract are agreed.
