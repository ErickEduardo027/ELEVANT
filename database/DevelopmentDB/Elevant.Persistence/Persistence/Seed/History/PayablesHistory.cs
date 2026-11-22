using System.Globalization;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;

namespace Elevant.Infrastructure.Persistence.Seed.History;

/// <summary>
/// Chunk <c>payables</c> (part D), the last one and so the final sentinel: AVIAM's suppliers at PUJ and their invoices
/// through the window, in the shapes of <c>FinancePayablesStore</c>. A disabled internal account «Cuentas por pagar»
/// registers and submits each invoice and records and applies the payments; the Finanzas account approves or rejects
/// (4-N14, segregation of duties by person). About ten invoices a month: 70 % approved, 15 % submitted, 8 % rejected
/// with a reason, 7 % draft; ITBIS 18 % per line; DOP (rate 1) or USD at the fx chunk's rate. Three of four approved
/// invoices are paid, some partially. Only inserts; nothing after the end of the window.
/// </summary>
internal static class PayablesHistory
{
    public const string ChunkName = "payables";

    /// <summary>The disabled internal account that registers the history's supplier invoices and payments.</summary>
    public static readonly string ClerkEmail = "cuentas.por.pagar.historial@dev.elevant.test";

    private sealed record SupplierSource(string Code, string Name, string TaxReference, string Currency, int Terms,
        string[] Items, decimal MinPrice, decimal MaxPrice);

    private static readonly SupplierSource[] Suppliers =
    [
        new("HIST-SUP-FUEL", "Combustibles del Este, S.R.L.", "131245678", "USD", 30,
            ["Diésel para equipos de rampa (galones)", "Gasolina para vehículos de plataforma (galones)", "Aditivo para combustible"], 3.2m, 6.5m),
        new("HIST-SUP-GSE", "Mantenimiento GSE Caribe, S.A.", "130987654", "USD", 30,
            ["Mantenimiento preventivo de tractor de empuje", "Reparación de GPU", "Cambio de neumáticos de dolly", "Revisión de cinta transportadora"], 180m, 1450m),
        new("HIST-SUP-UNIF", "Uniformes Punta Cana, E.I.R.L.", "131556677", "DOP", 45,
            ["Chaleco reflectivo", "Camisa de uniforme", "Protector auditivo", "Botas de seguridad"], 450m, 3800m),
        new("HIST-SUP-CLEAN", "Limpieza Integral Bávaro, S.R.L.", "131778899", "DOP", 15,
            ["Limpieza de oficinas de operaciones", "Limpieza de salas de descanso", "Suministros de limpieza"], 2500m, 18000m),
        new("HIST-SUP-IT", "Soluciones TI del Caribe, S.R.L.", "130665544", "USD", 30,
            ["Licencias de software de operaciones", "Soporte de red de la estación", "Radios portátiles (alquiler)"], 90m, 950m),
        new("HIST-SUP-SEC", "Seguridad Aeroportuaria Oriental, S.A.", "130443322", "DOP", 30,
            ["Servicio de vigilancia de almacén", "Control de acceso a plataforma", "Escolta de carga valiosa"], 6000m, 42000m),
        new("HIST-SUP-RENT", "Alquileres Industriales del Este, S.R.L.", "131889900", "USD", 30,
            ["Alquiler de montacargas", "Alquiler de tractor de equipaje", "Alquiler de contenedor de almacenaje"], 250m, 2400m),
        new("HIST-SUP-TRAIN", "Centro de Formación Aeronáutica, S.R.L.", "131112233", "DOP", 45,
            ["Curso de seguridad en rampa", "Recurrente de manejo de mercancías peligrosas", "Curso de conducción en plataforma"], 4500m, 25000m),
    ];

    public static IEnumerable<HistoryChunk> Chunks(DevelopmentHistoryOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        yield return HistoryChunk.Create(ChunkName, RunAsync);
    }

    private sealed class Plan(string key, SupplierSource source)
    {
        public string Key { get; } = key;
        public SupplierSource Source { get; } = source;
        public SupplierInvoice Invoice { get; set; } = null!;
        public List<(string Description, decimal Quantity, decimal UnitPrice, decimal Tax)> Lines { get; } = [];
        public DateTimeOffset Created { get; set; }
        public DateTimeOffset? Submitted { get; set; }
        public DateTimeOffset? Decided { get; set; }
        public string? RejectReason { get; set; }
        public (DateOnly Day, DateTimeOffset At, decimal Amount)? Payment { get; set; }
    }

    private static async Task RunAsync(HistoryChunkContext chunk, CancellationToken cancellationToken)
    {
        var anchors = chunk.Anchors;
        var clock = chunk.Clock;
        var options = chunk.Options;
        var station = anchors.Station.Id;
        var finance = anchors.Finance.Id;
        var start = clock.At(options.WindowStart, new TimeOnly(8, 0));
        var lastDay = options.WindowEnd;
        var cap = clock.ToUtc(lastDay, HistoryClock.DayEnd);

        // Layer 1: the person of the «Cuentas por pagar» clerk; layer 2: its disabled account; layer 3: its membership
        // in AVIAM and the suppliers it registered.
        var person = HistoryChunkContext.Stamp(new Person
        {
            FirstName = "Cuentas", LastName = "por Pagar", PrimaryEmail = ClerkEmail,
            IdentificationType = "Synthetic", IdentificationNumber = "HIST-AP-CLERK",
        }, "person:payables-clerk", start);
        await chunk.InsertAsync([person], cancellationToken);
        var clerk = new ApplicationUser
        {
            PublicId = HistoryKeys.Key("account:payables-clerk"), PersonId = person.Id, UserName = ClerkEmail,
            NormalizedUserName = ClerkEmail.ToUpperInvariant(), Email = ClerkEmail, NormalizedEmail = ClerkEmail.ToUpperInvariant(),
            EmailConfirmed = true, LockoutEnabled = true, PasswordHash = null,
            // Disabled and without password: it only records who registered the history's payables.
            Status = AccountLifecycleStatus.Disabled, InvitationStatus = InvitationStatus.Accepted,
            SecurityStamp = HistoryKeys.Key("account:payables-clerk:security").ToString("D"),
            ConcurrencyStamp = HistoryKeys.Key("account:payables-clerk:concurrency").ToString("D"),
            CreatedAt = start, UpdatedAt = start,
        };
        await chunk.InsertAsync([clerk], cancellationToken);
        var suppliers = Suppliers.Select(source => HistoryChunkContext.Stamp(new Supplier
        {
            ScopeStationId = station, Code = source.Code, Name = source.Name, TaxReference = source.TaxReference,
            ContactEmail = null, IsActive = true, CreatedByAccountId = clerk.Id,
        }, $"payables:supplier:{source.Code}", start)).ToArray();
        await chunk.InsertAsync(suppliers.Cast<object>().Append(HistoryChunkContext.Stamp(new OrganizationMembership
        {
            AccountId = clerk.Id, OrganizationId = anchors.AviamOrganizationId, Kind = MembershipKind.InternalStaff,
            Status = MembershipStatus.Active, JobTitle = "Cuentas por pagar", ValidFrom = options.WindowStart,
        }, "membership:payables-clerk", start)), cancellationToken);
        var supplierIds = suppliers.ToDictionary(item => item.Code, item => item.Id);

        // The invoices of each month: dates, lines, review path and payment, all drawn from the month's stream.
        var plans = new List<Plan>();
        var sequence = new Dictionary<string, int>(StringComparer.Ordinal);
        DateTimeOffset Office(HistoryRandom random, DateOnly day) =>
            clock.At(day, new TimeOnly(8, 30).AddMinutes(random.Between(0, 510)));
        foreach (var month in options.Months())
        {
            var random = HistoryRandom.For("payables:" + month.Name);
            var days = month.To.DayNumber - month.From.DayNumber + 1;
            var count = Math.Max(1, (int)Math.Round(10.0 * days / 30.0, MidpointRounding.AwayFromZero));
            for (var index = 1; index <= count; index++)
            {
                var source = Suppliers[random.Next(Suppliers.Length)];
                var number = sequence[source.Code] = sequence.GetValueOrDefault(source.Code) + 1;
                var plan = new Plan($"payables:{month.Name}:{index}", source);
                var documentDate = month.From.AddDays(random.Next(days));
                var created = Office(random, documentDate.AddDays(random.Between(0, 3)));
                // Registered on the document's day when the extra days would fall after the end of the window.
                if (created > cap) created = Office(random, documentDate);
                plan.Created = created;
                foreach (var line in Enumerable.Range(0, random.Between(1, 4)))
                {
                    var item = random.Pick(source.Items);
                    var quantity = (decimal)random.Between(1, 20);
                    var price = random.Decimal(source.MinPrice, source.MaxPrice);
                    plan.Lines.Add((item, quantity, price, FinanceInvoicePolicy.Tax(quantity * price)));
                }
                var status = new[]
                {
                    SupplierInvoiceStatus.Approved, SupplierInvoiceStatus.Submitted, SupplierInvoiceStatus.Rejected,
                    SupplierInvoiceStatus.Draft,
                }[random.Weighted([70, 15, 8, 7])];
                if (status != SupplierInvoiceStatus.Draft)
                {
                    plan.Submitted = Next(clock, random, created, 0, 1, cap);
                    if (plan.Submitted is null) status = SupplierInvoiceStatus.Draft;
                }
                if (status is SupplierInvoiceStatus.Approved or SupplierInvoiceStatus.Rejected)
                {
                    plan.Decided = Next(clock, random, plan.Submitted!.Value, 1, 4, cap);
                    if (plan.Decided is null) status = SupplierInvoiceStatus.Submitted;
                }
                if (status == SupplierInvoiceStatus.Rejected)
                    plan.RejectReason = random.Pick(new[]
                    {
                        "El NCF no corresponde al RNC del proveedor; solicitar comprobante corregido.",
                        "Las cantidades facturadas no coinciden con la orden de compra.",
                        "Falta la conformidad de recepción del servicio por Operaciones.",
                    });
                var fxDate = documentDate;
                var fx = source.Currency == "DOP" ? 1m
                    : decimal.Round(chunk.Catalog.UsdToDopOn(documentDate) ?? 60m, 8, MidpointRounding.AwayFromZero);
                if (source.Currency == "USD" && !chunk.Catalog.UsdToDop.ContainsKey(documentDate))
                    fxDate = chunk.Catalog.UsdToDop.Keys.Where(day => day <= documentDate).DefaultIfEmpty(documentDate).Max();
                var total = plan.Lines.Sum(line => FinancePayablesPolicy.LineTotal(line.Quantity, line.UnitPrice, line.Tax));
                var due = documentDate.AddDays(source.Terms);
                if (status == SupplierInvoiceStatus.Approved && random.Chance(0.75))
                {
                    var wanted = clock.LocalDate(plan.Decided!.Value).AddDays(random.Between(2, Math.Max(3, due.DayNumber -
                        clock.LocalDate(plan.Decided!.Value).DayNumber + 10)));
                    if (wanted > lastDay) wanted = lastDay;
                    var at = Office(random, wanted);
                    if (at > plan.Decided && at <= cap)
                    {
                        var amount = random.Chance(0.2)
                            ? FinancePayablesPolicy.Round(decimal.Round(total * random.Decimal(0.40m, 0.80m), 2, MidpointRounding.AwayFromZero))
                            : total;
                        plan.Payment = (wanted, at, amount);
                    }
                }
                var updated = plan.Payment?.At ?? plan.Decided ?? plan.Submitted ?? created;
                plan.Invoice = HistoryChunkContext.Stamp(new SupplierInvoice
                {
                    SupplierId = supplierIds[source.Code],
                    // The NCF of the supplier's comprobante (B01 crédito fiscal), uppercase as the store keeps it.
                    DocumentReference = string.Create(CultureInfo.InvariantCulture, $"B01{number + 100 * (Array.IndexOf(Suppliers, source) + 1):D8}"),
                    DocumentDate = documentDate, DueDate = due, Status = status, ScopeStationId = station,
                    StationId = station, CurrencyCode = source.Currency, FxToDop = fx,
                    FxSource = source.Currency == "DOP" ? "Moneda local" : "Tasa registrada USD/DOP",
                    FxDate = fxDate, Total = total, TotalDop = FinancePayablesPolicy.Round(total * fx),
                    CreatedByAccountId = clerk.Id,
                }, plan.Key + ":invoice", created, updated);
                plans.Add(plan);
            }
        }

        // Layer 4: the invoices; layer 5: their lines, reviews and payments; layer 6: the applications.
        await chunk.InsertAsync(plans.Select(plan => plan.Invoice), cancellationToken);
        var layer = new List<object>();
        var payments = new List<(Plan Plan, FinancePayablesPayment Payment)>();
        foreach (var plan in plans)
        {
            var id = plan.Invoice.Id;
            layer.AddRange(plan.Lines.Select((line, index) => new SupplierInvoiceLine
            {
                PublicId = HistoryKeys.Key($"{plan.Key}:line:{index + 1}"), DocumentId = id, LineNumber = index + 1,
                Description = line.Description, Quantity = line.Quantity, UnitPrice = line.UnitPrice, TaxAmount = line.Tax,
                Total = FinancePayablesPolicy.LineTotal(line.Quantity, line.UnitPrice, line.Tax),
            }));
            if (plan.Submitted is { } submitted)
                layer.Add(new SupplierInvoiceReview
                {
                    DocumentId = id, Stage = "Submission", Decision = nameof(SupplierInvoiceStatus.Submitted),
                    ActorAccountId = clerk.Id, DecidedAt = submitted,
                });
            if (plan.Decided is { } decided)
                layer.Add(new SupplierInvoiceReview
                {
                    DocumentId = id, Stage = "Finance", Decision = plan.Invoice.Status.ToString(), Reason = plan.RejectReason,
                    ActorAccountId = finance, DecidedAt = decided,
                });
            if (plan.Payment is { } paid)
            {
                var payment = HistoryChunkContext.Stamp(new FinancePayablesPayment
                {
                    SupplierId = plan.Invoice.SupplierId, ScopeStationId = station,
                    Reference = $"TRF-{plan.Invoice.DocumentReference}", PaidOn = paid.Day,
                    CurrencyCode = plan.Invoice.CurrencyCode, FxToDop = plan.Invoice.FxToDop, FxSource = plan.Invoice.FxSource,
                    FxDate = plan.Invoice.FxDate, Amount = paid.Amount,
                    AmountDop = FinancePayablesPolicy.Round(paid.Amount * plan.Invoice.FxToDop), CreatedByAccountId = clerk.Id,
                }, plan.Key + ":payment", paid.At);
                payments.Add((plan, payment));
                layer.Add(payment);
            }
        }
        await chunk.InsertAsync(layer, cancellationToken);
        await chunk.InsertAsync(payments.Select(item => new FinancePayablesApplication
        {
            PublicId = HistoryKeys.Key(item.Plan.Key + ":application"), PaymentId = item.Payment.Id,
            SupplierInvoiceId = item.Plan.Invoice.Id, PaymentAmount = item.Payment.Amount,
            InvoiceAmount = item.Payment.Amount, RateToInvoice = 1m, ActorAccountId = clerk.Id,
            AppliedAt = item.Payment.CreatedAt,
        }), cancellationToken);
    }

    /// <summary>An office instant <paramref name="min"/>–<paramref name="max"/> days after <paramref name="after"/>, or null past the cap.</summary>
    private static DateTimeOffset? Next(HistoryClock clock, HistoryRandom random, DateTimeOffset after, int min, int max,
        DateTimeOffset cap)
    {
        var day = clock.LocalDate(after).AddDays(random.Between(min, max));
        var at = clock.At(day, new TimeOnly(8, 30).AddMinutes(random.Between(0, 510)));
        if (at <= after) at = after.AddMinutes(random.Between(20, 90));
        at = clock.Clamp(at);
        return at <= after || at > cap ? null : at;
    }
}
