using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Elevant.Domain.Entities;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Infrastructure.Persistence.Seed;

/// <summary>
/// Adds a dated, synthetic operational scenario only when explicitly requested
/// for a marked Development database. Existing operational rows are never reset.
/// </summary>
public sealed class DevelopmentScenarioSeeder(ElevantDbContext context)
{
    public async Task SeedAsync(DateOnly localDate, CancellationToken cancellationToken = default)
    {
        await DatabaseInstanceVerifier.RequireEnvironmentAsync(context, "Development", cancellationToken);
        var strategy = context.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(
                IsolationLevel.Serializable, cancellationToken);
            await SeedInsideTransactionAsync(localDate, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        });
    }

    private async Task SeedInsideTransactionAsync(DateOnly localDate,
        CancellationToken cancellationToken)
    {
        var airline = await context.Airlines.SingleOrDefaultAsync(item => item.IataCode == "ZZ" &&
            item.IsActive, cancellationToken) ?? throw MissingAnchor();
        var station = await context.Stations.SingleOrDefaultAsync(item => item.Code == "PUJ" &&
            item.IsActive, cancellationToken) ?? throw MissingAnchor();
        var terminal = await context.Terminals.SingleOrDefaultAsync(item =>
            item.StationId == station.Id && item.Code == "A" && item.IsActive,
            cancellationToken) ?? throw MissingAnchor();
        var stand = await context.Stands.SingleOrDefaultAsync(item =>
            item.StationId == station.Id && item.TerminalId == terminal.Id &&
            item.Code == "A01" && item.IsActive,
            cancellationToken) ?? throw MissingAnchor();
        var rampAgent = await context.RampAgents.SingleOrDefaultAsync(item =>
            item.EmployeeNumber == "DEV-RA-001" && item.IsActive,
            cancellationToken) ?? throw MissingAnchor();
        var rampPosition = await context.OperationalPositions.SingleOrDefaultAsync(item =>
            item.Code == "RAMP-AGENT" && item.IsActive,
            cancellationToken) ?? throw MissingAnchor();
        var aircraftType = await context.AircraftTypes.SingleOrDefaultAsync(item =>
            item.IcaoCode == "A320" && item.IsActive,
            cancellationToken) ?? throw MissingAnchor();
        var puj = await context.Airports.SingleOrDefaultAsync(item => item.IataCode == "PUJ",
            cancellationToken) ?? throw MissingAnchor();
        var mia = await context.Airports.SingleOrDefaultAsync(item => item.IataCode == "MIA",
            cancellationToken) ?? throw MissingAnchor();
        var occAccount = await context.Users.SingleOrDefaultAsync(item =>
            item.PublicId == Guid.Parse("40000000-0000-7000-8000-000000000001"),
            cancellationToken) ?? throw MissingAnchor();
        var contract = await context.Contracts.SingleOrDefaultAsync(item =>
            item.ContractCode == "DEV-CONTRACT-0001" && item.AirlineId == airline.Id &&
            item.Status == ContractStatus.Active &&
            (item.SignedOn == null || item.SignedOn <= localDate) &&
            (item.TerminatedOn == null || item.TerminatedOn >= localDate.AddDays(1)),
            cancellationToken) ?? throw MissingAnchor();
        var contractVersion = await context.ContractVersions.SingleOrDefaultAsync(item =>
            item.ContractId == contract.Id && item.VersionNumber == 1 &&
            item.Status == ContractVersionStatus.Approved &&
            item.ValidFrom <= localDate &&
            (item.ValidTo == null || item.ValidTo >= localDate.AddDays(1)),
            cancellationToken) ?? throw MissingAnchor();
        if (!await context.Set<ContractVersionStation>().AnyAsync(item =>
                item.ContractVersionId == contractVersion.Id && item.StationId == station.Id,
                cancellationToken)) throw MissingAnchor();
        var baggage = await context.ServiceDefinitions.SingleOrDefaultAsync(item =>
            item.Code == "BAGGAGE" && item.IsActive,
            cancellationToken) ?? throw MissingAnchor();
        var bridge = await context.ServiceDefinitions.SingleOrDefaultAsync(item =>
            item.Code == "PASSENGER-BRIDGE" && item.IsActive,
            cancellationToken) ?? throw MissingAnchor();
        var baggageRate = await context.ContractServiceRates.SingleOrDefaultAsync(item =>
            item.ContractVersionId == contractVersion.Id && item.ServiceDefinitionId == baggage.Id,
            cancellationToken) ?? throw MissingAnchor();
        var bridgeRate = await context.ContractServiceRates.SingleOrDefaultAsync(item =>
            item.ContractVersionId == contractVersion.Id && item.ServiceDefinitionId == bridge.Id,
            cancellationToken) ?? throw MissingAnchor();

        var zone = TimeZoneInfo.FindSystemTimeZoneById(station.IanaTimeZone);
        foreach (var date in new[] { localDate, localDate.AddDays(1) })
        {
            var arrival = ToUtc(date, new TimeOnly(8, 0), zone);
            var departure = ToUtc(date, new TimeOnly(10, 0), zone);
            var stamp = arrival.AddDays(-7);
            var shift = await context.ShiftAssignments.SingleOrDefaultAsync(item =>
                item.RampAgentId == rampAgent.Id && item.WorkDate == date,
                cancellationToken);
            if (shift is null)
            {
                context.ShiftAssignments.Add(Stamp(new ShiftAssignment
                {
                    RampAgentId = rampAgent.Id,
                    StationId = station.Id,
                    TerminalId = terminal.Id,
                    OperationalPositionId = rampPosition.Id,
                    WorkDate = date,
                    StartsAtLocal = new TimeOnly(6, 0),
                    EndsAtLocal = new TimeOnly(14, 0),
                    Block = ShiftBlock.Morning,
                }, Key($"shift:{date:yyyyMMdd}"), stamp));
                await context.SaveChangesAsync(cancellationToken);
            }
            else if (shift.StationId != station.Id || shift.TerminalId != terminal.Id ||
                shift.OperationalPositionId != rampPosition.Id ||
                shift.StartsAtLocal > new TimeOnly(8, 0) ||
                shift.EndsAtLocal < new TimeOnly(10, 0))
            {
                throw new InvalidOperationException(
                    "Existing Development shift does not cover the scenario; no data was changed.");
            }

            var code = $"DEV-CYCLE-{date.ToString("yyyyMMdd", CultureInfo.InvariantCulture)}";
            var expectedId = Key($"turnaround:{date:yyyyMMdd}");
            var existing = await context.Turnarounds.SingleOrDefaultAsync(item =>
                item.OperationCode == code, cancellationToken);
            if (existing is not null)
            {
                if (existing.PublicId != expectedId || existing.AirlineId != airline.Id ||
                    existing.StationId != station.Id || existing.OperationDate != date)
                    throw new InvalidOperationException(
                        "Existing Development scenario operation has conflicting identity or scope.");
                continue; // A real command may already have advanced this operation.
            }
            if (await (from assignedStand in context.Set<StandAssignment>()
                join candidate in context.GroundOperations
                    on assignedStand.TurnaroundId equals candidate.TurnaroundId
                where assignedStand.StandId == stand.Id && assignedStand.AssignedTo == null &&
                    candidate.CurrentStatus != GroundOperationStatus.Cancelled &&
                    (candidate.PlannedStartAt == null || candidate.PlannedEndAt == null ||
                     (candidate.PlannedStartAt < departure &&
                      arrival.AddMinutes(-30) < candidate.PlannedEndAt))
                select candidate.Id).AnyAsync(cancellationToken))
                throw new InvalidOperationException(
                    "A different Development operation overlaps the scenario stand window.");

            var turnaround = Stamp(new Turnaround
            {
                OperationCode = code,
                AirlineId = airline.Id,
                StationId = station.Id,
                OperationDate = date,
                AircraftTypeId = aircraftType.Id,
                AircraftRegistration = "HI-DEV-CYCLE",
                CurrentStatus = TurnaroundStatus.Confirmed,
                Source = OperationalDataSource.Internal,
            }, expectedId, stamp);
            context.Turnarounds.Add(turnaround);
            await context.SaveChangesAsync(cancellationToken);

            context.FlightLegs.AddRange(
                Stamp(new FlightLeg
                {
                    TurnaroundId = turnaround.Id,
                    Direction = FlightDirection.Arrival,
                    FlightNumber = $"ZZ{date:MMdd}A",
                    OriginAirportId = mia.Id,
                    DestinationAirportId = puj.Id,
                    ScheduledAt = arrival,
                    Source = OperationalDataSource.Internal,
                }, Key($"arrival:{date:yyyyMMdd}"), stamp),
                Stamp(new FlightLeg
                {
                    TurnaroundId = turnaround.Id,
                    Direction = FlightDirection.Departure,
                    FlightNumber = $"ZZ{date:MMdd}D",
                    OriginAirportId = puj.Id,
                    DestinationAirportId = mia.Id,
                    ScheduledAt = departure,
                    Source = OperationalDataSource.Internal,
                }, Key($"departure:{date:yyyyMMdd}"), stamp));
            context.Set<StandAssignment>().Add(Stamp(new StandAssignment
            {
                TurnaroundId = turnaround.Id,
                StandId = stand.Id,
                AssignedFrom = arrival.AddMinutes(-30),
                AssignedByAccountId = occAccount.Id,
                Reason = "Synthetic Development scenario.",
            }, Key($"stand:{date:yyyyMMdd}"), stamp));
            var operation = Stamp(new GroundOperation
            {
                TurnaroundId = turnaround.Id,
                CurrentStatus = GroundOperationStatus.Planned,
                PlannedStartAt = arrival,
                PlannedEndAt = departure,
            }, Key($"operation:{date:yyyyMMdd}"), stamp);
            context.GroundOperations.Add(operation);
            await context.SaveChangesAsync(cancellationToken);

            context.OperationServices.AddRange(
                Service(operation.Id, 1, baggage.Id, baggageRate, contractVersion.CurrencyCode,
                    date, stamp),
                Service(operation.Id, 2, bridge.Id, bridgeRate, contractVersion.CurrencyCode,
                    date, stamp));
            await context.SaveChangesAsync(cancellationToken);
        }
    }

    private static OperationService Service(long operationId, int lineNumber,
        long definitionId, ContractServiceRate rate, string currencyCode, DateOnly date,
        DateTimeOffset stamp) => Stamp(new OperationService
        {
            GroundOperationId = operationId,
            LineNumber = lineNumber,
            ServiceDefinitionId = definitionId,
            ContractServiceRateId = rate.Id,
            ContractedQuantity = 1m,
            ExecutedQuantity = 0m,
            BillingUnitSnapshot = rate.BillingUnit,
            UnitPriceSnapshot = rate.UnitPrice,
            CurrencyCodeSnapshot = currencyCode,
            CurrentStatus = ServiceExecutionStatus.Planned,
        }, Key($"service:{date:yyyyMMdd}:{lineNumber}"), stamp);

    private static DateTimeOffset ToUtc(DateOnly date, TimeOnly time, TimeZoneInfo zone) =>
        new(TimeZoneInfo.ConvertTimeToUtc(date.ToDateTime(time), zone), TimeSpan.Zero);

    private static T Stamp<T>(T entity, Guid publicId, DateTimeOffset at) where T : AuditableEntity
    {
        entity.PublicId = publicId;
        entity.CreatedAt = at;
        entity.UpdatedAt = at;
        return entity;
    }

    private static Guid Key(string suffix)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes($"elevant-development-scenario-v1:{suffix}"));
        Span<byte> bytes = stackalloc byte[16];
        hash.AsSpan(0, 16).CopyTo(bytes);
        bytes[6] = (byte)((bytes[6] & 0x0f) | 0x70);
        bytes[8] = (byte)((bytes[8] & 0x3f) | 0x80);
        return new Guid(bytes);
    }

    private static InvalidOperationException MissingAnchor() => new(
        "Required approved synthetic Development anchors are missing or inactive.");
}
