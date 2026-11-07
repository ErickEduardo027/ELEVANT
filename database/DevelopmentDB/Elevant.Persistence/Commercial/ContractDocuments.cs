using System.Text.Json;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Commercial;
using Elevant.Application.Common;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>
/// Formal content of a contract version, the one place it is read from the database: the document the
/// parties sign, the PDF and the activation email, the withdrawal check and the restoration of a legacy
/// end (2-N10) all hash exactly this.
/// </summary>
internal static class ContractDocuments
{
    /// <summary>Pricing policy from which surcharges and packages are part of the signed content (2-N04).</summary>
    public const int SignedPricingPolicy = 2;

    public static async Task<ContractDocumentData> LoadAsync(ElevantDbContext context, long versionId,
        CancellationToken cancellationToken)
    {
        var head = await (from version in context.ContractVersions.AsNoTracking()
                          join contract in context.Contracts.AsNoTracking() on version.ContractId equals contract.Id
                          join airline in context.Airlines.AsNoTracking() on contract.AirlineId equals airline.Id
                          join organization in context.Organizations.AsNoTracking() on airline.OrganizationId equals organization.Id
                          where version.Id == versionId
                          select new { ContractId = contract.PublicId, VersionId = version.PublicId, contract.ContractCode,
                              // The airline's designator in the document: IATA, or ICAO for an operator without one.
                              ContractStatus = contract.Status, Airline = airline.Name,
                              AirlineCode = airline.IataCode ?? airline.IcaoCode, organization.LegalName,
                              version.VersionNumber, version.Status, version.ValidFrom, version.ValidTo, version.CurrencyCode,
                              version.Terms, version.RenewalMode, version.RenewalTermMonths,
                              version.RenewalNoticeDays, version.TerminationNoticeDays, version.TerminationTerms,
                              version.ValidityConfirmedAt, version.PricingPolicyVersion, ContractSignedOn = contract.SignedOn,
                              FirstApproved = !context.ContractVersions.Any(earlier => earlier.ContractId == version.ContractId &&
                                  earlier.VersionNumber < version.VersionNumber &&
                                  (earlier.Status == ContractVersionStatus.Approved ||
                                   earlier.Status == ContractVersionStatus.Superseded)) })
            .SingleAsync(cancellationToken);
        var stations = await (from link in context.Set<ContractVersionStation>().AsNoTracking()
                              join station in context.Stations.AsNoTracking() on link.StationId equals station.Id
                              where link.ContractVersionId == versionId
                              orderby station.Code
                              select station.Code + " · " + station.Name).ToArrayAsync(cancellationToken);
        var rates = await (from rate in context.ContractServiceRates.AsNoTracking()
                           join service in context.ServiceDefinitions.AsNoTracking() on rate.ServiceDefinitionId equals service.Id
                           where rate.ContractVersionId == versionId
                           orderby service.Code, rate.BillingUnit
                           select new ContractDocumentRate(service.Code, service.Name, rate.BillingUnit, rate.UnitPrice,
                               rate.MinimumQuantity, rate.IsConfirmed != false)).ToArrayAsync(cancellationToken);
        var signatures = (await context.ContractSignatures.AsNoTracking()
                .Where(item => item.ContractVersionId == versionId).OrderBy(item => item.SignedAt)
                .ToArrayAsync(cancellationToken))
            .Select(item => new ContractDocumentSignature(item.Party.ToString(), item.SignerName, item.SignerTitle,
                item.SignedAt, item.DocumentSha256, item.SignatureImage)).ToArray();
        var validity = head.ValidityConfirmedAt is { } confirmed && head.RenewalMode is { } mode
            ? new ContractValidityTerms(mode.ToString(), head.RenewalTermMonths, head.RenewalNoticeDays ?? 0,
                head.TerminationNoticeDays ?? 0, head.TerminationTerms, confirmed)
            : null;
        var pricing = head.PricingPolicyVersion >= SignedPricingPolicy
            ? await PricingAsync(context, versionId, cancellationToken) : null;
        // A legacy first version that activated its contract without signatures keeps the date the contract
        // recorded as signed (ADR-0024); any other version is signed on the day of its second signature.
        var legacy = signatures.Length == 0 && head.FirstApproved && head.ContractStatus != ContractStatus.Draft &&
            head.Status is ContractVersionStatus.Approved or ContractVersionStatus.Superseded;
        return new ContractDocumentData(head.ContractId, head.VersionId, head.ContractCode, head.ContractStatus.ToString(),
            head.Airline, head.AirlineCode, string.IsNullOrWhiteSpace(head.LegalName) ? null : head.LegalName,
            head.VersionNumber, head.Status.ToString(), head.ValidFrom, head.ValidTo, head.CurrencyCode, stations, rates,
            head.Terms, legacy ? head.ContractSignedOn : SignedOn(signatures), signatures, validity, pricing);
    }

    /// <summary>
    /// 2-N05: the date a version counts as signed is the business day of its second signature over the
    /// same content; the contract's own <c>SignedOn</c> is the day it first became active.
    /// </summary>
    public static DateOnly? SignedOn(IReadOnlyList<ContractDocumentSignature> signatures) =>
        ContractVersionGovernance.SignedByBoth(Facts(signatures))
            ? BusinessCalendar.Today(signatures.Max(item => item.SignedAt)) : null;

    public static IEnumerable<ContractSignatureFact> Facts(IEnumerable<ContractDocumentSignature> signatures) =>
        signatures.Select(item => new ContractSignatureFact(Enum.Parse<ContractSignatureParty>(item.Party), item.DocumentSha256));

    /// <summary>
    /// Surcharges and packages as they apply to the version: the charge rates Finance froze at approval
    /// (with the frozen policy when present) and the linked package versions with their components.
    /// </summary>
    public static async Task<ContractPricingTerms> PricingAsync(ElevantDbContext context, long versionId,
        CancellationToken cancellationToken)
    {
        var chargeRows = await (from rate in context.ContractChargeRates.AsNoTracking()
                                join definition in context.ChargeDefinitions.AsNoTracking()
                                    on rate.ChargeDefinitionId equals definition.Id
                                where rate.ContractVersionId == versionId
                                select new { rate, definition }).ToArrayAsync(cancellationToken);
        var charges = chargeRows.Select(row =>
            {
                var policy = Policy(row.rate.DefinitionSnapshotJson) ?? new ContractChargePolicySnapshot(row.definition.Code,
                    row.definition.Name, row.definition.BillingUnit, row.definition.Method, row.definition.QuantityRule,
                    row.definition.GraceMinutes, row.definition.RoundingIncrement);
                return new ContractDocumentCharge(policy.Code, policy.Name, policy.Method.ToString(), policy.BillingUnit,
                    policy.QuantityRule.ToString(), policy.GraceMinutes, policy.RoundingIncrement, row.rate.IsExcluded,
                    row.rate.IsExcluded ? null : row.rate.Value, row.rate.IsExcluded ? null : row.rate.MinimumAmount);
            })
            .OrderBy(charge => charge.ChargeCode, StringComparer.Ordinal).ToArray();
        var packageRows = await (from link in context.Set<ContractServicePackage>().AsNoTracking()
                                 join package in context.Set<ServicePackageVersion>().AsNoTracking()
                                     on link.PackageVersionId equals package.Id
                                 where link.ContractVersionId == versionId
                                 select package).ToArrayAsync(cancellationToken);
        var packageIds = packageRows.Select(package => package.Id).ToArray();
        var components = (await (from component in context.Set<ServicePackageComponent>().AsNoTracking()
                                 join service in context.ServiceDefinitions.AsNoTracking()
                                     on component.ServiceDefinitionId equals service.Id
                                 where packageIds.Contains(component.PackageVersionId)
                                 select new { component, service.Code, service.Name }).ToArrayAsync(cancellationToken))
            .ToLookup(row => row.component.PackageVersionId);
        var packages = packageRows.OrderBy(package => package.Code, StringComparer.Ordinal).ThenBy(package => package.VersionNumber)
            .Select(package => new ContractDocumentPackage(package.Code, package.Name, package.VersionNumber,
                package.Scope.ToString(), package.FlightDirection?.ToString(), package.PeriodDays, package.BasePrice,
                package.CurrencyCode, components[package.Id].OrderBy(row => row.Code, StringComparer.Ordinal)
                    .Select(row => new ContractDocumentPackageComponent(row.Code, row.Name, row.component.BillingUnit,
                        row.component.IncludedQuantity, row.component.ExcessBlockSize, row.component.ExcessBlockPrice))
                    .ToArray()))
            .ToArray();
        return new ContractPricingTerms(charges, packages);
    }

    private static ContractChargePolicySnapshot? Policy(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonSerializer.Deserialize<ContractChargePolicySnapshot>(json); }
        catch (JsonException) { return null; }
    }
}
