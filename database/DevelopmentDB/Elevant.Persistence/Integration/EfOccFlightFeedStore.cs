using System.Data;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Integrations;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Application.Integration;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Integration;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Operations;
using Elevant.Persistence.Realtime;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Integration;

/// <summary>OCC review of the provider's proposed flights (ADR-0028).</summary>
internal sealed class EfOccFlightFeedStore(
    ElevantDbContext context, IActorContextResolver actors, IAirportFlightFeed feed, FlightFeedBudget budget,
    TimeProvider timeProvider) : IOccFlightFeedStore
{
    private static readonly TimeSpan MinTurn = TimeSpan.FromMinutes(20);
    private static readonly TimeSpan MaxTurn = TimeSpan.FromHours(8);

    public async Task<OccFlightFeedData?> ListAsync(Guid actorId, Guid stationId, DateOnly date,
        CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, "operations.planning.read", stationId)) return null;
        var station = await context.Stations.AsNoTracking().Where(item => item.PublicId == stationId && item.IsActive)
            .Select(item => new { item.Id, item.Code }).SingleOrDefaultAsync(cancellationToken);
        if (station is null) return null;

        var rows = await (from proposal in context.Set<ExternalFlightProposal>().AsNoTracking()
                          join airline in context.Airlines.AsNoTracking() on proposal.AirlineId equals airline.Id
                          join turnaround in context.Turnarounds.AsNoTracking() on proposal.TurnaroundId equals (long?)turnaround.Id
                              into turnarounds
                          from turnaround in turnarounds.DefaultIfEmpty()
                          where proposal.StationId == station.Id && proposal.OperationDate == date &&
                                proposal.Status != ExternalFlightProposalStatus.Dismissed
                          orderby proposal.ScheduledAt, proposal.FlightNumber
                          select new
                          {
                              Proposal = proposal, AirlinePublicId = airline.PublicId, AirlineName = airline.Name,
                              airline.IataCode, TurnaroundPublicId = turnaround == null ? (Guid?)null : turnaround.PublicId,
                          }).ToArrayAsync(cancellationToken);
        var suggestions = SuggestDepartures(rows.Select(row => row.Proposal).ToArray());

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
            lastRead, nextManual > now ? nextManual : null, actor!.HasPermission("operations.planning.create"),
            rows.Select(row => new OccFlightProposalData(row.Proposal.PublicId, row.Proposal.Direction.ToString(),
                row.Proposal.FlightNumber, row.AirlinePublicId, row.AirlineName, row.IataCode, row.Proposal.CounterpartIata,
                row.Proposal.CounterpartName, row.Proposal.CounterpartAirportId is not null, row.Proposal.ScheduledAt,
                row.Proposal.RevisedAt, row.Proposal.RunwayAt, row.Proposal.ProviderStatus, row.Proposal.AircraftRegistration,
                row.Proposal.AircraftModel, row.Proposal.Terminal, row.Proposal.Gate, row.Proposal.Status.ToString(),
                row.TurnaroundPublicId,
                suggestions.TryGetValue(row.Proposal.Id, out var suggested) ? suggested : null, row.Proposal.LastSeenAt)).ToArray());
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

    public async Task<OccFlightImportResult> ImportAsync(Guid actorId, Guid arrivalProposalId, Guid departureProposalId,
        CancellationToken cancellationToken = default)
    {
        try
        {
            return await context.Database.CreateExecutionStrategy().ExecuteAsync(async token =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable, token);
                var result = await ImportInsideTransactionAsync(actorId, arrivalProposalId, departureProposalId, token);
                if (result.Failure is null && !result.Replayed) await transaction.CommitAsync(token);
                return result;
            }, cancellationToken);
        }
        catch (Exception exception) when (exception is DbUpdateConcurrencyException ||
                                          exception is DbUpdateException { InnerException: SqlException { Number: 1205 or 2601 or 2627 } } ||
                                          exception is SqlException { Number: 1205 })
        {
            context.ChangeTracker.Clear();
            return new(null, null, OccFlightFeedFailure.Conflict);
        }
    }

    private async Task<OccFlightImportResult> ImportInsideTransactionAsync(Guid actorId, Guid arrivalId, Guid departureId,
        CancellationToken cancellationToken)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        var proposals = await context.Set<ExternalFlightProposal>()
            .Where(item => item.PublicId == arrivalId || item.PublicId == departureId).ToArrayAsync(cancellationToken);
        var arrival = proposals.SingleOrDefault(item => item.PublicId == arrivalId);
        var departure = proposals.SingleOrDefault(item => item.PublicId == departureId);
        if (arrival is null || departure is null) return Failed(OccFlightFeedFailure.NotFound);
        var station = await (from item in context.Stations.AsNoTracking()
                             join airport in context.Airports.AsNoTracking() on item.AirportId equals airport.Id
                             where item.Id == arrival.StationId && item.IsActive
                             select new { item.Id, item.PublicId, AirportId = airport.Id }).SingleOrDefaultAsync(cancellationToken);
        if (station is null) return Failed(OccFlightFeedFailure.NotFound);
        if (!Allowed(actor, "operations.planning.create", station.PublicId)) return Failed(OccFlightFeedFailure.Forbidden);

        if (arrival.Status == ExternalFlightProposalStatus.Confirmed && departure.Status == ExternalFlightProposalStatus.Confirmed &&
            arrival.TurnaroundId == departure.TurnaroundId && arrival.TurnaroundId is { } existingId)
        {
            var existing = await context.Turnarounds.AsNoTracking().Where(item => item.Id == existingId)
                .Select(item => new { item.PublicId, item.OperationCode }).SingleAsync(cancellationToken);
            return new(existing.PublicId, existing.OperationCode, null, true);
        }
        if (arrival.Direction != FlightDirection.Arrival || departure.Direction != FlightDirection.Departure ||
            arrival.Status != ExternalFlightProposalStatus.Proposed || departure.Status != ExternalFlightProposalStatus.Proposed ||
            arrival.StationId != departure.StationId || arrival.AirlineId != departure.AirlineId ||
            departure.ScheduledAt <= arrival.ScheduledAt || departure.ScheduledAt - arrival.ScheduledAt > TimeSpan.FromHours(24))
            return Failed(OccFlightFeedFailure.Conflict);
        if (arrival.CounterpartAirportId is not { } originId || departure.CounterpartAirportId is not { } destinationId)
            return Failed(OccFlightFeedFailure.CounterpartUnknown);

        var contracts = await ApplicableContracts.For(context, arrival.AirlineId, station.Id, arrival.OperationDate)
            .Select(row => row.VersionId).Take(2).ToArrayAsync(cancellationToken);
        if (contracts.Length != 1) return Failed(OccFlightFeedFailure.Conflict);
        var airline = await context.Airlines.AsNoTracking().Where(item => item.Id == arrival.AirlineId && item.IsActive)
            .Select(item => new { item.OrganizationId }).SingleOrDefaultAsync(cancellationToken);
        if (airline is null) return Failed(OccFlightFeedFailure.Conflict);
        var accountId = await context.Users.AsNoTracking().Where(user => user.PublicId == actorId).Select(user => user.Id)
            .SingleAsync(cancellationToken);

        var now = timeProvider.GetUtcNow();
        var turnaroundId = Guid.CreateVersion7();
        var turnaround = new Turnaround
        {
            PublicId = turnaroundId, OperationCode = $"EXT-{turnaroundId:N}", AirlineId = arrival.AirlineId,
            StationId = station.Id, OperationDate = arrival.OperationDate, ContractVersionId = contracts[0],
            AircraftRegistration = arrival.AircraftRegistration ?? departure.AircraftRegistration,
            CurrentStatus = TurnaroundStatus.Confirmed, Source = OperationalDataSource.ExternalProvider,
            ExternalProvider = arrival.Provider, ExternalReference = arrival.ExternalReference,
            SourceObservedAt = arrival.LastSeenAt, CreatedAt = now, UpdatedAt = now,
        };
        context.Turnarounds.Add(turnaround);
        await context.SaveChangesAsync(cancellationToken);
        var arrivalLeg = Leg(turnaround.Id, arrival, originId, station.AirportId, now);
        var departureLeg = Leg(turnaround.Id, departure, station.AirportId, destinationId, now);
        context.FlightLegs.AddRange(arrivalLeg, departureLeg);
        var operation = new GroundOperation
        {
            PublicId = Guid.CreateVersion7(), TurnaroundId = turnaround.Id, CurrentStatus = GroundOperationStatus.Planned,
            PlannedStartAt = arrival.RevisedAt ?? arrival.ScheduledAt, PlannedEndAt = departure.RevisedAt ?? departure.ScheduledAt,
            CreatedAt = now, UpdatedAt = now,
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
            OrganizationId = airline.OrganizationId, StationId = station.Id, Source = AuditSource.Api, CorrelationId = arrivalId,
            Reason = "Imported from the provider flight feed by OCC.",
            MetadataJson = JsonSerializer.Serialize(new
            {
                provider = arrival.Provider, arrival = arrival.ExternalReference, departure = departure.ExternalReference,
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

    public async Task<OccFlightFeedFailure?> DismissAsync(Guid actorId, Guid proposalId,
        CancellationToken cancellationToken = default)
    {
        var proposal = await context.Set<ExternalFlightProposal>().SingleOrDefaultAsync(item => item.PublicId == proposalId,
            cancellationToken);
        if (proposal is null) return OccFlightFeedFailure.NotFound;
        var station = await context.Stations.AsNoTracking().Where(item => item.Id == proposal.StationId)
            .Select(item => item.PublicId).SingleAsync(cancellationToken);
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, "operations.planning.create", station)) return OccFlightFeedFailure.Forbidden;
        if (proposal.Status == ExternalFlightProposalStatus.Dismissed) return null;
        if (proposal.Status == ExternalFlightProposalStatus.Confirmed) return OccFlightFeedFailure.Conflict;
        var now = timeProvider.GetUtcNow();
        proposal.Status = ExternalFlightProposalStatus.Dismissed;
        proposal.DecidedAt = now;
        proposal.DecidedByAccountId = await context.Users.AsNoTracking().Where(user => user.PublicId == actorId)
            .Select(user => user.Id).SingleAsync(cancellationToken);
        proposal.UpdatedAt = now;
        await OccPlanningChangeWriter.AddForStationAsync(context, proposal.StationId, station, now, cancellationToken);
        try
        {
            await context.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return OccFlightFeedFailure.Conflict;
        }
        return null;
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

    private static bool Allowed(ActorContext? actor, string permission, Guid stationId) =>
        actor is not null && actor.HasPermission(permission) &&
        actor.Memberships.Any(membership => membership.Kind == MembershipKind.InternalStaff &&
            membership.OrganizationType == OrganizationType.AviamOperator) &&
        actor.StationScopes.Any(scope => scope.StationId == stationId);

    private static OccFlightImportResult Failed(OccFlightFeedFailure failure) => new(null, null, failure);
}
