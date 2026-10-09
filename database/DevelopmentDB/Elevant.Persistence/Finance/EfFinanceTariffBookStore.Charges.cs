using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

internal sealed partial class EfFinanceTariffBookStore
{
    public async Task<IReadOnlyList<ChargeDefinitionData>?> ListChargesAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor is null || !(actor.HasPermission("finance.charges.read") || actor.HasPermission("contracts.drafts.read")))
            return null;
        var charges = await context.ChargeDefinitions.AsNoTracking().OrderBy(charge => charge.Code)
            .ToArrayAsync(cancellationToken);
        var scopes = (await (from link in context.ChargeDefinitionServices.AsNoTracking()
                             join service in context.ServiceDefinitions.AsNoTracking() on link.ServiceDefinitionId equals service.Id
                             select new { link.ChargeDefinitionId, service.PublicId }).ToArrayAsync(cancellationToken))
            .ToLookup(item => item.ChargeDefinitionId, item => item.PublicId);
        return charges.Select(charge => new ChargeDefinitionData(charge.PublicId, charge.Code, charge.Name,
            charge.Description, charge.Category.ToString(), charge.Method.ToString(), charge.QuantityRule.ToString(),
            charge.GraceMinutes, charge.RoundingIncrement, charge.AppliesToAllServices, scopes[charge.Id].ToArray(),
            charge.AllowMultiple, charge.VisibleToAgents, charge.IsActive, charge.BillingUnit,
            Version(charge.RowVersion))).ToArray();
    }

    /// <summary>
    /// Method and quantity rule must agree: fixed and percentage charges apply once,
    /// time-based charges measure a recorded duration and unit charges need a unit.
    /// </summary>
    public static bool ValidChargeShape(ChargeCalculationMethod method, ChargeQuantityRule rule) => method switch
    {
        ChargeCalculationMethod.FixedAmount or ChargeCalculationMethod.PercentOfService => rule == ChargeQuantityRule.One,
        ChargeCalculationMethod.PerHour or ChargeCalculationMethod.PerMinute => rule is ChargeQuantityRule.ServiceDuration
            or ChargeQuantityRule.OperationOverrun or ChargeQuantityRule.ArrivalDelay,
        ChargeCalculationMethod.PerUnit => rule is ChargeQuantityRule.One or ChargeQuantityRule.ServiceQuantity,
        _ => false,
    };

    public async Task<FinanceCatalogResult> SaveChargeAsync(Guid actorId, Guid? chargeId, SaveChargeDefinitionInput input,
        CancellationToken cancellationToken = default)
    {
        var actor = await AuthorizeAsync(actorId, "finance.charges.manage", cancellationToken);
        if (actor is null) return FinanceCatalogResult.Failed(FinanceCatalogFailure.Forbidden);
        var code = input?.Code?.Trim().ToUpperInvariant();
        if (input is null || code is null || code.Length is < 2 or > 32 ||
            !code.All(character => char.IsAsciiLetterUpper(character) || char.IsAsciiDigit(character) || character is '-' or '_') ||
            string.IsNullOrWhiteSpace(input.Name) || input.Name.Trim().Length > 120 || input.Description?.Length > 500 ||
            !Enum.TryParse<ChargeCategory>(input.Category, false, out var category) ||
            !Enum.TryParse<ChargeCalculationMethod>(input.Method, false, out var method) ||
            !Enum.TryParse<ChargeQuantityRule>(input.QuantityRule, false, out var rule) ||
            !ValidChargeShape(method, rule) || input.GraceMinutes is < 0 or > 1440 ||
            input.RoundingIncrement is < 0 or > 1000 ||
            !input.AppliesToAllServices && input.ServiceIds is not { Count: > 0 and <= 100 } ||
            chargeId is not null && string.IsNullOrWhiteSpace(input.ExpectedVersion))
            return FinanceCatalogResult.Failed(FinanceCatalogFailure.Invalid);
        var unit = string.IsNullOrWhiteSpace(input.BillingUnit) ? null : input.BillingUnit.Trim();
        if (method == ChargeCalculationMethod.PerUnit && unit is null ||
            unit is not null && !await ActiveUnitAsync(unit, cancellationToken))
            return FinanceCatalogResult.Failed(FinanceCatalogFailure.Invalid);
        var serviceIds = input.AppliesToAllServices ? [] : input.ServiceIds!.Distinct().ToArray();
        var services = await context.ServiceDefinitions.AsNoTracking().Where(service => serviceIds.Contains(service.PublicId))
            .Select(service => service.Id).ToArrayAsync(cancellationToken);
        if (services.Length != serviceIds.Length) return FinanceCatalogResult.Failed(FinanceCatalogFailure.Invalid);

        return await InTransactionAsync(async () =>
        {
            var now = timeProvider.GetUtcNow();
            ChargeDefinition? charge;
            string? before = null;
            if (chargeId is { } id)
            {
                charge = await context.ChargeDefinitions.SingleOrDefaultAsync(item => item.PublicId == id, cancellationToken);
                if (charge is null) return FinanceCatalogResult.Failed(FinanceCatalogFailure.NotFound);
                if (Version(charge.RowVersion) != input.ExpectedVersion)
                    return FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict);
                before = $"{charge.Code}:{charge.Method}:{charge.QuantityRule}:{charge.IsActive}";
            }
            else
            {
                charge = new ChargeDefinition { PublicId = Guid.CreateVersion7(), CreatedAt = now };
                context.ChargeDefinitions.Add(charge);
            }
            if (await context.ChargeDefinitions.AnyAsync(item => item.Code == code && item.Id != charge.Id, cancellationToken))
                return FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict);
            charge.Code = code;
            charge.Name = input.Name.Trim();
            charge.Description = string.IsNullOrWhiteSpace(input.Description) ? null : input.Description.Trim();
            charge.Category = category;
            charge.Method = method;
            charge.QuantityRule = rule;
            charge.GraceMinutes = input.GraceMinutes;
            charge.RoundingIncrement = input.RoundingIncrement;
            charge.AppliesToAllServices = input.AppliesToAllServices;
            charge.AllowMultiple = input.AllowMultiple;
            charge.VisibleToAgents = input.VisibleToAgents;
            charge.IsActive = input.IsActive;
            charge.BillingUnit = unit;
            charge.UpdatedAt = now;
            await context.SaveChangesAsync(cancellationToken);
            context.ChargeDefinitionServices.RemoveRange(await context.ChargeDefinitionServices
                .Where(link => link.ChargeDefinitionId == charge.Id).ToArrayAsync(cancellationToken));
            foreach (var service in services)
                context.ChargeDefinitionServices.Add(new ChargeDefinitionService
                { ChargeDefinitionId = charge.Id, ServiceDefinitionId = service });
            Audit(actor.Id, chargeId is null ? "finance.charge.created" : "finance.charge.updated",
                "commercial.charge_definitions", charge.PublicId, null,
                new AuditFieldChangeData("charge", before, $"{charge.Code}:{charge.Method}:{charge.QuantityRule}:{charge.IsActive}"));
            await NotifyAsync("finance.charges.read", "finance_tariff_book", charge.PublicId, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return FinanceCatalogResult.Success(charge.PublicId);
        }, cancellationToken);
    }

    public async Task<IReadOnlyList<TariffVersionSummaryData>?> ListChargeTariffsAsync(Guid actorId, string? currencyCode,
        CancellationToken cancellationToken = default)
    {
        if (await AuthorizeAsync(actorId, "finance.charges.read", cancellationToken) is null) return null;
        var versions = await context.ChargeTariffVersions.AsNoTracking()
            .Where(version => currencyCode == null || version.CurrencyCode == currencyCode)
            .OrderBy(version => version.CurrencyCode).ThenByDescending(version => version.ValidFrom)
            .ToArrayAsync(cancellationToken);
        var ids = versions.Select(version => version.Id).ToArray();
        var counts = await context.ChargeRates.AsNoTracking().Where(rate => ids.Contains(rate.ChargeTariffVersionId))
            .GroupBy(rate => rate.ChargeTariffVersionId).Select(group => new { group.Key, Count = group.Count() })
            .ToDictionaryAsync(item => item.Key, item => item.Count, cancellationToken);
        var publishers = await PublisherNamesAsync(versions.Select(version => version.PublishedByAccountId), cancellationToken);
        return versions.Select(version => Summary(version.PublicId, version.CurrencyCode, version.ValidFrom,
            version.ValidTo, version.Status, version.Note, version.PublishedAt,
            version.PublishedByAccountId is { } by ? publishers.GetValueOrDefault(by) : null,
            counts.GetValueOrDefault(version.Id), version.RowVersion)).ToArray();
    }

    public async Task<ChargeTariffVersionData?> GetChargeTariffAsync(Guid actorId, Guid versionId,
        CancellationToken cancellationToken = default)
    {
        if (await AuthorizeAsync(actorId, "finance.charges.read", cancellationToken) is null) return null;
        var version = await context.ChargeTariffVersions.AsNoTracking()
            .SingleOrDefaultAsync(item => item.PublicId == versionId, cancellationToken);
        if (version is null) return null;
        var rates = await (from rate in context.ChargeRates.AsNoTracking()
                           join charge in context.ChargeDefinitions.AsNoTracking() on rate.ChargeDefinitionId equals charge.Id
                           where rate.ChargeTariffVersionId == version.Id
                           orderby charge.Code
                           select new { charge.PublicId, charge.Code, charge.Name, charge.Method, rate.Value, rate.MinimumAmount })
            .ToArrayAsync(cancellationToken);
        var publishers = await PublisherNamesAsync([version.PublishedByAccountId], cancellationToken);
        return new ChargeTariffVersionData(Summary(version.PublicId, version.CurrencyCode, version.ValidFrom,
                version.ValidTo, version.Status, version.Note, version.PublishedAt,
                version.PublishedByAccountId is { } by ? publishers.GetValueOrDefault(by) : null, rates.Length,
                version.RowVersion),
            rates.Select(rate => new ChargeRateData(rate.PublicId, rate.Code, rate.Name, rate.Method.ToString(),
                rate.Value, rate.MinimumAmount)).ToArray());
    }

    public async Task<FinanceCatalogResult> CreateChargeTariffDraftAsync(Guid actorId, CreateTariffDraftInput input,
        CancellationToken cancellationToken = default)
    {
        var actor = await AuthorizeAsync(actorId, "finance.charges.manage", cancellationToken);
        if (actor is null) return FinanceCatalogResult.Failed(FinanceCatalogFailure.Forbidden);
        if (input is null || !ValidCurrency(input.CurrencyCode) || input.ValidFrom == default || input.Note?.Length > 500)
            return FinanceCatalogResult.Failed(FinanceCatalogFailure.Invalid);
        return await InTransactionAsync(async () =>
        {
            var now = timeProvider.GetUtcNow();
            if (await context.ChargeTariffVersions.AnyAsync(version => version.CurrencyCode == input.CurrencyCode &&
                    version.Status == TariffVersionStatus.Draft, cancellationToken))
                return FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict);
            ChargeTariffVersion? source = null;
            if (input.CopyFromVersionId is { } sourceId)
            {
                source = await context.ChargeTariffVersions.AsNoTracking()
                    .SingleOrDefaultAsync(item => item.PublicId == sourceId, cancellationToken);
                if (source is null) return FinanceCatalogResult.Failed(FinanceCatalogFailure.NotFound);
            }
            var draft = new ChargeTariffVersion
            {
                PublicId = Guid.CreateVersion7(), CurrencyCode = input.CurrencyCode, ValidFrom = input.ValidFrom,
                Status = TariffVersionStatus.Draft, Note = input.Note?.Trim(), CreatedByAccountId = actor.Id,
                CreatedAt = now, UpdatedAt = now,
            };
            context.ChargeTariffVersions.Add(draft);
            await context.SaveChangesAsync(cancellationToken);
            if (source is not null)
            {
                var sameCurrency = source.CurrencyCode == input.CurrencyCode;
                var percent = await context.ChargeDefinitions.AsNoTracking()
                    .Where(charge => charge.Method == ChargeCalculationMethod.PercentOfService)
                    .Select(charge => charge.Id).ToArrayAsync(cancellationToken);
                foreach (var rate in await context.ChargeRates.AsNoTracking()
                             .Where(rate => rate.ChargeTariffVersionId == source.Id).ToArrayAsync(cancellationToken))
                    context.ChargeRates.Add(new ChargeRate
                    {
                        PublicId = Guid.CreateVersion7(), ChargeTariffVersionId = draft.Id,
                        ChargeDefinitionId = rate.ChargeDefinitionId,
                        Value = sameCurrency || percent.Contains(rate.ChargeDefinitionId) ? rate.Value : 0m,
                        MinimumAmount = sameCurrency ? rate.MinimumAmount : 0m, CreatedAt = now, UpdatedAt = now,
                    });
            }
            Audit(actor.Id, "finance.charge_tariff.draft_created", "commercial.charge_tariff_versions", draft.PublicId,
                null, new AuditFieldChangeData("tariff.currency", null, draft.CurrencyCode));
            await NotifyAsync("finance.charges.read", "finance_tariff_book", draft.PublicId, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return FinanceCatalogResult.Success(draft.PublicId);
        }, cancellationToken);
    }

    public async Task<FinanceCatalogResult> SaveChargeTariffDraftAsync(Guid actorId, Guid versionId,
        SaveChargeTariffDraftInput input, CancellationToken cancellationToken = default)
    {
        var actor = await AuthorizeAsync(actorId, "finance.charges.manage", cancellationToken);
        if (actor is null) return FinanceCatalogResult.Failed(FinanceCatalogFailure.Forbidden);
        if (input is null || input.ValidFrom == default || input.ValidTo < input.ValidFrom || input.Note?.Length > 500 ||
            string.IsNullOrWhiteSpace(input.ExpectedVersion) || input.Rates is null or { Count: > 300 } ||
            input.Rates.Any(rate => rate.Value is < 0 or > 900_000_000m || rate.MinimumAmount is < 0 or > 900_000_000m) ||
            input.Rates.Select(rate => rate.ChargeId).Distinct().Count() != input.Rates.Count)
            return FinanceCatalogResult.Failed(FinanceCatalogFailure.Invalid);
        var chargeIds = input.Rates.Select(rate => rate.ChargeId).ToArray();
        var charges = await context.ChargeDefinitions.AsNoTracking().Where(charge => chargeIds.Contains(charge.PublicId))
            .ToDictionaryAsync(charge => charge.PublicId, cancellationToken);
        if (charges.Count != chargeIds.Length || input.Rates.Any(rate =>
                charges[rate.ChargeId].Method == ChargeCalculationMethod.PercentOfService && rate.Value > 1000m))
            return FinanceCatalogResult.Failed(FinanceCatalogFailure.Invalid);

        return await InTransactionAsync(async () =>
        {
            var now = timeProvider.GetUtcNow();
            var draft = await context.ChargeTariffVersions.SingleOrDefaultAsync(item => item.PublicId == versionId,
                cancellationToken);
            if (draft is null) return FinanceCatalogResult.Failed(FinanceCatalogFailure.NotFound);
            if (draft.Status != TariffVersionStatus.Draft || Version(draft.RowVersion) != input.ExpectedVersion)
                return FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict);
            draft.ValidFrom = input.ValidFrom;
            draft.ValidTo = input.ValidTo;
            draft.Note = input.Note?.Trim();
            draft.UpdatedAt = now;
            context.ChargeRates.RemoveRange(await context.ChargeRates
                .Where(rate => rate.ChargeTariffVersionId == draft.Id).ToArrayAsync(cancellationToken));
            await context.SaveChangesAsync(cancellationToken);
            foreach (var rate in input.Rates)
                context.ChargeRates.Add(new ChargeRate
                {
                    PublicId = Guid.CreateVersion7(), ChargeTariffVersionId = draft.Id,
                    ChargeDefinitionId = charges[rate.ChargeId].Id, Value = rate.Value,
                    MinimumAmount = rate.MinimumAmount, CreatedAt = now, UpdatedAt = now,
                });
            Audit(actor.Id, "finance.charge_tariff.draft_saved", "commercial.charge_tariff_versions", draft.PublicId,
                null, new AuditFieldChangeData("tariff.rates", null, input.Rates.Count.ToString()));
            await context.SaveChangesAsync(cancellationToken);
            return FinanceCatalogResult.Success(draft.PublicId);
        }, cancellationToken);
    }

    public async Task<FinanceCatalogResult> PublishChargeTariffAsync(Guid actorId, Guid versionId,
        string expectedVersion, CancellationToken cancellationToken = default)
    {
        var actor = await AuthorizeAsync(actorId, "finance.charges.manage", cancellationToken);
        if (actor is null) return FinanceCatalogResult.Failed(FinanceCatalogFailure.Forbidden);
        if (string.IsNullOrWhiteSpace(expectedVersion)) return FinanceCatalogResult.Failed(FinanceCatalogFailure.Invalid);
        return await InTransactionAsync(async () =>
        {
            var now = timeProvider.GetUtcNow();
            var draft = await context.ChargeTariffVersions.SingleOrDefaultAsync(item => item.PublicId == versionId,
                cancellationToken);
            if (draft is null) return FinanceCatalogResult.Failed(FinanceCatalogFailure.NotFound);
            if (draft.Status != TariffVersionStatus.Draft || Version(draft.RowVersion) != expectedVersion ||
                !await context.ChargeRates.AnyAsync(rate => rate.ChargeTariffVersionId == draft.Id, cancellationToken))
                return FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict);
            var previous = await context.ChargeTariffVersions.Where(version => version.CurrencyCode == draft.CurrencyCode &&
                    version.Status != TariffVersionStatus.Draft && (version.ValidTo == null || version.ValidTo >= draft.ValidFrom))
                .ToArrayAsync(cancellationToken);
            if (previous.Any(version => version.ValidFrom >= draft.ValidFrom))
                return FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict);
            foreach (var version in previous)
            {
                version.ValidTo = draft.ValidFrom.AddDays(-1);
                version.Status = TariffVersionStatus.Superseded;
                version.UpdatedAt = now;
            }
            draft.Status = TariffVersionStatus.Published;
            draft.PublishedAt = now;
            draft.PublishedByAccountId = actor.Id;
            draft.UpdatedAt = now;
            Audit(actor.Id, "finance.charge_tariff.published", "commercial.charge_tariff_versions", draft.PublicId,
                null, new AuditFieldChangeData("tariff.valid_from", null, draft.ValidFrom.ToString("O")));
            await NotifyAsync("finance.charges.read", "finance_tariff_book", draft.PublicId, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return FinanceCatalogResult.Success(draft.PublicId);
        }, cancellationToken);
    }

    public async Task<FinanceCatalogResult> DeleteChargeTariffDraftAsync(Guid actorId, Guid versionId,
        string expectedVersion, CancellationToken cancellationToken = default)
    {
        var actor = await AuthorizeAsync(actorId, "finance.charges.manage", cancellationToken);
        if (actor is null) return FinanceCatalogResult.Failed(FinanceCatalogFailure.Forbidden);
        return await InTransactionAsync(async () =>
        {
            var draft = await context.ChargeTariffVersions.SingleOrDefaultAsync(item => item.PublicId == versionId,
                cancellationToken);
            if (draft is null) return FinanceCatalogResult.Failed(FinanceCatalogFailure.NotFound);
            if (draft.Status != TariffVersionStatus.Draft || Version(draft.RowVersion) != expectedVersion)
                return FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict);
            context.ChargeRates.RemoveRange(await context.ChargeRates
                .Where(rate => rate.ChargeTariffVersionId == draft.Id).ToArrayAsync(cancellationToken));
            context.ChargeTariffVersions.Remove(draft);
            Audit(actor.Id, "finance.charge_tariff.draft_deleted", "commercial.charge_tariff_versions", draft.PublicId);
            await context.SaveChangesAsync(cancellationToken);
            return FinanceCatalogResult.Success(draft.PublicId);
        }, cancellationToken);
    }
}
