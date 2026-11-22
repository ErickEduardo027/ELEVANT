using System.Data;
using Elevant.Application.Common;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Persistence.Finance;
using Elevant.Persistence.Operations;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Infrastructure.Persistence.Seed.History;

/// <summary>
/// Chunks <c>finance:&lt;month&gt;</c> (part D): Finance invoices the approved operations of each month at PUJ the way
/// «Por facturar» issues them (<c>EfInvoiceIssuanceStore</c>): per airline, the billable services of the approved
/// deliveries are valued from their frozen evidence (minimums and charges, <see cref="FinanceChargeValuation"/>), kept
/// in an internal draft that is invoiced on the spot (ITBIS 18 % by <see cref="FinanceInvoicePolicy.ApplyItbis"/>), and
/// issued as a simulated e-CF with the next E31 read like the API does, inside the chunk's serializable transaction.
/// The collections follow (<see cref="FinanceHistoryCollections"/>). The last six days of the window stay uninvoiced, so
/// «Por facturar» has data. Only inserts: no audit, email, change feed or idempotency receipt.
/// </summary>
internal static class FinanceHistory
{
    public const string ChunkPrefix = "finance:";

    /// <summary>
    /// Services per invoice: the app takes up to 500 billable services and then refuses more than 500 lines after the
    /// valuation adds minimums and charges, so the history keeps room for them.
    /// </summary>
    private const int MaxServicesPerInvoice = 320;

    /// <summary>The operations after this date (the last six days of the window) are never invoiced.</summary>
    public static DateOnly InvoicedThrough(DevelopmentHistoryOptions options) => options.WindowEnd.AddDays(-6);

    public static IEnumerable<HistoryChunk> Chunks(DevelopmentHistoryOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var through = InvoicedThrough(options);
        foreach (var month in options.Months())
        {
            if (month.From > through) yield break;
            var partial = month.To > through;
            var period = new HistoryPeriod(partial ? month.Name + "a" : month.Name, month.From, partial ? through : month.To);
            // A closed month is issued from its next month's third business day; the open one three days after its cut.
            var issueFrom = partial
                ? through.AddDays(3)
                : BusinessDay(new DateOnly(month.To.Year, month.To.Month, 1).AddMonths(1), 3);
            yield return HistoryChunk.Create(ChunkPrefix + period.Name,
                (chunk, ct) => RunMonthAsync(chunk, period, issueFrom, partial, ct), IsolationLevel.Serializable);
        }
    }

    /// <summary>The <paramref name="number"/>-th business day (Monday–Friday) from <paramref name="first"/> on.</summary>
    internal static DateOnly BusinessDay(DateOnly first, int number)
    {
        var day = first;
        var count = 0;
        while (true)
        {
            if (day.DayOfWeek is not (DayOfWeek.Saturday or DayOfWeek.Sunday) && ++count == number) return day;
            day = day.AddDays(1);
        }
    }

    /// <summary>An approved billable service, as the internal draft reads it.</summary>
    internal sealed record SourceRow(long ServiceId, Guid ServicePublicId, int LineNumber, long OperationId,
        Guid OperationPublicId, long TurnaroundId, long? RateId, long SubmissionId, string? EvidenceJson,
        DateTimeOffset SubmittedAt, DateTimeOffset DecidedAt, long DefinitionId, long AirlineId, Guid AirlinePublicId,
        DateOnly OperationDate, string OperationCode, string Code, string Name, ServiceExecutionStatus Status,
        decimal ContractedQuantity, decimal ExecutedQuantity, string Unit, decimal? UnitPrice, string? Currency,
        DateTimeOffset? ExcludedAt);

    /// <summary>One invoice of the chunk with everything it inserts.</summary>
    internal sealed class Issue(string key, HistoryAirline airline, DateTimeOffset issuedAt)
    {
        public string Key { get; } = key;
        public HistoryAirline Airline { get; } = airline;
        public DateTimeOffset IssuedAt { get; } = issuedAt;
        public List<SourceRow> Rows { get; } = [];
        public Preinvoice Draft { get; set; } = null!;
        public List<(PreinvoiceLine Line, PreinvoiceLine? Parent)> Lines { get; } = [];
        public NonFiscalInvoice Invoice { get; set; } = null!;
        public List<NonFiscalInvoiceLine> InvoiceLines { get; } = [];
    }

    private static async Task RunMonthAsync(HistoryChunkContext chunk, HistoryPeriod period, DateOnly issueFrom,
        bool partial, CancellationToken cancellationToken)
    {
        var db = chunk.Db;
        var clock = chunk.Clock;
        var airlines = chunk.Catalog.Airlines.ToDictionary(item => item.Id);
        if (airlines.Count == 0) return;

        // Each airline's issue instant: one of three business days from issueFrom at ~10:00 (the open month: its day).
        var issueAt = new Dictionary<long, DateTimeOffset>();
        foreach (var airline in airlines.Values)
        {
            var random = HistoryRandom.For($"{ChunkPrefix}{period.Name}:{airline.Designator}:issue");
            var day = partial ? issueFrom : BusinessDay(issueFrom, 1 + random.Next(3));
            issueAt[airline.Id] = clock.At(day, new TimeOnly(9, 30).AddMinutes(random.Between(0, 90)));
        }

        var rows = await SourceRowsAsync(chunk, airlines.Keys.ToArray(), period, cancellationToken);
        rows = rows.Where(row => row.DecidedAt < issueAt[row.AirlineId]).ToList();
        rows = await BillableOperationsAsync(db, rows, cancellationToken);
        if (rows.Count == 0) return;
        await RequireNoPackagesAsync(db, rows, cancellationToken);

        // Per airline, operations in order, split so each invoice keeps the limits of 4-N06.
        var issues = new List<Issue>();
        foreach (var group in rows.GroupBy(row => row.AirlineId)
                     .OrderBy(group => airlines[group.Key].Designator, StringComparer.Ordinal))
        {
            var airline = airlines[group.Key];
            Issue? current = null;
            var count = 0;
            var index = 0;
            foreach (var services in group.GroupBy(row => row.OperationId).Select(item => item.ToList()))
            {
                if (current is null || count >= FinanceInvoicePolicy.MaxOperations ||
                    current.Rows.Count + services.Count > MaxServicesPerInvoice)
                {
                    index++;
                    current = new Issue($"{ChunkPrefix}{period.Name}:{airline.Designator}:{index}", airline,
                        issueAt[airline.Id].AddMinutes(7 * (index - 1)));
                    issues.Add(current);
                    count = 0;
                }
                current.Rows.AddRange(services);
                count++;
            }
        }

        foreach (var issue in issues.ToArray())
            if (!await ValueAsync(chunk, issue, cancellationToken)) issues.Remove(issue);
        if (issues.Count == 0) return;

        // Layer 1: the internal drafts, invoiced on the spot.
        await chunk.InsertAsync(issues.Select(issue => issue.Draft), cancellationToken);
        // Layer 2: the service lines; layer 3: their minimum and charge lines (they name their parent line).
        foreach (var issue in issues)
            foreach (var (line, _) in issue.Lines) line.PreinvoiceId = issue.Draft.Id;
        await chunk.InsertAsync(issues.SelectMany(issue => issue.Lines.Where(item => item.Parent is null)
            .Select(item => item.Line)), cancellationToken);
        foreach (var issue in issues)
            foreach (var (line, parent) in issue.Lines.Where(item => item.Parent is not null)) line.ParentLineId = parent!.Id;
        await chunk.InsertAsync(issues.SelectMany(issue => issue.Lines.Where(item => item.Parent is not null)
            .Select(item => item.Line)), cancellationToken);

        // Layer 4: the invoices, numbered with the next E31 in the order they were issued (ADR-0035), and their lines.
        await BuildInvoicesAsync(chunk, issues, cancellationToken);
        await chunk.InsertAsync(issues.Select(issue => issue.Invoice), cancellationToken);
        foreach (var issue in issues)
        {
            var numbers = issue.Lines.ToDictionary(item => item.Line.Id, item => item.Line.LineNumber);
            foreach (var (line, _) in issue.Lines.Where(item => !item.Line.IsExcluded).OrderBy(item => item.Line.LineNumber))
                issue.InvoiceLines.Add(NonFiscalInvoiceLines.From(line, issue.Invoice.Id,
                    line.ParentLineId is { } parent ? numbers[parent] : null,
                    HistoryKeys.Key($"{issue.Key}:invoice-line:{line.LineNumber}"), issue.IssuedAt));
        }
        await chunk.InsertAsync(issues.SelectMany(issue => issue.InvoiceLines), cancellationToken);

        // Layer 5+: what the airlines paid, the credit notes and the treasury account of each invoice.
        await FinanceHistoryCollections.InsertAsync(chunk, period, issues, cancellationToken);
    }

    private static Task<List<SourceRow>> SourceRowsAsync(HistoryChunkContext chunk, long[] airlineIds,
        HistoryPeriod period, CancellationToken cancellationToken)
    {
        var db = chunk.Db;
        var stationId = chunk.Anchors.Station.Id;
        var billable = db.OperationServices.AsNoTracking().Where(ServiceBillability.Billable);
        // The draft store's read (EfPreinvoiceDraftStore): the latest approved hand-off and its approval.
        return (
            from service in billable
            join operation in db.GroundOperations.AsNoTracking() on service.GroundOperationId equals operation.Id
            join turnaround in db.Turnarounds.AsNoTracking() on operation.TurnaroundId equals turnaround.Id
            join airline in db.Airlines.AsNoTracking() on turnaround.AirlineId equals airline.Id
            join definition in db.ServiceDefinitions.AsNoTracking() on service.ServiceDefinitionId equals definition.Id
            join submission in db.OperationSubmissions.AsNoTracking() on operation.Id equals submission.GroundOperationId
            join decision in db.ReviewDecisions.AsNoTracking() on submission.Id equals decision.OperationSubmissionId
            where airlineIds.Contains(turnaround.AirlineId) && turnaround.StationId == stationId &&
                  turnaround.OperationDate >= period.From && turnaround.OperationDate <= period.To &&
                  operation.CurrentStatus == GroundOperationStatus.Approved &&
                  submission.Status == SubmissionStatus.Approved && decision.Outcome == ReviewOutcome.Approved &&
                  !db.OperationSubmissions.AsNoTracking().Any(later =>
                      later.GroundOperationId == operation.Id && later.RevisionNumber > submission.RevisionNumber) &&
                  // Never a service another draft or invoice already holds (the base seed's invoices included).
                  !db.PreinvoiceLines.AsNoTracking().Any(line => line.Kind == PreinvoiceLineKind.Service &&
                      line.OperationServiceId == service.Id && line.ReleasedAt == null)
            orderby turnaround.OperationDate, turnaround.OperationCode, service.LineNumber, service.Id
            select new SourceRow(service.Id, service.PublicId, service.LineNumber, operation.Id, operation.PublicId,
                turnaround.Id, service.ContractServiceRateId, submission.Id,
                decision.ApprovedEvidenceJson ?? submission.EvidenceJson, submission.SubmittedAt, decision.DecidedAt,
                definition.Id, airline.Id, airline.PublicId, turnaround.OperationDate, turnaround.OperationCode,
                definition.Code, definition.Name, service.CurrentStatus, service.ContractedQuantity,
                service.ExecutedQuantity, service.BillingUnitSnapshot, service.UnitPriceSnapshot,
                service.CurrencyCodeSnapshot, service.BillingExcludedAt))
            .ToListAsync(cancellationToken);
    }

    /// <summary>
    /// Keeps the operations whose every billable service the draft would value (evidence matching the live marks,
    /// no charge its contract excludes, a frozen price): «Por facturar» refuses an operation otherwise, so it stays there.
    /// </summary>
    private static async Task<List<SourceRow>> BillableOperationsAsync(ElevantDbContext db, List<SourceRow> rows,
        CancellationToken cancellationToken)
    {
        if (rows.Count == 0) return rows;
        var live = new List<(long ServiceId, Guid PublicId)>();
        foreach (var page in rows.Select(row => row.ServiceId).Chunk(1000))
            live.AddRange((await db.OperationServiceCharges.AsNoTracking()
                    .Where(mark => page.Contains(mark.OperationServiceId) && mark.RemovedAt == null)
                    .Select(mark => new { mark.OperationServiceId, mark.PublicId }).ToArrayAsync(cancellationToken))
                .Select(mark => (mark.OperationServiceId, mark.PublicId)));
        var liveMarks = live.ToLookup(mark => mark.ServiceId, mark => mark.PublicId);
        var frozen = rows.ToDictionary(row => row.ServiceId, Frozen);
        var excluded = await ContractChargeExclusions.ServicesCarryingExcludedAsync(db,
            frozen.SelectMany(item => item.Value.Charges.Select(charge => (item.Key, charge.ChargeId))).ToArray(),
            cancellationToken);
        var blocked = rows.Where(row =>
        {
            var (evidence, charges, _) = frozen[row.ServiceId];
            var matches = evidence is not null &&
                liveMarks[row.ServiceId].Order().SequenceEqual(charges.Select(charge => charge.MarkId).Order()) &&
                evidence.Status == row.Status.ToString() && evidence.ContractedQuantity == row.ContractedQuantity &&
                evidence.ExecutedQuantity == row.ExecutedQuantity && evidence.Unit == row.Unit;
            return !matches || !FinanceApprovedServicePolicy.Evaluate(row.Status, row.ExecutedQuantity, row.UnitPrice,
                row.Currency, row.Unit, row.ExcludedAt is not null, excluded.Contains(row.ServiceId)).Ready;
        }).Select(row => row.OperationId).ToHashSet();
        return rows.Where(row => !blocked.Contains(row.OperationId)).ToList();
    }

    private static (Elevant.Application.Operations.OccReviewServiceData? Evidence,
        IReadOnlyList<ServiceChargeEvidence> Charges, ServiceTimingEvidence? Timing) Frozen(SourceRow row)
    {
        if (row.EvidenceJson is null) return (null, [], null);
        try
        {
            var snapshot = OperationSubmissionEvidence.Parse(row.EvidenceJson);
            return (snapshot.Services.SingleOrDefault(item => item.Id == row.ServicePublicId),
                snapshot.ChargesOf(row.ServicePublicId), snapshot.TimingOf(row.ServicePublicId));
        }
        catch (System.Text.Json.JsonException) { return (null, [], null); }
        catch (InvalidOperationException) { return (null, [], null); }
    }

    /// <summary>The history contracts have no service packages; one would need its consumption rows, which this skips.</summary>
    private static async Task RequireNoPackagesAsync(ElevantDbContext db, List<SourceRow> rows,
        CancellationToken cancellationToken)
    {
        var rateIds = rows.Where(row => row.RateId is not null).Select(row => row.RateId!.Value).Distinct().ToArray();
        var versionIds = await db.ContractServiceRates.AsNoTracking().Where(rate => rateIds.Contains(rate.Id))
            .Select(rate => rate.ContractVersionId).Distinct().ToArrayAsync(cancellationToken);
        if (await db.Set<ContractServicePackage>().AsNoTracking()
                .AnyAsync(link => versionIds.Contains(link.ContractVersionId), cancellationToken))
            throw new InvalidOperationException(
                "Development history: a contract version of the invoiced operations has service packages, which the finance chunks do not value.");
    }

    /// <summary>
    /// The internal draft of <paramref name="issue"/>, valued as <c>EfPreinvoiceDraftStore.DraftForInvoiceAsync</c>
    /// values it and taxed as <c>EfInvoiceIssuanceStore</c> taxes it. False when the app would refuse it (zero total).
    /// </summary>
    private static async Task<bool> ValueAsync(HistoryChunkContext chunk, Issue issue, CancellationToken cancellationToken)
    {
        var db = chunk.Db;
        var anchors = chunk.Anchors;
        var rows = issue.Rows;
        var now = issue.IssuedAt;
        var from = rows.Min(row => row.OperationDate);
        var to = rows.Max(row => row.OperationDate);
        var requestId = HistoryKeys.Key(issue.Key + ":request");
        var frozen = rows.Select(Frozen).ToArray();
        var evaluated = PreinvoiceDraftPolicy.Evaluate(anchors.Station.PublicId, from, to,
            rows.Select(row =>
            {
                var valuation = FinanceApprovedServicePolicy.Evaluate(row.Status, row.ExecutedQuantity, row.UnitPrice,
                    row.Currency, row.Unit, row.ExcludedAt is not null);
                return new PreinvoiceDraftCandidate(row.ServicePublicId, row.AirlinePublicId, anchors.Station.PublicId,
                    row.OperationDate, row.Currency, valuation.Ready, valuation.Amount);
            }).ToArray(),
            FinanceInvoicePolicy.MaxLines);
        if (!evaluated.Ready)
            throw new InvalidOperationException($"Development history: invoice {issue.Key} cannot be valued ({evaluated.Failure}).");

        var rateKeys = rows.Where(row => row.RateId.HasValue).Select(row => row.RateId!.Value).Distinct().ToArray();
        var minimumRates = await (from rate in db.ContractServiceRates.AsNoTracking()
                                  join version in db.ContractVersions.AsNoTracking() on rate.ContractVersionId equals version.Id
                                  where rateKeys.Contains(rate.Id) && version.PricingPolicyVersion > 0
                                  select new { rate.Id, rate.MinimumQuantity })
            .ToDictionaryAsync(item => item.Id, item => item.MinimumQuantity, cancellationToken);
        var minimums = rows.ToDictionary(row => row.ServiceId, row => FinanceMinimumPricingPolicy.TopUp(row.ExecutedQuantity,
            row.RateId is { } key ? minimumRates.GetValueOrDefault(key) : 0, row.UnitPrice!.Value));
        if (minimums.Values.Any(value => value is null))
            throw new InvalidOperationException($"Development history: invoice {issue.Key} has an invalid minimum.");
        var charges = await FinanceChargeValuation.ValueAsync(db, evaluated.Currency!,
            rows.Select((row, index) => new ChargeableService(row.ServiceId, row.OperationId, row.TurnaroundId, row.RateId,
                row.OperationDate, row.ExecutedQuantity, evaluated.Lines[index].Amount + minimums[row.ServiceId]!.Value,
                frozen[index].Charges, row.SubmittedAt, frozen[index].Timing)).ToArray(), cancellationToken);
        if (charges.BlockingReason is not null)
            throw new InvalidOperationException($"Development history: invoice {issue.Key} charges: {charges.BlockingReason}.");

        var draft = HistoryChunkContext.Stamp(new Preinvoice
        {
            AirlineId = issue.Airline.Id, StationId = anchors.Station.Id, CreatedByAccountId = anchors.Finance.Id,
            RequestId = requestId,
            PayloadHash = EfPreinvoiceDraftStore.HashRequest(new CreatePreinvoiceDraftCommand(anchors.Finance.PublicId,
                anchors.Station.PublicId, from, to, requestId, rows.Select(row => row.ServicePublicId).ToArray())),
            From = from, To = to, CurrencyCode = evaluated.Currency!, Status = PreinvoiceStatus.Invoiced,
        }, issue.Key + ":preinvoice", now);

        var lineNumber = 0;
        PreinvoiceLine Line(PreinvoiceLine line)
        {
            line.LineNumber = ++lineNumber;
            return HistoryChunkContext.Stamp(line, $"{issue.Key}:line:{line.LineNumber}", now);
        }
        for (var index = 0; index < rows.Count; index++)
        {
            var row = rows[index];
            var evidence = frozen[index].Evidence;
            var serviceAmount = evaluated.Lines[index].Amount;
            var service = Line(new PreinvoiceLine
            {
                OperationServiceId = row.ServiceId, ApprovedSubmissionId = row.SubmissionId,
                OperationCode = row.OperationCode, OperationDate = row.OperationDate,
                ServiceCode = evidence?.Code ?? row.Code, ServiceName = evidence?.Name ?? row.Name,
                ExecutedQuantity = row.ExecutedQuantity, BillingUnit = row.Unit, UnitPrice = row.UnitPrice!.Value,
                CurrencyCode = row.Currency!, Amount = serviceAmount,
                ComputedQuantity = row.ExecutedQuantity, ComputedAmount = serviceAmount,
                CalculationJson = PreinvoiceLineCalculation.Serialize(row.ServicePublicId, row.RateId, row.ExecutedQuantity,
                    row.Unit, row.UnitPrice, row.Currency, serviceAmount),
            });
            issue.Lines.Add((service, null));
            if (minimums[row.ServiceId] is { } topUp && topUp > 0)
            {
                var quantity = minimumRates[row.RateId!.Value] - row.ExecutedQuantity;
                issue.Lines.Add((Line(new PreinvoiceLine
                {
                    Kind = PreinvoiceLineKind.Minimum, OperationServiceId = row.ServiceId,
                    ApprovedSubmissionId = row.SubmissionId, OperationCode = row.OperationCode,
                    OperationDate = row.OperationDate, ServiceCode = row.Code, ServiceName = "Mínimo contractual · " + row.Name,
                    ExecutedQuantity = quantity, BillingUnit = row.Unit, UnitPrice = row.UnitPrice!.Value,
                    CurrencyCode = row.Currency!, Amount = topUp, ComputedQuantity = quantity, ComputedAmount = topUp,
                    AdjustmentReason = "Complemento hasta el mínimo contractual aprobado",
                }), service));
            }
            foreach (var charge in charges.Charges.Where(charge => charge.ServiceId == row.ServiceId))
                issue.Lines.Add((Line(new PreinvoiceLine
                {
                    Kind = PreinvoiceLineKind.Charge, OperationServiceId = row.ServiceId,
                    ApprovedSubmissionId = row.SubmissionId, ChargeDefinitionId = charge.ChargeDefinitionId,
                    OperationCode = row.OperationCode, OperationDate = row.OperationDate, ServiceCode = charge.Code,
                    ServiceName = charge.Name, ExecutedQuantity = charge.Quantity,
                    BillingUnit = charge.BillingUnit ?? row.Unit, UnitPrice = charge.UnitPrice, CurrencyCode = row.Currency!,
                    Amount = charge.Amount, ComputedQuantity = charge.Quantity, ComputedAmount = charge.Amount,
                    IsExcluded = charge.IsExcluded, ComputedIsExcluded = charge.IsExcluded,
                }), service));
        }

        // The draft's tax capture, then the issuance's fixed ITBIS 18 % on every line.
        var lines = issue.Lines.Select(item => item.Line).ToArray();
        await FinanceTaxSnapshotWriter.ApplyOnceAsync(db, draft, lines, now, cancellationToken);
        foreach (var line in lines) FinanceInvoicePolicy.ApplyItbis(line, now);
        draft.Total = lines.Where(line => !line.IsExcluded).Sum(line => line.Amount);
        issue.Draft = draft;
        if (draft.Total == 0m) return false;
        if (lines.Count(line => !line.IsExcluded) > FinanceInvoicePolicy.MaxLines)
            throw new InvalidOperationException(
                $"Development history: invoice {issue.Key} has more than {FinanceInvoicePolicy.MaxLines} lines.");
        return true;
    }

    /// <summary>The invoices as <c>EfFinanceInvoiceIssueStore</c> issues them, with contiguous E31 in issue order.</summary>
    private static async Task BuildInvoicesAsync(HistoryChunkContext chunk, List<Issue> issues,
        CancellationToken cancellationToken)
    {
        var db = chunk.Db;
        var anchors = chunk.Anchors;
        var organizationIds = issues.Select(issue => issue.Airline.OrganizationId).Append(anchors.AviamOrganizationId)
            .Distinct().ToArray();
        var organizations = await db.Organizations.AsNoTracking().Where(item => organizationIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, cancellationToken);
        var airlineIds = issues.Select(issue => issue.Airline.Id).Distinct().ToArray();
        var identities = await db.Airlines.AsNoTracking().Where(item => airlineIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id,
                item => new FinanceInvoiceSnapshot.AirlineIdentity(item.PublicId, item.Name, item.IataCode, item.IcaoCode),
                cancellationToken);
        var terms = await db.AirlineBillingProfiles.AsNoTracking().Where(item => airlineIds.Contains(item.AirlineId))
            .ToDictionaryAsync(item => item.AirlineId, item => item.PaymentTermDays, cancellationToken);
        var station = new FinanceInvoiceSnapshot.StationIdentity(anchors.Station.PublicId, anchors.Station.Code,
            anchors.Station.Name);
        var aviam = organizations[anchors.AviamOrganizationId];
        var issuer = new FinanceInvoiceSnapshot.Party(aviam.PublicId, aviam.Code, aviam.LegalName, aviam.DisplayName);

        // ADR-0035: the next simulated e-NCF, read like the API under UPDLOCK, HOLDLOCK in the serializable transaction.
        var highest = await db.NonFiscalInvoices
            .FromSqlRaw("SELECT * FROM [commercial].[non_fiscal_invoices] WITH (UPDLOCK, HOLDLOCK)")
            .Where(item => item.FiscalNumber != null).Select(item => item.FiscalNumber).MaxAsync(cancellationToken);
        foreach (var issue in issues.OrderBy(item => item.IssuedAt).ThenBy(item => item.Key, StringComparer.Ordinal))
        {
            var now = issue.IssuedAt;
            var organization = organizations[issue.Airline.OrganizationId];
            var customer = new FinanceInvoiceSnapshot.Party(organization.PublicId, organization.Code, organization.LegalName,
                organization.DisplayName);
            var lines = issue.Lines.Select(item => item.Line).Where(line => !line.IsExcluded).ToArray();
            var days = terms.TryGetValue(issue.Airline.Id, out var value) ? value : 30;
            var invoiceId = HistoryKeys.Key(issue.Key + ":invoice");
            var invoice = HistoryChunkContext.Stamp(new NonFiscalInvoice
            {
                PreinvoiceId = issue.Draft.Id, AirlineId = issue.Airline.Id, StationId = anchors.Station.Id,
                IssuedByAccountId = anchors.Finance.Id, RequestId = issue.Draft.RequestId, Number = $"NF-{invoiceId:N}",
                CurrencyCode = issue.Draft.CurrencyCode, Total = issue.Draft.Total, PaymentTermDays = days,
                // 4-N10: the terms run from the business day of issue in Santo Domingo.
                DueDate = BusinessCalendar.Today(now).AddDays(days),
            }, issue.Key + ":invoice", now);
            invoice.NetTotal = lines.Sum(line => line.NetAmount ?? line.Amount);
            invoice.DiscountTotal = lines.Sum(line => line.DiscountAmount ?? 0);
            invoice.TaxTreatmentsConfigured = lines.All(FinanceTaxCalculator.IsConfigured);
            invoice.TaxTotal = invoice.TaxTreatmentsConfigured ? lines.Sum(line => line.TaxAmount ?? 0) : null;
            invoice.CommercialSnapshotJson = FinanceInvoiceSnapshot.Serialize(invoice, now, issuer, customer,
                identities[issue.Airline.Id], station, organization.TaxRegistration, organization.TaxRegistrationCountryCode);
            highest = FinanceInvoicePolicy.NextFiscalNumber(highest);
            invoice.FiscalNumber = highest;
            invoice.FiscalSignedAt = now;
            invoice.SecurityCode = FinanceInvoicePolicy.SecurityCode(invoice.FiscalNumber, invoice.Total, now, customer.Code);
            issue.Invoice = invoice;
        }
    }
}
