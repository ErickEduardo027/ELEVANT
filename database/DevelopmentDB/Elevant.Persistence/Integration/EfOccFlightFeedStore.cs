using System.Data;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Integrations;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Common;
using Elevant.Application.Identity;
using Elevant.Application.Integration;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Integration;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Commercial;
using Elevant.Persistence.Operations;
using Elevant.Persistence.Realtime;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Integration;

/// <summary>
/// OCC review of the provider's proposed flights (ADR-0028). The feed keeps the legs of every active registered
/// airline (2-B); the review shows those with a contract in force that day, the charter candidates apart
/// (ADR-0033), and the dismissed ones OCC can still restore (2-N36). Airlines whose contract at the station is
/// suspended or expired are hidden and their import answers <c>contract_not_in_force</c> (2-N16).
/// </summary>
internal sealed class EfOccFlightFeedStore(
    ElevantDbContext context, IActorContextResolver actors, IAirportFlightFeed feed, FlightFeedBudget budget,
    TimeProvider timeProvider) : IOccFlightFeedStore
{
    private const string ReadPermission = "operations.planning.read";
    private const string CreatePermission = "operations.planning.create";
    private const string ImportAction = "occ.flight_proposal.import";
    private const string RestoreAction = "occ.flight_proposal.restore";
    private const string DismissAction = "occ.flight_proposal.dismiss";
    private static readonly TimeSpan MinTurn = TimeSpan.FromMinutes(20);
    private static readonly TimeSpan MaxTurn = TimeSpan.FromHours(8);

    public async Task<OccFlightFeedData?> ListAsync(Guid actorId, Guid stationId, DateOnly date,
        OccFlightFeedView view = OccFlightFeedView.Contracted, CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, ReadPermission, stationId)) return null;
        var station = await context.Stations.AsNoTracking().Where(item => item.PublicId == stationId && item.IsActive)
            .Select(item => new { item.Id, item.Code }).SingleOrDefaultAsync(cancellationToken);
        if (station is null) return null;

        var (contracted, notInForce) = await ClassifyAsync(station.Id, date, cancellationToken);
        var hidden = notInForce.ToArray();
        var withContract = contracted.ToArray();
        var proposals = context.Set<ExternalFlightProposal>().AsNoTracking()
            .Where(proposal => proposal.StationId == station.Id && proposal.OperationDate == date &&
                               !hidden.Contains(proposal.AirlineId));
        proposals = view switch
        {
            OccFlightFeedView.Dismissed => proposals.Where(proposal => proposal.Status == ExternalFlightProposalStatus.Dismissed),
            OccFlightFeedView.Charter => proposals.Where(proposal => proposal.Status != ExternalFlightProposalStatus.Dismissed &&
                !withContract.Contains(proposal.AirlineId) &&
                // A charter needs an active carrier with an active organization (ADR-0033).
                context.Airlines.Any(airline => airline.Id == proposal.AirlineId && airline.IsActive &&
                    context.Organizations.Any(organization => organization.Id == airline.OrganizationId &&
                        organization.Status == OrganizationStatus.Active))),
            _ => proposals.Where(proposal => proposal.Status != ExternalFlightProposalStatus.Dismissed &&
                withContract.Contains(proposal.AirlineId)),
        };
        var rows = await (from proposal in proposals
                          join airline in context.Airlines.AsNoTracking() on proposal.AirlineId equals airline.Id
                          join turnaround in context.Turnarounds.AsNoTracking() on proposal.TurnaroundId equals (long?)turnaround.Id
                              into turnarounds
                          from turnaround in turnarounds.DefaultIfEmpty()
                          orderby proposal.ScheduledAt, proposal.FlightNumber
                          select new
                          {
                              Proposal = proposal, AirlinePublicId = airline.PublicId, AirlineName = airline.Name,
                              airline.IataCode, TurnaroundPublicId = turnaround == null ? (Guid?)null : turnaround.PublicId,
                          }).ToArrayAsync(cancellationToken);
        var suggestions = SuggestDepartures(rows.Select(row => row.Proposal).ToArray());
        var types = await AircraftTypeCandidatesAsync(cancellationToken);

        var now = timeProvider.GetUtcNow();
        var (dayStart, monthStart) = EfFlightFeedSyncStore.UsagePeriods(now);
        var usage = context.Set<ProviderUsageEntry>().AsNoTracking().Where(entry => entry.Provider == feed.Provider);
        var unitsMonth = await usage.Where(entry => entry.OccurredAt >= monthStart).SumAsync(entry => entry.Units, cancellationToken);
        var unitsToday = await usage.Where(entry => entry.OccurredAt >= dayStart).SumAsync(entry => entry.Units, cancellationToken);
        var lease = await context.Set<ProviderSyncLease>().AsNoTracking().Where(item => item.Provider == feed.Provider)
            .Select(item => new { item.PausedUntil, item.LastError }).SingleOrDefaultAsync(cancellationToken);
        var paused = lease?.PausedUntil > now ? lease.PausedUntil : null;
        var stationUsage = usage.Where(entry => entry.StationId == station.Id);
        var lastRead = await stationUsage
            .Where(entry => entry.Outcome == ProviderCallOutcome.Succeeded || entry.Outcome == ProviderCallOutcome.NoContent)
            .MaxAsync(entry => (DateTimeOffset?)entry.OccurredAt, cancellationToken);
        var lastManual = await stationUsage.Where(entry => entry.Trigger == ProviderCallTrigger.Manual)
            .MaxAsync(entry => (DateTimeOffset?)entry.OccurredAt, cancellationToken);
        var nextManual = lastManual + FlightFeedSynchronizer.ManualInterval;

        return new OccFlightFeedData(stationId, station.Code, date,
            new OccFlightFeedBudgetData(feed.IsConfigured, feed.Provider, unitsToday, budget.DailyUnits, unitsMonth,
                budget.MonthlyUnits, paused, paused is null ? null : lease!.LastError),
            lastRead, nextManual > now ? nextManual : null, actor!.HasPermission(CreatePermission),
            rows.Select(row => new OccFlightProposalData(row.Proposal.PublicId, row.Proposal.Direction.ToString(),
                row.Proposal.FlightNumber, row.AirlinePublicId, row.AirlineName, row.IataCode, row.Proposal.CounterpartIata,
                row.Proposal.CounterpartName, row.Proposal.CounterpartAirportId is not null, row.Proposal.ScheduledAt,
                row.Proposal.RevisedAt, row.Proposal.RunwayAt, row.Proposal.ProviderStatus, row.Proposal.AircraftRegistration,
                row.Proposal.AircraftModel, row.Proposal.Terminal, row.Proposal.Gate, row.Proposal.Status.ToString(),
                row.TurnaroundPublicId,
                suggestions.TryGetValue(row.Proposal.Id, out var suggested) ? suggested : null, row.Proposal.LastSeenAt,
                Version(row.Proposal.RowVersion), AircraftModelMatcher.Suggest(row.Proposal.AircraftModel, types))).ToArray());
    }

    /// <summary>
    /// Pairs each open arrival with the departure it most likely turns into: same airline, same
    /// aircraft when both registrations are known, otherwise the next departure 20 minutes to 8
    /// hours later. Each departure is suggested once. OCC always confirms the pair.
    /// </summary>
    public static Dictionary<long, Guid> SuggestDepartures(IReadOnlyList<ExternalFlightProposal> proposals)
    {
        var open = proposals.Where(item => item.Status == ExternalFlightProposalStatus.Proposed).ToArray();
        var departures = open.Where(item => item.Direction == FlightDirection.Departure).OrderBy(item => item.ScheduledAt).ToList();
        var result = new Dictionary<long, Guid>();
        foreach (var arrival in open.Where(item => item.Direction == FlightDirection.Arrival).OrderBy(item => item.ScheduledAt))
        {
            var candidates = departures.Where(departure => departure.AirlineId == arrival.AirlineId &&
                departure.ScheduledAt - arrival.ScheduledAt >= MinTurn && departure.ScheduledAt - arrival.ScheduledAt <= MaxTurn)
                .ToArray();
            var match = arrival.AircraftRegistration is { } registration
                ? candidates.FirstOrDefault(departure => departure.AircraftRegistration == registration) ??
                  candidates.FirstOrDefault(departure => departure.AircraftRegistration is null)
                : candidates.FirstOrDefault();
            if (match is null) continue;
            result[arrival.Id] = match.PublicId;
            departures.Remove(match);
        }
        return result;
    }

    public async Task<OccFlightImportResult> ImportAsync(Guid actorId, OccFlightImportInput input, Guid? idempotencyKey,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, CreatePermission)) return Failed(OccFlightFeedFailure.Forbidden, "forbidden");
        if (idempotencyKey == Guid.Empty) return Failed(OccFlightFeedFailure.Invalid, "idempotency_key_required");
        if (idempotencyKey is not null &&
            (string.IsNullOrWhiteSpace(input.ExpectedArrivalVersion) || string.IsNullOrWhiteSpace(input.ExpectedDepartureVersion)))
            return Failed(OccFlightFeedFailure.Invalid, "expected_version_required");
        if (input.ArrivalProposalId == Guid.Empty || input.DepartureProposalId == Guid.Empty ||
            input.ArrivalProposalId == input.DepartureProposalId || input.AircraftTypeId == Guid.Empty || input.StandId == Guid.Empty)
            return Failed(OccFlightFeedFailure.Invalid, "invalid_flight_import");
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        var hash = CommercialCommandReceipts.Hash(new
        {
            input.ArrivalProposalId, input.DepartureProposalId, input.AircraftTypeId, input.StandId, input.Charter,
            input.ExpectedArrivalVersion, input.ExpectedDepartureVersion,
        });
        try
        {
            return await context.Database.CreateExecutionStrategy().ExecuteAsync(async token =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable, token);
                if (idempotencyKey is { } key)
                {
                    var prior = await CommercialCommandReceipts.FindAsync(context, key, accountId, ImportAction, hash, token);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Conflict)
                        return Failed(OccFlightFeedFailure.Conflict, "idempotency_conflict");
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Replay)
                        return await ExistingAsync(prior.ResultId, input.ArrivalProposalId, token);
                }
                var result = await ImportInsideTransactionAsync(actor!, accountId, input, idempotencyKey is not null, token);
                if (result.Failure is not null || result.Replayed)
                {
                    await transaction.RollbackAsync(token);
                    context.ChangeTracker.Clear();
                    return result;
                }
                if (idempotencyKey is { } receipt)
                {
                    CommercialCommandReceipts.Add(context, receipt, accountId, ImportAction, hash, result.TurnaroundId!.Value, Now());
                    await context.SaveChangesAsync(token);
                }
                await transaction.CommitAsync(token);
                return result;
            }, cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return Failed(OccFlightFeedFailure.Conflict, "version_conflict");
        }
        catch (DbUpdateException exception) when (idempotencyKey is { } key && CommercialCommandReceipts.IsDuplicateKey(exception))
        {
            context.ChangeTracker.Clear();
            var concurrent = await CommercialCommandReceipts.FindAsync(context, key, accountId, ImportAction, hash, cancellationToken);
            return concurrent.Outcome == CommercialCommandReceipts.Outcome.Replay
                ? await ExistingAsync(concurrent.ResultId, input.ArrivalProposalId, cancellationToken)
                : Failed(OccFlightFeedFailure.Conflict, "idempotency_conflict");
        }
        catch (Exception exception) when (exception is DbUpdateException { InnerException: SqlException { Number: 1205 or 2601 or 2627 } } ||
                                          exception is SqlException { Number: 1205 } ||
                                          exception is Microsoft.EntityFrameworkCore.Storage.RetryLimitExceededException
                                              { InnerException: SqlException { Number: 1205 } })
        {
            context.ChangeTracker.Clear();
            return Failed(OccFlightFeedFailure.Conflict, "version_conflict");
        }
    }

    private async Task<OccFlightImportResult> ImportInsideTransactionAsync(ActorContext actor, long accountId,
        OccFlightImportInput input, bool keyed, CancellationToken cancellationToken)
    {
        var proposals = await context.Set<ExternalFlightProposal>()
            .Where(item => item.PublicId == input.ArrivalProposalId || item.PublicId == input.DepartureProposalId)
            .ToArrayAsync(cancellationToken);
        var arrival = proposals.SingleOrDefault(item => item.PublicId == input.ArrivalProposalId);
        var departure = proposals.SingleOrDefault(item => item.PublicId == input.DepartureProposalId);
        if (arrival is null || departure is null) return Failed(OccFlightFeedFailure.NotFound, "not_found");
        var station = await (from item in context.Stations.AsNoTracking()
                             join airport in context.Airports.AsNoTracking() on item.AirportId equals airport.Id
                             where item.Id == arrival.StationId && item.IsActive
                             select new { item.Id, item.PublicId, item.Code, AirportId = airport.Id })
            .SingleOrDefaultAsync(cancellationToken);
        if (station is null || !InScope(actor, station.PublicId)) return Failed(OccFlightFeedFailure.NotFound, "not_found");

        // Without a key (older screens) confirming the same pair again answers the same turnaround.
        if (!keyed && arrival.Status == ExternalFlightProposalStatus.Confirmed &&
            departure.Status == ExternalFlightProposalStatus.Confirmed &&
            arrival.TurnaroundId == departure.TurnaroundId && arrival.TurnaroundId is { } existingId)
        {
            var existing = await context.Turnarounds.AsNoTracking().Where(item => item.Id == existingId)
                .Select(item => item.PublicId).SingleAsync(cancellationToken);
            return await ExistingAsync(existing, arrival.PublicId, cancellationToken);
        }
        if (arrival.Status != ExternalFlightProposalStatus.Proposed || departure.Status != ExternalFlightProposalStatus.Proposed)
            return Failed(OccFlightFeedFailure.Conflict, "flight_proposal_closed");
        if (input.ExpectedArrivalVersion is { } expectedArrival && Version(arrival.RowVersion) != expectedArrival ||
            input.ExpectedDepartureVersion is { } expectedDeparture && Version(departure.RowVersion) != expectedDeparture)
            return Failed(OccFlightFeedFailure.Conflict, "version_conflict");
        if (arrival.Direction != FlightDirection.Arrival || departure.Direction != FlightDirection.Departure ||
            arrival.StationId != departure.StationId || arrival.AirlineId != departure.AirlineId ||
            departure.ScheduledAt <= arrival.ScheduledAt || departure.ScheduledAt - arrival.ScheduledAt > TimeSpan.FromHours(24))
            return Failed(OccFlightFeedFailure.Conflict, "flight_proposals_not_pairable");
        if (arrival.CounterpartAirportId is not { } originId || departure.CounterpartAirportId is not { } destinationId)
            return Failed(OccFlightFeedFailure.CounterpartUnknown, "flight_counterpart_unknown");

        var airline = await context.Airlines.AsNoTracking().Where(item => item.Id == arrival.AirlineId)
            .Select(item => new
            {
                item.OrganizationId, item.IsActive,
                OrganizationActive = context.Organizations.Any(organization => organization.Id == item.OrganizationId &&
                    organization.Status == OrganizationStatus.Active),
            }).SingleAsync(cancellationToken);
        if (!airline.IsActive) return Failed(OccFlightFeedFailure.Conflict, "airline_inactive");

        // 3-N07: the flight OCC already planned (typed by hand or imported before a reschedule) takes the pair; a
        // second turnaround would be operated and invoiced twice.
        if (await PlannedTurnaroundAsync(station.Id, arrival, departure, cancellationToken) is { } planned)
            return await LinkAsync(planned, arrival, departure, accountId, airline.OrganizationId, station.Id,
                station.PublicId, input, cancellationToken);
        var contracts = await ApplicableContracts.For(context, arrival.AirlineId, station.Id, arrival.OperationDate)
            .Select(row => row.VersionId).Take(2).ToArrayAsync(cancellationToken);
        if (contracts.Length > 1) return Failed(OccFlightFeedFailure.Conflict, "contract_ambiguous");
        long? contractVersionId = null;
        if (contracts.Length == 1)
        {
            // A carrier with a contract flies under it, never as a charter (ADR-0033).
            if (input.Charter) return Failed(OccFlightFeedFailure.Conflict, "charter_has_contract");
            contractVersionId = contracts[0];
        }
        else
        {
            if (await NotInForceAirlines(station.Id).AnyAsync(id => id == arrival.AirlineId, cancellationToken))
                return Failed(OccFlightFeedFailure.Conflict, "contract_not_in_force");
            if (!input.Charter) return Failed(OccFlightFeedFailure.Conflict, "charter_required");
            if (!airline.OrganizationActive) return Failed(OccFlightFeedFailure.Conflict, "airline_inactive");
        }

        long? aircraftTypeId = null;
        AircraftSizeCategory? aircraftSize = null;
        if (input.AircraftTypeId is { } requestedType)
        {
            var type = await context.AircraftTypes.AsNoTracking().Where(item => item.PublicId == requestedType && item.IsActive)
                .Select(item => new { item.Id, item.SizeCategory }).SingleOrDefaultAsync(cancellationToken);
            if (type is null) return Failed(OccFlightFeedFailure.Conflict, "aircraft_type_unavailable");
            (aircraftTypeId, aircraftSize) = (type.Id, type.SizeCategory);
        }
        var plannedStart = arrival.RevisedAt ?? arrival.ScheduledAt;
        var plannedEnd = departure.RevisedAt ?? departure.ScheduledAt;
        long? standId = null;
        if (input.StandId is { } requestedStand)
        {
            // Locked before its overlap is checked: two imports for one stand wait for each other (3-N10).
            await StandAvailability.LockAsync(context, requestedStand, cancellationToken);
            var placement = await StandAvailability.CheckAsync(context, station.Id, requestedStand, plannedStart, plannedEnd,
                aircraftSize, null, cancellationToken);
            if (!placement.Available)
                return Failed(OccFlightFeedFailure.Conflict, "stand_unavailable", placement.Reasons);
            standId = placement.StandId;
        }

        var now = Now();
        var turnaroundId = Guid.CreateVersion7();
        // 3-N27: the readable code of the station and local day, as the manual entry issues it.
        var operationCode = await OperationCodes.NextAsync(context, station.Code, arrival.OperationDate, cancellationToken);
        var turnaround = new Turnaround
        {
            PublicId = turnaroundId, OperationCode = operationCode, AirlineId = arrival.AirlineId,
            StationId = station.Id, OperationDate = arrival.OperationDate, ContractVersionId = contractVersionId,
            AircraftTypeId = aircraftTypeId, AircraftRegistration = arrival.AircraftRegistration ?? departure.AircraftRegistration,
            CurrentStatus = TurnaroundStatus.Confirmed, Source = OperationalDataSource.ExternalProvider,
            ExternalProvider = arrival.Provider, ExternalReference = arrival.ExternalReference,
            SourceObservedAt = arrival.LastSeenAt, CreatedAt = now, UpdatedAt = now,
        };
        context.Turnarounds.Add(turnaround);
        await context.SaveChangesAsync(cancellationToken);
        if (input.Charter)
            context.Set<CharterAgreement>().Add(new CharterAgreement
            {
                PublicId = Guid.CreateVersion7(), TurnaroundId = turnaround.Id, AirlineId = arrival.AirlineId,
                CurrencyCode = CharterRules.CurrencyCode, PrepaymentStatus = CharterPrepaymentStatus.Pending,
                CreatedByAccountId = accountId, CreatedAt = now, UpdatedAt = now,
            });
        if (standId is { } stand)
            context.Set<StandAssignment>().Add(new StandAssignment
            {
                PublicId = Guid.CreateVersion7(), TurnaroundId = turnaround.Id, StandId = stand, AssignedFrom = plannedStart,
                AssignedByAccountId = accountId, Reason = "Imported from the provider flight feed by OCC.", CreatedAt = now,
                UpdatedAt = now,
            });
        var arrivalLeg = Leg(turnaround.Id, arrival, originId, station.AirportId, now);
        var departureLeg = Leg(turnaround.Id, departure, station.AirportId, destinationId, now);
        context.FlightLegs.AddRange(arrivalLeg, departureLeg);
        var operation = new GroundOperation
        {
            PublicId = Guid.CreateVersion7(), TurnaroundId = turnaround.Id, CurrentStatus = GroundOperationStatus.Planned,
            PlannedStartAt = plannedStart, PlannedEndAt = plannedEnd, CreatedAt = now, UpdatedAt = now,
        };
        context.GroundOperations.Add(operation);
        context.Set<TurnaroundStatusEvent>().Add(new TurnaroundStatusEvent
        {
            TurnaroundId = turnaround.Id, ToStatus = TurnaroundStatus.Confirmed, OccurredAt = now, ActorAccountId = accountId,
            Source = OperationalDataSource.ExternalProvider, Reason = "Imported from the provider flight feed by OCC.",
        });
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = now, ActorType = AuditActorType.Account, ActorAccountId = accountId,
            Action = "occ.turnaround.imported", EntityType = nameof(Turnaround), EntityPublicId = turnaroundId,
            OrganizationId = airline.OrganizationId, StationId = station.Id, Source = AuditSource.Api,
            CorrelationId = input.ArrivalProposalId, Reason = "Imported from the provider flight feed by OCC.",
            MetadataJson = JsonSerializer.Serialize(new
            {
                provider = arrival.Provider, arrival = arrival.ExternalReference, departure = departure.ExternalReference,
                charter = input.Charter, standId = input.StandId, aircraftTypeId = input.AircraftTypeId,
            }),
        });
        await context.SaveChangesAsync(cancellationToken);

        context.Set<GroundOperationStatusEvent>().Add(new GroundOperationStatusEvent
        {
            GroundOperationId = operation.Id, ToStatus = GroundOperationStatus.Planned, OccurredAt = now, ActorAccountId = accountId,
            Reason = "Created with an imported provider flight.",
        });
        foreach (var (proposal, leg) in new[] { (arrival, arrivalLeg), (departure, departureLeg) })
        {
            proposal.Status = ExternalFlightProposalStatus.Confirmed;
            proposal.TurnaroundId = turnaround.Id;
            proposal.FlightLegId = leg.Id;
            proposal.DecidedByAccountId = accountId;
            proposal.DecidedAt = now;
            proposal.UpdatedAt = now;
        }
        await AirlineOperationChangeWriter.AddAsync(context, airline.OrganizationId, operation.PublicId, now, cancellationToken);
        await OccPlanningChangeWriter.AddForStationAsync(context, station.Id, station.PublicId, now, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        return new(turnaroundId, turnaround.OperationCode, null);
    }

    public async Task<OccFlightProposalDismissResult> DismissAsync(Guid actorId, Guid proposalId, string? expectedVersion = null,
        Guid? idempotencyKey = null, CancellationToken cancellationToken = default)
    {
        if (idempotencyKey == Guid.Empty) return DismissFailed(OccFlightFeedFailure.Invalid, "idempotency_key_required");
        if (idempotencyKey is not null && string.IsNullOrWhiteSpace(expectedVersion))
            return DismissFailed(OccFlightFeedFailure.Invalid, "expected_version_required");
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor is null) return DismissFailed(OccFlightFeedFailure.Forbidden, "forbidden");
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        var hash = CommercialCommandReceipts.Hash(new { proposalId, expected = expectedVersion });
        try
        {
            // The receipt, the decision, its audit and its announcement commit together: a replay repeats none of them.
            return await context.Database.CreateExecutionStrategy().ExecuteAsync(async token =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable, token);
                if (idempotencyKey is { } key)
                {
                    var prior = await CommercialCommandReceipts.FindAsync(context, key, accountId, DismissAction, hash, token);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Conflict)
                        return DismissFailed(OccFlightFeedFailure.Conflict, "idempotency_conflict");
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Replay)
                        return new OccFlightProposalDismissResult(null, null, true);
                }
                var result = await DismissInsideTransactionAsync(actor, accountId, proposalId, expectedVersion, token);
                if (result.Failure is not null)
                {
                    await transaction.RollbackAsync(token);
                    context.ChangeTracker.Clear();
                    return result;
                }
                if (idempotencyKey is { } receipt)
                {
                    CommercialCommandReceipts.Add(context, receipt, accountId, DismissAction, hash, proposalId, Now());
                    await context.SaveChangesAsync(token);
                }
                await transaction.CommitAsync(token);
                context.ChangeTracker.Clear();
                return result;
            }, cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return DismissFailed(OccFlightFeedFailure.Conflict, "version_conflict");
        }
        catch (DbUpdateException exception) when (idempotencyKey is { } key && CommercialCommandReceipts.IsDuplicateKey(exception))
        {
            context.ChangeTracker.Clear();
            var concurrent = await CommercialCommandReceipts.FindAsync(context, key, accountId, DismissAction, hash,
                cancellationToken);
            return concurrent.Outcome == CommercialCommandReceipts.Outcome.Replay
                ? new OccFlightProposalDismissResult(null, null, true)
                : DismissFailed(OccFlightFeedFailure.Conflict, "idempotency_conflict");
        }
    }

    /// <summary>
    /// The dismissal inside the command's transaction. A confirmed proposal is closed (<c>flight_proposal_closed</c>);
    /// with an expected version a proposal that changed since, such as one restored meanwhile, is
    /// <c>version_conflict</c>; one already dismissed stays as it is.
    /// </summary>
    private async Task<OccFlightProposalDismissResult> DismissInsideTransactionAsync(ActorContext actor, long accountId,
        Guid proposalId, string? expectedVersion, CancellationToken cancellationToken)
    {
        var proposal = await context.Set<ExternalFlightProposal>().SingleOrDefaultAsync(item => item.PublicId == proposalId,
            cancellationToken);
        if (proposal is null) return DismissFailed(OccFlightFeedFailure.NotFound, "not_found");
        var station = await context.Stations.AsNoTracking().Where(item => item.Id == proposal.StationId)
            .Select(item => item.PublicId).SingleAsync(cancellationToken);
        if (!Allowed(actor, CreatePermission, station)) return DismissFailed(OccFlightFeedFailure.Forbidden, "forbidden");
        if (proposal.Status == ExternalFlightProposalStatus.Confirmed)
            return DismissFailed(OccFlightFeedFailure.Conflict, "flight_proposal_closed");
        if (!string.IsNullOrWhiteSpace(expectedVersion) && Version(proposal.RowVersion) != expectedVersion)
            return DismissFailed(OccFlightFeedFailure.Conflict, "version_conflict");
        if (proposal.Status == ExternalFlightProposalStatus.Dismissed) return new OccFlightProposalDismissResult(null);
        var now = Now();
        proposal.Status = ExternalFlightProposalStatus.Dismissed;
        proposal.DecidedAt = now;
        proposal.DecidedByAccountId = accountId;
        proposal.UpdatedAt = now;
        // The dismissal is audited: restoring the proposal clears its decision (2-N36).
        MasterDataCommand.Audit(context, accountId, "occ.flight_proposal.dismissed", nameof(ExternalFlightProposal),
            proposal.PublicId, proposal.StationId, now, new AuditFieldChangeData("flight_proposal.status",
                nameof(ExternalFlightProposalStatus.Proposed),
                nameof(ExternalFlightProposalStatus.Dismissed)));
        await OccPlanningChangeWriter.AddForStationAsync(context, proposal.StationId, station, now, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        return new OccFlightProposalDismissResult(null);
    }

    public async Task<OccFlightProposalRestoreResult> RestoreAsync(Guid actorId, Guid proposalId, string? expectedVersion,
        Guid idempotencyKey, CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, CreatePermission)) return RestoreFailed(OccFlightFeedFailure.Forbidden, "forbidden");
        if (idempotencyKey == Guid.Empty) return RestoreFailed(OccFlightFeedFailure.Invalid, "idempotency_key_required");
        if (string.IsNullOrWhiteSpace(expectedVersion)) return RestoreFailed(OccFlightFeedFailure.Invalid, "expected_version_required");
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        var hash = CommercialCommandReceipts.Hash(new { proposalId, expected = expectedVersion });
        try
        {
            return await context.Database.CreateExecutionStrategy().ExecuteAsync(async token =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable, token);
                var prior = await CommercialCommandReceipts.FindAsync(context, idempotencyKey, accountId, RestoreAction, hash, token);
                if (prior.Outcome == CommercialCommandReceipts.Outcome.Conflict)
                    return RestoreFailed(OccFlightFeedFailure.Conflict, "idempotency_conflict");
                if (prior.Outcome == CommercialCommandReceipts.Outcome.Replay) return await RestoredAsync(prior.ResultId, true, token);
                var result = await RestoreInsideTransactionAsync(actor!, accountId, proposalId, expectedVersion, token);
                if (result.Failure is not null)
                {
                    await transaction.RollbackAsync(token);
                    context.ChangeTracker.Clear();
                    return result;
                }
                CommercialCommandReceipts.Add(context, idempotencyKey, accountId, RestoreAction, hash, proposalId, Now());
                await context.SaveChangesAsync(token);
                await transaction.CommitAsync(token);
                context.ChangeTracker.Clear();
                return await RestoredAsync(proposalId, false, token);
            }, cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return RestoreFailed(OccFlightFeedFailure.Conflict, "version_conflict");
        }
        catch (DbUpdateException exception) when (CommercialCommandReceipts.IsDuplicateKey(exception))
        {
            context.ChangeTracker.Clear();
            var concurrent = await CommercialCommandReceipts.FindAsync(context, idempotencyKey, accountId, RestoreAction, hash,
                cancellationToken);
            return concurrent.Outcome == CommercialCommandReceipts.Outcome.Replay
                ? await RestoredAsync(concurrent.ResultId, true, cancellationToken)
                : RestoreFailed(OccFlightFeedFailure.Conflict, "idempotency_conflict");
        }
    }

    private async Task<OccFlightProposalRestoreResult> RestoreInsideTransactionAsync(ActorContext actor, long accountId,
        Guid proposalId, string expectedVersion, CancellationToken cancellationToken)
    {
        var proposal = await context.Set<ExternalFlightProposal>().SingleOrDefaultAsync(item => item.PublicId == proposalId,
            cancellationToken);
        if (proposal is null) return RestoreFailed(OccFlightFeedFailure.NotFound, "not_found");
        var station = await context.Stations.AsNoTracking().Where(item => item.Id == proposal.StationId && item.IsActive)
            .Select(item => new { item.PublicId }).SingleOrDefaultAsync(cancellationToken);
        if (station is null || !InScope(actor, station.PublicId)) return RestoreFailed(OccFlightFeedFailure.NotFound, "not_found");
        if (proposal.Status != ExternalFlightProposalStatus.Dismissed)
            return RestoreFailed(OccFlightFeedFailure.Conflict, "flight_proposal_not_dismissed");
        if (Version(proposal.RowVersion) != expectedVersion) return RestoreFailed(OccFlightFeedFailure.Conflict, "version_conflict");
        var now = Now();
        // Only while the flight has not passed: its runway, revised or scheduled time is still ahead.
        if ((proposal.RunwayAt ?? proposal.RevisedAt ?? proposal.ScheduledAt) <= now)
            return RestoreFailed(OccFlightFeedFailure.Conflict, "flight_proposal_passed");
        if (await NotInForceAirlines(proposal.StationId).AnyAsync(id => id == proposal.AirlineId, cancellationToken))
            return RestoreFailed(OccFlightFeedFailure.Conflict, "contract_not_in_force");
        MasterDataCommand.Audit(context, accountId, "occ.flight_proposal.restored", nameof(ExternalFlightProposal), proposal.PublicId,
            proposal.StationId, now, new AuditFieldChangeData("flight_proposal.status", nameof(ExternalFlightProposalStatus.Dismissed),
                nameof(ExternalFlightProposalStatus.Proposed)));
        proposal.Status = ExternalFlightProposalStatus.Proposed;
        proposal.DecidedAt = null;
        proposal.DecidedByAccountId = null;
        proposal.UpdatedAt = now;
        await OccPlanningChangeWriter.AddForStationAsync(context, proposal.StationId, station.PublicId, now, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        return new OccFlightProposalRestoreResult(proposal.PublicId, null, null);
    }

    private async Task<OccFlightProposalRestoreResult> RestoredAsync(Guid proposalId, bool replayed,
        CancellationToken cancellationToken)
    {
        var rowVersion = await context.Set<ExternalFlightProposal>().AsNoTracking().Where(item => item.PublicId == proposalId)
            .Select(item => item.RowVersion).SingleOrDefaultAsync(cancellationToken);
        return rowVersion is null
            ? RestoreFailed(OccFlightFeedFailure.NotFound, "not_found")
            : new OccFlightProposalRestoreResult(proposalId, Version(rowVersion), null, null, replayed);
    }

    /// <summary>
    /// The airlines with a contract in force at the station that day and those whose contract there is
    /// suspended or expired without another in force (2-N16). Everyone else is a charter candidate.
    /// </summary>
    private async Task<(HashSet<long> Contracted, HashSet<long> NotInForce)> ClassifyAsync(long stationId, DateOnly date,
        CancellationToken cancellationToken)
    {
        var contracted = (await ApplicableContracts.For(context, null, stationId, date).Select(row => row.AirlineId).Distinct()
            .ToArrayAsync(cancellationToken)).ToHashSet();
        var notInForce = (await NotInForceAirlines(stationId).ToArrayAsync(cancellationToken))
            .Where(id => !contracted.Contains(id)).ToHashSet();
        return (contracted, notInForce);
    }

    /// <summary>Airlines with a suspended or expired contract whose versions cover the station.</summary>
    private IQueryable<long> NotInForceAirlines(long stationId) =>
        (from contract in context.Contracts.AsNoTracking()
         where (contract.Status == ContractStatus.Suspended || contract.Status == ContractStatus.Expired) &&
               context.ContractVersions.Any(version => version.ContractId == contract.Id &&
                   context.Set<ContractVersionStation>().Any(link => link.ContractVersionId == version.Id &&
                       link.StationId == stationId))
         select contract.AirlineId).Distinct();

    private async Task<AircraftTypeCandidate[]> AircraftTypeCandidatesAsync(CancellationToken cancellationToken) =>
        await context.AircraftTypes.AsNoTracking().Where(type => type.IsActive)
            .Select(type => new AircraftTypeCandidate(type.PublicId, type.IcaoCode, type.Manufacturer, type.Model))
            .ToArrayAsync(cancellationToken);

    /// <summary>
    /// The turnaround a replayed import answered. It was linked (3-N07) when it is not the one this arrival created:
    /// a manual flight, or an import of another reference.
    /// </summary>
    private async Task<OccFlightImportResult> ExistingAsync(Guid turnaroundId, Guid arrivalProposalId,
        CancellationToken cancellationToken)
    {
        var existing = await context.Turnarounds.AsNoTracking().Where(item => item.PublicId == turnaroundId)
            .Select(item => new { item.OperationCode, item.Source, item.ExternalProvider, item.ExternalReference })
            .SingleOrDefaultAsync(cancellationToken);
        if (existing is null) return Failed(OccFlightFeedFailure.NotFound, "not_found");
        var proposal = await context.Set<ExternalFlightProposal>().AsNoTracking()
            .Where(item => item.PublicId == arrivalProposalId)
            .Select(item => new { item.Provider, item.ExternalReference }).SingleOrDefaultAsync(cancellationToken);
        var created = existing.Source == OperationalDataSource.ExternalProvider && proposal is not null &&
            existing.ExternalProvider == proposal.Provider && existing.ExternalReference == proposal.ExternalReference;
        return new(turnaroundId, existing.OperationCode, null, true, Linked: !created);
    }

    /// <summary>
    /// The open turnaround of the airline at the station on the proposal's local day whose arrival or departure has the
    /// same number, in the form OCC types it (<see cref="FlightIdentity"/>).
    /// </summary>
    private async Task<Turnaround?> PlannedTurnaroundAsync(long stationId, ExternalFlightProposal arrival,
        ExternalFlightProposal departure, CancellationToken cancellationToken)
    {
        var candidates = await (from turnaround in context.Turnarounds
                                where turnaround.StationId == stationId && turnaround.AirlineId == arrival.AirlineId &&
                                      turnaround.OperationDate == arrival.OperationDate &&
                                      turnaround.CurrentStatus != TurnaroundStatus.Cancelled &&
                                      turnaround.CurrentStatus != TurnaroundStatus.Diverted &&
                                      turnaround.CurrentStatus != TurnaroundStatus.Completed
                                orderby turnaround.Id
                                select turnaround).ToArrayAsync(cancellationToken);
        if (candidates.Length == 0) return null;
        var ids = candidates.Select(item => item.Id).ToArray();
        var legs = await context.FlightLegs.AsNoTracking().Where(leg => ids.Contains(leg.TurnaroundId))
            .Select(leg => new { leg.TurnaroundId, leg.Direction, leg.FlightNumber }).ToArrayAsync(cancellationToken);
        var arrivalNumber = FlightIdentity.NormalizeFlightNumber(arrival.FlightNumber);
        var departureNumber = FlightIdentity.NormalizeFlightNumber(departure.FlightNumber);
        return candidates.FirstOrDefault(turnaround => legs.Any(leg => leg.TurnaroundId == turnaround.Id &&
            FlightIdentity.NormalizeFlightNumber(leg.FlightNumber) ==
                (leg.Direction == FlightDirection.Arrival ? arrivalNumber : departureNumber)));
    }

    /// <summary>
    /// Joins the pair to the planned turnaround: both proposals become Confirmed on its legs and the turnaround only
    /// takes what it lacks (the aircraft type while it is not locked, the registration). Nothing else is created.
    /// </summary>
    private async Task<OccFlightImportResult> LinkAsync(Turnaround planned, ExternalFlightProposal arrival,
        ExternalFlightProposal departure, long accountId, long organizationId, long stationId, Guid stationPublicId,
        OccFlightImportInput input, CancellationToken cancellationToken)
    {
        var now = Now();
        var operation = await context.GroundOperations.AsNoTracking().Where(item => item.TurnaroundId == planned.Id)
            .Select(item => new { item.Id, item.PublicId, item.CurrentStatus }).FirstOrDefaultAsync(cancellationToken);
        if (input.AircraftTypeId is { } requestedType && planned.AircraftTypeId is null)
        {
            var type = await context.AircraftTypes.AsNoTracking().Where(item => item.PublicId == requestedType && item.IsActive)
                .Select(item => (long?)item.Id).SingleOrDefaultAsync(cancellationToken);
            if (type is null) return Failed(OccFlightFeedFailure.Conflict, "aircraft_type_unavailable");
            var submitted = operation is not null && await context.OperationSubmissions.AsNoTracking()
                .AnyAsync(item => item.GroundOperationId == operation.Id, cancellationToken);
            if (!OccTurnaroundRules.IsAircraftTypeLocked(operation?.CurrentStatus, submitted)) planned.AircraftTypeId = type;
        }
        planned.AircraftRegistration ??= arrival.AircraftRegistration ?? departure.AircraftRegistration;
        planned.UpdatedAt = now;
        var legs = await context.FlightLegs.AsNoTracking().Where(leg => leg.TurnaroundId == planned.Id)
            .Select(leg => new { leg.Id, leg.Direction }).ToArrayAsync(cancellationToken);
        foreach (var proposal in new[] { arrival, departure })
        {
            proposal.Status = ExternalFlightProposalStatus.Confirmed;
            proposal.TurnaroundId = planned.Id;
            proposal.FlightLegId = legs.FirstOrDefault(leg => leg.Direction == proposal.Direction)?.Id;
            proposal.DecidedByAccountId = accountId;
            proposal.DecidedAt = now;
            proposal.UpdatedAt = now;
        }
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = now, ActorType = AuditActorType.Account, ActorAccountId = accountId,
            Action = "occ.turnaround.feed_linked", EntityType = nameof(Turnaround), EntityPublicId = planned.PublicId,
            OrganizationId = organizationId, StationId = stationId, Source = AuditSource.Api,
            CorrelationId = input.ArrivalProposalId, Reason = "The provider's flight joined the turnaround OCC had planned.",
            MetadataJson = JsonSerializer.Serialize(new
            {
                provider = arrival.Provider, arrival = arrival.ExternalReference, departure = departure.ExternalReference,
                aircraftTypeId = input.AircraftTypeId,
            }),
        });
        if (operation is not null)
            await AirlineOperationChangeWriter.AddAsync(context, organizationId, operation.PublicId, now, cancellationToken);
        await OccPlanningChangeWriter.AddForStationAsync(context, stationId, stationPublicId, now, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        return new(planned.PublicId, planned.OperationCode, null, Linked: true);
    }

    private static FlightLeg Leg(long turnaroundId, ExternalFlightProposal proposal, long originId, long destinationId,
        DateTimeOffset now) => new()
    {
        PublicId = Guid.CreateVersion7(), TurnaroundId = turnaroundId, Direction = proposal.Direction,
        FlightNumber = proposal.FlightNumber, OriginAirportId = originId, DestinationAirportId = destinationId,
        ScheduledAt = proposal.ScheduledAt, EstimatedAt = proposal.RevisedAt, ActualAt = proposal.RunwayAt,
        Source = OperationalDataSource.ExternalProvider, ExternalReference = proposal.ExternalReference,
        SourceObservedAt = proposal.LastSeenAt, CreatedAt = now, UpdatedAt = now,
    };

    private static bool Allowed(ActorContext? actor, string permission) =>
        actor is not null && actor.HasPermission(permission) &&
        actor.Memberships.Any(membership => membership.Kind == MembershipKind.InternalStaff &&
            membership.OrganizationType == OrganizationType.AviamOperator);

    private static bool Allowed(ActorContext? actor, string permission, Guid stationId) =>
        Allowed(actor, permission) && InScope(actor!, stationId);

    private static bool InScope(ActorContext actor, Guid stationId) =>
        actor.StationScopes.Any(scope => scope.StationId == stationId);

    private Task<long> AccountIdAsync(Guid actorId, CancellationToken cancellationToken) =>
        context.Users.AsNoTracking().Where(user => user.PublicId == actorId).Select(user => user.Id)
            .SingleAsync(cancellationToken);

    private static string Version(byte[] rowVersion) => Convert.ToBase64String(rowVersion);

    private DateTimeOffset Now()
    {
        var value = timeProvider.GetUtcNow();
        return new DateTimeOffset(value.UtcTicks - value.UtcTicks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);
    }

    private static OccFlightImportResult Failed(OccFlightFeedFailure failure, string code,
        IReadOnlyList<string>? reasons = null) => new(null, null, failure, false, code, reasons);

    private static OccFlightProposalRestoreResult RestoreFailed(OccFlightFeedFailure failure, string code) =>
        new(null, null, failure, code);

    private static OccFlightProposalDismissResult DismissFailed(OccFlightFeedFailure failure, string code) =>
        new(failure, code);
}
