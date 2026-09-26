using System.Data;
using System.Text.Json;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Persistence.Identity;
using Elevant.Infrastructure.Persistence;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Elevant.Persistence.Operations;

/// <summary>Commits the initial OCC assignment as one scoped, serialized transition.</summary>
internal sealed class EfOccPlanningCommandStore(
    ElevantDbContext context,
    TimeProvider timeProvider) : IOccPlanningCommandStore
{
    private const string PrimaryAssignmentRole = "primary";
    private const string TurnaroundChecklistCode = "TURNAROUND-BASE";
    private const string PassengerBridgeServiceCode = "PASSENGER-BRIDGE";

    public async Task<OccAssignmentWriteResult> AssignOperationAsync(
        OccAssignmentWriteRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var strategy = context.Database.CreateExecutionStrategy();
        OccAssignmentWriteResult? attemptResult = null;
        try
        {
            return await strategy.ExecuteInTransactionAsync(
                async operationCancellationToken =>
                {
                    context.ChangeTracker.Clear();
                    attemptResult = await AssignInsideTransactionAsync(
                        request,
                        operationCancellationToken);
                    if (!attemptResult.IsSuccess)
                    {
                        context.ChangeTracker.Clear();
                    }

                    return attemptResult;
                },
                async verificationCancellationToken =>
                {
                    context.ChangeTracker.Clear();
                    if (attemptResult is null || !attemptResult.IsSuccess)
                    {
                        return attemptResult is not null;
                    }

                    return attemptResult.CommitReceiptId is Guid receiptId &&
                        await context.AuditEntries
                            .AsNoTracking()
                            .AnyAsync(
                                entry => entry.PublicId == receiptId &&
                                    entry.CorrelationId == request.CorrelationId &&
                                    entry.Action == "occ.operation.assigned",
                                verificationCancellationToken);
                },
                IsolationLevel.Serializable,
                cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return OccAssignmentWriteResult.Failed(
                OccAssignmentWriteFailure.PreconditionFailed);
        }
        catch (RetryLimitExceededException exception) when (
            IsSerializationConflict(exception))
        {
            context.ChangeTracker.Clear();
            return OccAssignmentWriteResult.Failed(OccAssignmentWriteFailure.Conflict);
        }
        catch (DbUpdateException exception) when (IsOperationalConflict(exception))
        {
            context.ChangeTracker.Clear();
            return OccAssignmentWriteResult.Failed(OccAssignmentWriteFailure.Conflict);
        }
        catch (SqlException exception) when (IsSerializationConflict(exception.Number))
        {
            context.ChangeTracker.Clear();
            return OccAssignmentWriteResult.Failed(OccAssignmentWriteFailure.Conflict);
        }
    }

    private async Task<OccAssignmentWriteResult> AssignInsideTransactionAsync(
        OccAssignmentWriteRequest request,
        CancellationToken cancellationToken)
    {
        var allowedStationIds = request.AllowedStationIds
            .Where(id => id != Guid.Empty)
            .Distinct()
            .ToArray();
        if (allowedStationIds.Length == 0)
        {
            return NotFound();
        }

        var now = timeProvider.GetUtcNow();
        var liveActor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(request.ActorAccountId, cancellationToken);
        if (liveActor is null ||
            !liveActor.Roles.Any(role =>
                string.Equals(role.Code, "ADMIN_OCC", StringComparison.Ordinal) &&
                role.Portal == PortalKind.BackOffice) ||
            !liveActor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff))
        {
            return NotFound();
        }

        var liveStationIds = liveActor.StationScopes
            .Select(item => item.StationId)
            .ToHashSet();
        var stationPublicIds = allowedStationIds
            .Where(liveStationIds.Contains)
            .ToArray();
        if (stationPublicIds.Length == 0)
        {
            return NotFound();
        }

        var scope = await (
                from turnaround in context.Turnarounds.AsNoTracking()
                join station in context.Stations.AsNoTracking()
                    on turnaround.StationId equals station.Id
                join airline in context.Airlines.AsNoTracking()
                    on turnaround.AirlineId equals airline.Id
                join actorAccount in context.Users.AsNoTracking()
                    on request.ActorAccountId equals actorAccount.PublicId
                where turnaround.PublicId == request.TurnaroundId &&
                      stationPublicIds.Contains(station.PublicId) &&
                      station.IsActive &&
                      context.AccountStationScopes.AsNoTracking().Any(actorScope =>
                          actorScope.AccountId == actorAccount.Id &&
                          actorScope.StationId == station.Id &&
                          actorScope.GrantedAt <= now &&
                          actorScope.RevokedAt == null)
                select new AssignmentScope(
                    turnaround.Id,
                    turnaround.PublicId,
                    turnaround.AirlineId,
                    turnaround.OperationDate,
                    turnaround.CurrentStatus,
                    station.Id,
                    airline.OrganizationId,
                    actorAccount.Id))
            .SingleOrDefaultAsync(cancellationToken);
        if (scope is null)
        {
            return NotFound();
        }

        var operation = await context.GroundOperations
            .FromSqlInterpolated($"""
                SELECT *
                FROM [ops].[ground_operations] WITH (UPDLOCK, HOLDLOCK)
                WHERE [turnaround_id] = {scope.TurnaroundInternalId}
                """)
            .SingleOrDefaultAsync(cancellationToken);
        if (operation is null)
        {
            return Conflict();
        }

        if (!OccPlanningAssignmentPolicy.CanAssign(
                scope.TurnaroundStatus,
                operation.CurrentStatus,
                operation.PlannedStartAt,
                operation.PlannedEndAt))
        {
            return PreconditionFailed();
        }

        // Serialize all initial assignments for this agent, including assignments to
        // different operations whose planned windows could overlap.
        var agent = await context.RampAgents
            .FromSqlInterpolated($"""
                SELECT *
                FROM [hr].[ramp_agents] WITH (UPDLOCK, HOLDLOCK)
                WHERE [public_id] = {request.AgentId}
                """)
            .SingleOrDefaultAsync(cancellationToken);
        if (agent is null)
        {
            return Conflict();
        }

        var optionsResult = await new EfOccPlanningReadStore(context, timeProvider)
            .GetOptionsAsync(
                stationPublicIds,
                request.TurnaroundId,
                cancellationToken);
        if (!optionsResult.IsSuccess)
        {
            return optionsResult.Failure == OccPlanningOptionsReadFailure.NotFound
                ? NotFound()
                : Conflict();
        }

        var options = optionsResult.Options!;
        if (!OccPlanningConcurrencyToken.Matches(
                options.Turnaround.ConcurrencyToken,
                request.ExpectedContextVersion))
        {
            return PreconditionFailed();
        }

        var candidate = options.AgentCandidates.SingleOrDefault(item => item.Id == request.AgentId);
        if (candidate is null ||
            candidate.OperationalPositionId is null ||
            !OccAgentEligibilityPolicy.Evaluate(candidate).Eligible)
        {
            return Conflict();
        }

        var position = await context.OperationalPositions
            .AsNoTracking()
            .Where(item =>
                item.PublicId == candidate.OperationalPositionId.Value &&
                item.IsActive)
            .Select(item => new PositionProjection(
                item.Id,
                item.PublicId,
                item.Code,
                item.Name))
            .SingleOrDefaultAsync(cancellationToken);
        if (position is null)
        {
            return Conflict();
        }

        var applicableContracts = await (
                from contract in context.Contracts.AsNoTracking()
                join version in context.ContractVersions.AsNoTracking()
                    on contract.Id equals version.ContractId
                where contract.AirlineId == scope.AirlineId &&
                      contract.Status == ContractStatus.Active &&
                      (contract.SignedOn == null || contract.SignedOn <= scope.OperationDate) &&
                      (contract.TerminatedOn == null || contract.TerminatedOn >= scope.OperationDate) &&
                      version.Status == ContractVersionStatus.Approved &&
                      version.ValidFrom <= scope.OperationDate &&
                      (version.ValidTo == null || version.ValidTo >= scope.OperationDate) &&
                      context.Set<ContractVersionStation>().AsNoTracking().Any(link =>
                          link.ContractVersionId == version.Id &&
                          link.StationId == scope.StationInternalId)
                orderby version.VersionNumber descending, version.PublicId
                select new ApplicableContractProjection(
                    contract.PublicId,
                    version.Id,
                    version.VersionNumber,
                    version.CurrencyCode))
            .Take(2)
            .ToArrayAsync(cancellationToken);
        if (applicableContracts.Length != 1)
        {
            return Conflict();
        }

        var applicableContract = applicableContracts[0];
        var contractedServices = await (
                from rate in context.ContractServiceRates.AsNoTracking()
                join definition in context.ServiceDefinitions.AsNoTracking()
                    on rate.ServiceDefinitionId equals definition.Id
                where rate.ContractVersionId == applicableContract.ContractVersionId &&
                      definition.IsActive
                orderby definition.Name, definition.Code, definition.PublicId
                select new ContractedServiceProjection(
                    rate.Id,
                    rate.PublicId,
                    definition.Id,
                    definition.PublicId,
                    definition.Code,
                    definition.Name,
                    rate.BillingUnit,
                    rate.MinimumQuantity,
                    rate.UnitPrice,
                    applicableContract.CurrencyCode))
            .ToArrayAsync(cancellationToken);
        if (contractedServices.Length == 0 ||
            options.Contract is null ||
            options.Contract.Id != applicableContract.ContractPublicId ||
            options.Contract.Version != applicableContract.VersionNumber ||
            options.Services.Count != contractedServices.Length ||
            !options.Services.Select(item => item.Id)
                .SequenceEqual(contractedServices.Select(item => item.RatePublicId)))
        {
            return Conflict();
        }

        var hasExistingAssignment = await context.OperationAgentAssignments
            .AsNoTracking()
            .AnyAsync(
                assignment =>
                    assignment.GroundOperationId == operation.Id &&
                    assignment.ReleasedAt == null,
                cancellationToken);
        if (hasExistingAssignment)
        {
            return Conflict();
        }

        var existingServices = await context.OperationServices
            .Where(service => service.GroundOperationId == operation.Id)
            .OrderBy(service => service.LineNumber)
            .ToArrayAsync(cancellationToken);
        var materializedServices = ReconcileServices(
            operation.Id,
            contractedServices,
            existingServices,
            now);
        if (materializedServices is null)
        {
            return Conflict();
        }

        MaterializedChecklist? materializedChecklist = null;
        if (contractedServices.Any(service =>
                string.Equals(
                    service.ServiceCode,
                    PassengerBridgeServiceCode,
                    StringComparison.Ordinal)))
        {
            materializedChecklist = await MaterializeChecklistAsync(
                operation.Id,
                scope.OperationDate,
                now,
                cancellationToken);
            if (materializedChecklist is null)
            {
                return Conflict();
            }
        }

        var assignment = new OperationAgentAssignment
        {
            PublicId = Guid.CreateVersion7(),
            GroundOperationId = operation.Id,
            RampAgentId = agent.Id,
            OperationalPositionId = position.Id,
            AssignmentRole = PrimaryAssignmentRole,
            AssignedAt = now,
            AssignedByAccountId = scope.ActorAccountInternalId,
            CreatedAt = now,
            UpdatedAt = now,
        };
        context.OperationAgentAssignments.Add(assignment);

        operation.CurrentStatus = GroundOperationStatus.Assigned;
        operation.UpdatedAt = now;
        context.Set<GroundOperationStatusEvent>().Add(new GroundOperationStatusEvent
        {
            GroundOperationId = operation.Id,
            FromStatus = GroundOperationStatus.Planned,
            ToStatus = GroundOperationStatus.Assigned,
            OccurredAt = now,
            ActorAccountId = scope.ActorAccountInternalId,
            Reason = "Agent assigned from OCC planning.",
        });

        var auditEntry = new AuditEntry
        {
            PublicId = Guid.CreateVersion7(),
            OccurredAt = now,
            ActorType = AuditActorType.Account,
            ActorAccountId = scope.ActorAccountInternalId,
            Action = "occ.operation.assigned",
            EntityType = nameof(GroundOperation),
            EntityPublicId = operation.PublicId,
            OrganizationId = scope.AirlineOrganizationId,
            StationId = scope.StationInternalId,
            Source = AuditSource.Api,
            CorrelationId = request.CorrelationId,
            RequestId = request.RequestId,
            Reason = "Initial OCC agent assignment.",
            MetadataJson = JsonSerializer.Serialize(new
            {
                turnaroundId = scope.TurnaroundPublicId,
                agentId = agent.PublicId,
                operationalPositionId = position.PublicId,
                serviceCount = materializedServices.Count,
                checklistId = materializedChecklist?.Entity.PublicId,
                checklistTemplateVersion = materializedChecklist?.VersionNumber,
                checklistItemCount = materializedChecklist?.ItemCount ?? 0,
            }),
        };
        context.AuditEntries.Add(auditEntry);

        await AirlineOperationChangeWriter.AddAsync(context,
            scope.AirlineOrganizationId, operation.PublicId, now, cancellationToken);

        await context.SaveChangesAsync(cancellationToken);

        context.Set<OperationServiceStatusEvent>().AddRange(
            materializedServices
                .Where(item => item.IsNew)
                .Select(item => new OperationServiceStatusEvent
                {
                    OperationServiceId = item.Entity.Id,
                    FromStatus = null,
                    ToStatus = ServiceExecutionStatus.Planned,
                    OccurredAt = now,
                    Note = "Materialized from the applicable contract during OCC assignment.",
                }));
        context.AuditChanges.AddRange(
            new AuditChange
            {
                AuditEntryId = auditEntry.Id,
                PropertyName = nameof(GroundOperation.CurrentStatus),
                OldValue = GroundOperationStatus.Planned.ToString(),
                NewValue = GroundOperationStatus.Assigned.ToString(),
            },
            new AuditChange
            {
                AuditEntryId = auditEntry.Id,
                PropertyName = "AssignedAgentId",
                NewValue = agent.PublicId.ToString("D"),
            },
            new AuditChange
            {
                AuditEntryId = auditEntry.Id,
                PropertyName = "OperationalPositionId",
                NewValue = position.PublicId.ToString("D"),
            });
        if (materializedChecklist is not null)
        {
            context.AuditChanges.Add(new AuditChange
            {
                AuditEntryId = auditEntry.Id,
                PropertyName = "OperationChecklistId",
                NewValue = materializedChecklist.Entity.PublicId.ToString("D"),
            });
        }
        await context.SaveChangesAsync(cancellationToken);

        var assignmentData = new OccAssignmentData(
            scope.TurnaroundPublicId,
            new OccGroundOperationData(
                operation.PublicId,
                operation.CurrentStatus.ToString(),
                operation.PlannedStartAt,
                operation.PlannedEndAt,
                operation.ActualStartAt,
                operation.ActualEndAt),
            new OccAssignedAgentData(
                assignment.PublicId,
                agent.PublicId,
                candidate.DisplayName,
                candidate.EmployeeNumber,
                position.PublicId,
                position.Code,
                position.Name,
                assignment.AssignmentRole,
                assignment.AssignedAt),
            materializedServices
                .OrderBy(item => item.Entity.LineNumber)
                .Select(item => new OccOperationServiceData(
                    item.Entity.PublicId,
                    item.Entity.LineNumber,
                    item.Contract.ServiceDefinitionPublicId,
                    item.Contract.ServiceCode,
                    item.Contract.ServiceName,
                    item.Entity.ContractedQuantity,
                    item.Entity.ExecutedQuantity,
                    item.Entity.BillingUnitSnapshot,
                    item.Entity.CurrentStatus.ToString()))
                .ToArray(),
            string.Empty);
        assignmentData = assignmentData with
        {
            ConcurrencyToken = OccPlanningConcurrencyToken.CreateAssignment(
                operation.RowVersion,
                assignmentData),
        };

        return OccAssignmentWriteResult.Success(assignmentData, auditEntry.PublicId);
    }

    private async Task<MaterializedChecklist?> MaterializeChecklistAsync(
        long operationId,
        DateOnly operationDate,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var applicableVersion = await (
                from template in context.Set<ChecklistTemplate>().AsNoTracking()
                join version in context.Set<ChecklistTemplateVersion>().AsNoTracking()
                    on template.Id equals version.ChecklistTemplateId
                where template.Code == TurnaroundChecklistCode &&
                      template.IsActive &&
                      version.Status == ChecklistVersionStatus.Published &&
                      version.EffectiveFrom <= operationDate &&
                      (version.EffectiveTo == null || version.EffectiveTo >= operationDate)
                orderby version.VersionNumber descending, version.PublicId
                select new ChecklistVersionProjection(
                    version.Id,
                    version.VersionNumber))
            .FirstOrDefaultAsync(cancellationToken);
        if (applicableVersion is null)
        {
            return null;
        }

        var itemCount = await context.Set<ChecklistTemplateItem>()
            .AsNoTracking()
            .CountAsync(
                item => item.ChecklistTemplateVersionId == applicableVersion.Id,
                cancellationToken);
        if (itemCount == 0)
        {
            return null;
        }

        var existing = await context.OperationChecklists
            .SingleOrDefaultAsync(
                checklist => checklist.GroundOperationId == operationId &&
                    checklist.ChecklistTemplateVersionId == applicableVersion.Id,
                cancellationToken);
        if (existing is not null)
        {
            var hasAnswers = await context.Set<ChecklistAnswer>()
                .AsNoTracking()
                .AnyAsync(
                    answer => answer.OperationChecklistId == existing.Id,
                    cancellationToken);
            return !hasAnswers &&
                   existing.Status == ChecklistStatus.NotStarted &&
                   existing.StartedAt is null &&
                   existing.SubmittedAt is null &&
                   existing.SubmittedByRampAgentId is null
                ? new MaterializedChecklist(
                    existing,
                    applicableVersion.VersionNumber,
                    itemCount)
                : null;
        }

        var checklist = new OperationChecklist
        {
            PublicId = Guid.CreateVersion7(),
            GroundOperationId = operationId,
            ChecklistTemplateVersionId = applicableVersion.Id,
            Status = ChecklistStatus.NotStarted,
            CreatedAt = now,
            UpdatedAt = now,
        };
        context.OperationChecklists.Add(checklist);
        return new MaterializedChecklist(
            checklist,
            applicableVersion.VersionNumber,
            itemCount);
    }

    private List<MaterializedService>? ReconcileServices(
        long operationId,
        ContractedServiceProjection[] contractedServices,
        OperationService[] existingServices,
        DateTimeOffset now)
    {
        if (existingServices.Length > contractedServices.Length ||
            existingServices.Any(service =>
                service.LineNumber <= 0 ||
                service.LineNumber > contractedServices.Length) ||
            existingServices.Select(service => service.LineNumber).Distinct().Count() !=
                existingServices.Length)
        {
            return null;
        }

        var existingByLine = existingServices.ToDictionary(service => service.LineNumber);
        var materialized = new List<MaterializedService>(contractedServices.Length);
        for (var index = 0; index < contractedServices.Length; index++)
        {
            var lineNumber = index + 1;
            var expected = contractedServices[index];
            if (existingByLine.TryGetValue(lineNumber, out var existing))
            {
                if (!ServiceSnapshotMatches(existing, expected))
                {
                    return null;
                }

                materialized.Add(new MaterializedService(existing, expected, IsNew: false));
                continue;
            }

            var service = new OperationService
            {
                PublicId = Guid.CreateVersion7(),
                GroundOperationId = operationId,
                LineNumber = lineNumber,
                ServiceDefinitionId = expected.ServiceDefinitionId,
                ContractServiceRateId = expected.RateId,
                ContractedQuantity = expected.MinimumQuantity,
                ExecutedQuantity = 0m,
                BillingUnitSnapshot = expected.BillingUnit,
                UnitPriceSnapshot = expected.UnitPrice,
                CurrencyCodeSnapshot = expected.CurrencyCode,
                CurrentStatus = ServiceExecutionStatus.Planned,
                CreatedAt = now,
                UpdatedAt = now,
            };
            context.OperationServices.Add(service);
            materialized.Add(new MaterializedService(service, expected, IsNew: true));
        }

        return materialized;
    }

    private static bool ServiceSnapshotMatches(
        OperationService actual,
        ContractedServiceProjection expected) =>
        actual.ServiceDefinitionId == expected.ServiceDefinitionId &&
        actual.ContractServiceRateId == expected.RateId &&
        actual.ContractedQuantity == expected.MinimumQuantity &&
        actual.ExecutedQuantity == 0m &&
        string.Equals(actual.BillingUnitSnapshot, expected.BillingUnit, StringComparison.Ordinal) &&
        actual.UnitPriceSnapshot == expected.UnitPrice &&
        string.Equals(actual.CurrencyCodeSnapshot, expected.CurrencyCode, StringComparison.Ordinal) &&
        actual.CurrentStatus == ServiceExecutionStatus.Planned;

    private static bool IsOperationalConflict(DbUpdateException exception) =>
        exception.GetBaseException() is SqlException sqlException &&
        (sqlException.Number is 2601 or 2627 or 547 ||
         IsSerializationConflict(sqlException.Number));

    private static bool IsSerializationConflict(int errorNumber) =>
        errorNumber is 1205 or 1222 or 3960;

    private static bool IsSerializationConflict(Exception exception) =>
        exception.GetBaseException() is SqlException sqlException &&
        IsSerializationConflict(sqlException.Number);

    private static OccAssignmentWriteResult NotFound() =>
        OccAssignmentWriteResult.Failed(OccAssignmentWriteFailure.NotFound);

    private static OccAssignmentWriteResult Conflict() =>
        OccAssignmentWriteResult.Failed(OccAssignmentWriteFailure.Conflict);

    private static OccAssignmentWriteResult PreconditionFailed() =>
        OccAssignmentWriteResult.Failed(OccAssignmentWriteFailure.PreconditionFailed);

    private sealed record AssignmentScope(
        long TurnaroundInternalId,
        Guid TurnaroundPublicId,
        long AirlineId,
        DateOnly OperationDate,
        TurnaroundStatus TurnaroundStatus,
        long StationInternalId,
        long AirlineOrganizationId,
        long ActorAccountInternalId);

    private sealed record PositionProjection(
        long Id,
        Guid PublicId,
        string Code,
        string Name);

    private sealed record ApplicableContractProjection(
        Guid ContractPublicId,
        long ContractVersionId,
        int VersionNumber,
        string CurrencyCode);

    private sealed record ContractedServiceProjection(
        long RateId,
        Guid RatePublicId,
        long ServiceDefinitionId,
        Guid ServiceDefinitionPublicId,
        string ServiceCode,
        string ServiceName,
        string BillingUnit,
        decimal MinimumQuantity,
        decimal UnitPrice,
        string CurrencyCode);

    private sealed record MaterializedService(
        OperationService Entity,
        ContractedServiceProjection Contract,
        bool IsNew);

    private sealed record ChecklistVersionProjection(long Id, int VersionNumber);

    private sealed record MaterializedChecklist(
        OperationChecklist Entity,
        int VersionNumber,
        int ItemCount);
}
