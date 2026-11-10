using Elevant.Application.Operations;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>
/// Builds every AVIAM form of an operation from its single record (ADR-0032): flight data typed
/// once, milestones, checklist answers, services, surcharges, deviations and walk-around marks.
/// The output is deterministic, so the same data always yields the same content hash. Before the
/// hand-off (in progress, or returned for correction) the Service Order and the charter request also
/// show the automatic surcharges the hand-off will mark (3-N02): what is signed is what is frozen.
/// A service OCC excluded from billing (3-N11) and a charter service not performed (3-N24) print at
/// zero, out of the total.
/// </summary>
internal sealed class OperationDocumentAssembler(ElevantDbContext context, TimeProvider? timeProvider = null)
{
    /// <summary>What a line OCC excluded from billing in the review says on the forms (3-N11).</summary>
    public const string ExcludedLineSuffix = " · Excluido de la facturación por OCC";

    public sealed record Assembled(IReadOnlyList<OperationDocumentContent> Documents, IReadOnlyList<DamageMarkData> DamageMarks);

    private static readonly string[] BridgeSections = ["PREUSE-", "ARRIVAL-", "DEPARTURE-", "POSTDEPARTURE-"];

    public async Task<Assembled?> AssembleAsync(long operationId, CancellationToken cancellationToken)
    {
        var head = await (from operation in context.GroundOperations.AsNoTracking()
                          join turnaround in context.Turnarounds.AsNoTracking() on operation.TurnaroundId equals turnaround.Id
                          join station in context.Stations.AsNoTracking() on turnaround.StationId equals station.Id
                          join airline in context.Airlines.AsNoTracking() on turnaround.AirlineId equals airline.Id
                          join airport in context.Set<Airport>().AsNoTracking() on station.AirportId equals airport.Id
                          where operation.Id == operationId
                          select new
                          {
                              operation.Id, operation.PassengersIn, operation.PassengersOut, operation.MtowKg,
                              operation.CurrentStatus,
                              TurnaroundId = turnaround.Id, turnaround.OperationCode, turnaround.OperationDate,
                              turnaround.AircraftTypeId, turnaround.AircraftRegistration,
                              StationCode = station.Code, StationName = station.Name, StationTimeZone = station.IanaTimeZone,
                              AirlineName = airline.Name, AirlineIata = airline.IataCode, AirportIcao = airport.IcaoCode,
                          }).SingleOrDefaultAsync(cancellationToken);
        if (head is null) return null;
        // A charter (ADR-0033) is paid in advance and prints the carrier data its representative gave.
        var charterAgreement = await context.Set<CharterAgreement>().AsNoTracking()
            .Where(item => item.TurnaroundId == head.TurnaroundId)
            .Select(item => new { item.CarrierAddress, item.ChargesPayableBy }).SingleOrDefaultAsync(cancellationToken);
        var charter = charterAgreement is null ? null
            : new DocumentCharter($"{head.AirportIcao}/{head.StationCode}", charterAgreement.CarrierAddress,
                charterAgreement.ChargesPayableBy);
        var billingType = charter is null ? "Credit" : "Cash";

        var legs = await (from leg in context.Set<FlightLeg>().AsNoTracking()
                          join origin in context.Set<Airport>().AsNoTracking() on leg.OriginAirportId equals origin.Id
                          join destination in context.Set<Airport>().AsNoTracking() on leg.DestinationAirportId equals destination.Id
                          where leg.TurnaroundId == head.TurnaroundId
                          select new { leg.Direction, leg.FlightNumber, Origin = origin.IataCode, Destination = destination.IataCode,
                              leg.ScheduledAt, leg.ActualAt }).ToArrayAsync(cancellationToken);
        var arrival = legs.FirstOrDefault(leg => leg.Direction == FlightDirection.Arrival);
        var departure = legs.FirstOrDefault(leg => leg.Direction == FlightDirection.Departure);
        var aircraft = head.AircraftTypeId is long typeId
            ? await context.Set<AircraftType>().AsNoTracking().Where(item => item.Id == typeId)
                .Select(item => item.Model + " (" + item.IcaoCode + ")").SingleOrDefaultAsync(cancellationToken)
            : null;
        var stand = await (from assignment in context.Set<StandAssignment>().AsNoTracking()
                           join item in context.Stands.AsNoTracking() on assignment.StandId equals item.Id
                           where assignment.TurnaroundId == head.TurnaroundId && assignment.AssignedTo == null
                           select item.Code).FirstOrDefaultAsync(cancellationToken);
        var agent = await (from assignment in context.OperationAgentAssignments.AsNoTracking()
                           join rampAgent in context.Set<RampAgent>().AsNoTracking() on assignment.RampAgentId equals rampAgent.Id
                           join person in context.Set<Person>().AsNoTracking() on rampAgent.PersonId equals person.Id
                           where assignment.GroundOperationId == operationId && assignment.ReleasedAt == null
                           orderby assignment.AssignedAt
                           select person.FirstName + " " + person.LastName).FirstOrDefaultAsync(cancellationToken);
        var milestones = await context.Set<OperationMilestone>().AsNoTracking()
            .Where(item => item.GroundOperationId == operationId && item.ActualAt != null)
            .Select(item => new { item.Code, item.ActualAt }).ToArrayAsync(cancellationToken);
        var actual = milestones.ToDictionary(item => item.Code, item => item.ActualAt!.Value);

        var flight = new DocumentFlightHeader(head.StationCode, head.StationName, head.StationTimeZone, head.OperationCode, head.OperationDate,
            head.AirlineName, head.AirlineIata,
            arrival?.FlightNumber, arrival?.Origin,
            actual.TryGetValue("BLOCK_ON", out var blockOn) ? blockOn : arrival?.ActualAt ?? arrival?.ScheduledAt,
            departure?.FlightNumber, departure?.Destination,
            actual.TryGetValue("PUSHBACK", out var pushback) ? pushback : departure?.ActualAt ?? departure?.ScheduledAt,
            aircraft, head.AircraftRegistration, stand, head.PassengersIn, head.PassengersOut, head.MtowKg,
            agent ?? "Sin agente asignado");

        var services = await (from service in context.Set<OperationService>().AsNoTracking()
                              join definition in context.Set<ServiceDefinition>().AsNoTracking()
                                  on service.ServiceDefinitionId equals definition.Id
                              where service.GroundOperationId == operationId
                              orderby service.LineNumber
                              select new
                              {
                                  service.Id, service.LineNumber, definition.Code, definition.Name, service.ExecutedQuantity,
                                  service.ContractedQuantity, service.BillingUnitSnapshot, service.UnitPriceSnapshot,
                                  service.CurrencyCodeSnapshot, service.CurrentStatus, service.BillingExcludedAt,
                              }).ToArrayAsync(cancellationToken);
        var lines = services.Select(item =>
        {
            // A charter is agreed and prepaid before the work (ADR-0033): until a quantity is executed,
            // its forms show what the carrier requested, the same total Finance confirms. A charter
            // service not performed (removed by mistake or not served) is no longer requested (3-N24).
            var quantity = charter is null ? item.ExecutedQuantity
                : item.CurrentStatus == ServiceExecutionStatus.NotPerformed ? 0m
                : item.ExecutedQuantity == 0 ? item.ContractedQuantity : item.ExecutedQuantity;
            var amount = item.UnitPriceSnapshot is decimal price ? decimal.Round(price * quantity, 2) : (decimal?)null;
            // 3-N11: a service in exception OCC excluded from billing prints at zero and out of the total.
            if (item.BillingExcludedAt is not null)
                return new DocumentServiceLine(item.LineNumber, item.Code, item.Name + ExcludedLineSuffix, quantity,
                    item.BillingUnitSnapshot, item.UnitPriceSnapshot, 0m);
            return new DocumentServiceLine(item.LineNumber, item.Code, item.Name, quantity, item.BillingUnitSnapshot,
                item.UnitPriceSnapshot, amount);
        }).ToArray();
        var serviceCodes = services.ToDictionary(item => item.Id, item => item.Code);
        var excludedServices = services.Where(item => item.BillingExcludedAt is not null).Select(item => item.Id).ToHashSet();
        var marked = await ChargesAsync(operationId, head.CurrentStatus, cancellationToken);
        var markedIds = marked.Select(item => item.ChargeDefinitionId).Distinct().ToArray();
        var chargeNames = await context.Set<ChargeDefinition>().AsNoTracking()
            .Where(definition => markedIds.Contains(definition.Id))
            .Select(definition => new { definition.Id, definition.Code, definition.Name })
            .ToDictionaryAsync(definition => definition.Id, cancellationToken);
        var surcharges = marked
            .Where(item => serviceCodes.ContainsKey(item.ServiceId) && !excludedServices.Contains(item.ServiceId))
            .Select(item => new DocumentSurcharge(chargeNames[item.ChargeDefinitionId].Code,
                chargeNames[item.ChargeDefinitionId].Name, serviceCodes[item.ServiceId]))
            .OrderBy(item => item.ServiceCode, StringComparer.Ordinal).ThenBy(item => item.Code, StringComparer.Ordinal).ToArray();
        var currency = services.Select(item => item.CurrencyCodeSnapshot).FirstOrDefault(code => code is not null);
        decimal? total = lines.Length > 0 && lines.All(line => line.Amount is not null) ? lines.Sum(line => line.Amount!.Value) : null;

        var checklist = await ChecklistAsync(operationId, cancellationToken);
        var delays = (await context.Set<Incident>().AsNoTracking()
                .Where(item => item.GroundOperationId == operationId && item.DelayCode != null)
                .OrderBy(item => item.OccurredAt).Select(item => new { item.DelayCode, item.Description })
                .ToArrayAsync(cancellationToken))
            .Select(item => new DocumentDelay(item.DelayCode!, item.Description)).ToArray();
        var marks = await context.Set<OperationDamageMark>().AsNoTracking()
            .Where(item => item.GroundOperationId == operationId).OrderBy(item => item.ReportedAt).ThenBy(item => item.Id)
            .Select(item => new DamageMarkData(item.PublicId, item.PositionX, item.PositionY, item.Note, item.ReportedAt,
                item.PhotoObjectKey != null)).ToArrayAsync(cancellationToken);

        var number = OperationDocumentRules.NumberFor(head.StationCode, head.Id);
        var order = FlightReportMilestones.All.ToDictionary(item => item.Code, item => item);
        var documents = new List<OperationDocumentContent>
        {
            new(OperationDocumentRules.SchemaVersion, OperationDocumentKind.ServiceOrder, "F-RAM-AVL-MAG 04", "Rev. 02, 2023",
                "Orden de Servicio en Rampa / Ramp Order Service", number, flight, lines, surcharges, currency, total, billingType,
                [], [], [], [], [], charter),
            new(OperationDocumentRules.SchemaVersion, OperationDocumentKind.FlightReport, "F-OCC-AVL-6.2.12/A9", "Rev. 2, Junio 2023",
                "Reporte de Vuelo", number, flight, [], [], null, null, "Credit",
                checklist.Where(item => item.ItemCode.StartsWith("ARR-", StringComparison.Ordinal) ||
                                        item.ItemCode.StartsWith("PUSH-", StringComparison.Ordinal)).ToArray(),
                milestones.Where(item => order.ContainsKey(item.Code))
                    .OrderBy(item => order[item.Code].SortOrder)
                    .Select(item => new DocumentMilestone(item.Code, order[item.Code].Label, item.ActualAt!.Value)).ToArray(),
                marks.Select(item => new DocumentDamage(item.Id, item.X, item.Y, item.Note)).ToArray(), delays,
                checklist.Where(item => item.Note is not null).Select(item => $"{item.ItemCode}: {item.Note}").ToArray()),
        };
        var bridge = checklist.Where(item => BridgeSections.Any(prefix => item.ItemCode.StartsWith(prefix, StringComparison.Ordinal)))
            .ToArray();
        if (bridge.Length > 0)
            documents.Add(new(OperationDocumentRules.SchemaVersion, OperationDocumentKind.BridgeChecklist,
                "F-MGO-AVL 8.14.1/A1-A2", "Revisión 01: Enero 2022", "Check-List y Reporte Diario Puente Abordaje", number,
                flight, [], [], null, null, "Credit", bridge, [], [], [],
                bridge.Where(item => item.Note is not null).Select(item => $"{item.Section}: {item.Note}").ToArray()));
        if (charter is not null)
            documents.Insert(0, new(OperationDocumentRules.SchemaVersion, OperationDocumentKind.CharterServiceRequest,
                "Solicitud de Servicio", "AVIAM Ltd.",
                "Solicitud de Servicio y Descargo de Responsabilidad e Indemnización / Service Request and Release and " +
                "Waiver of Liability and Indemnity", number, flight, lines, surcharges, currency, total, billingType,
                [], [], [], [], [], charter));
        return new Assembled(documents, marks);
    }

    /// <summary>
    /// The charges the forms list, as (service, charge definition) pairs: the active marks, plus, before the hand-off,
    /// the automatic surcharges it will mark (3-N02). Before the first hand-off the operation ends now when push-back
    /// was not recorded, as that hand-off measures it. Once handed off, a correction round (returned, or in progress
    /// again since the agent opened the correction) ends at the first hand-off and leaves out the automatic marks the
    /// resubmission retires, as the resubmission measures it (3-N09): the order signed in the correction is the one the
    /// resubmission freezes.
    /// </summary>
    private async Task<IReadOnlyList<(long ServiceId, long ChargeDefinitionId)>> ChargesAsync(long operationId,
        GroundOperationStatus status, CancellationToken cancellationToken)
    {
        if (status is GroundOperationStatus.InProgress or GroundOperationStatus.Returned)
        {
            var firstHandOff = await RampEvidenceWindowReader.FirstSubmittedAtAsync(context, operationId, cancellationToken);
            return firstHandOff is { } handedOffAt
                ? await AutomaticSurchargeApplier.ProjectAsync(context, operationId, handedOffAt, true, cancellationToken)
                : await AutomaticSurchargeApplier.ProjectAsync(context, operationId,
                    (timeProvider ?? TimeProvider.System).GetUtcNow(), false, cancellationToken);
        }
        return (await (from charge in context.Set<OperationServiceCharge>().AsNoTracking()
                       join service in context.Set<OperationService>().AsNoTracking()
                           on charge.OperationServiceId equals service.Id
                       where service.GroundOperationId == operationId && charge.RemovedAt == null
                       select new { charge.OperationServiceId, charge.ChargeDefinitionId })
                .ToArrayAsync(cancellationToken))
            .Select(item => (item.OperationServiceId, item.ChargeDefinitionId)).ToArray();
    }

    private async Task<DocumentChecklistAnswer[]> ChecklistAsync(long operationId, CancellationToken cancellationToken)
    {
        var checklist = await context.Set<OperationChecklist>().AsNoTracking()
            .Where(item => item.GroundOperationId == operationId)
            .OrderByDescending(item => item.RevisionNumber).ThenByDescending(item => item.Id)
            .Select(item => new { item.Id, item.ChecklistTemplateVersionId }).FirstOrDefaultAsync(cancellationToken);
        if (checklist is null) return [];
        var items = await context.Set<ChecklistTemplateItem>().AsNoTracking()
            .Where(item => item.ChecklistTemplateVersionId == checklist.ChecklistTemplateVersionId)
            .OrderBy(item => item.SortOrder).ThenBy(item => item.Id)
            .Select(item => new { item.Id, item.ItemCode, item.SectionName, item.Label }).ToArrayAsync(cancellationToken);
        var answers = await context.Set<ChecklistAnswer>().AsNoTracking()
            .Where(item => item.OperationChecklistId == checklist.Id)
            .Select(item => new { item.ChecklistTemplateItemId, item.Value, item.Note }).ToArrayAsync(cancellationToken);
        var byItem = answers.GroupBy(item => item.ChecklistTemplateItemId).ToDictionary(group => group.Key, group => group.Last());
        return items.Select(item => byItem.TryGetValue(item.Id, out var answer)
                ? new DocumentChecklistAnswer(item.ItemCode, item.SectionName, item.Label, answer.Value.ToString(),
                    string.IsNullOrWhiteSpace(answer.Note) ? null : answer.Note.Trim())
                : new DocumentChecklistAnswer(item.ItemCode, item.SectionName, item.Label, null, null))
            .ToArray();
    }
}
