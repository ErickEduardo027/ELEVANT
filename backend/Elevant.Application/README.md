# Application layer

Use cases are organized as vertical slices under their capability, such as
`Identity` and `Operations`. This layer depends only on `Elevant.Domain`;
infrastructure implementations are injected through abstractions.

OCC planning keeps snapshot and options queries in separate slices. Persistence
returns internal read models through `IOccPlanningReadStore`; the application
revalidates the actor, selects safe scope defaults and evaluates stable agent
eligibility reasons before the API maps the result to public contracts.
