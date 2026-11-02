using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Realtime;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>Formal contract document and its party signatures (teacher review, Phase 6).</summary>
internal sealed class EfContractDocumentStore(ElevantDbContext context, IActorContextResolver actors,
    TimeProvider timeProvider) : IContractDocumentStore
{
    private const string SignPermission = "contracts.agreements.sign";
    private static readonly string[] InternalReaders = ["contracts.agreements.read", "finance.contract_approvals.read"];

    private sealed record Reader(long AccountId, ContractSignatureParty Party, bool CanSign);

    public async Task<ContractDocumentResult> ReadAsync(Guid actorId, Guid versionId,
        CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        var row = await VersionAsync(versionId, cancellationToken);
        if (row is null) return Failed(ContractDocumentFailure.NotFound);
        var reader = await ReaderAsync(actor, actorId, row.Value.AirlineId, cancellationToken);
        if (reader is null) return Failed(ContractDocumentFailure.Forbidden);
        var document = await DocumentAsync(row.Value.VersionId, cancellationToken);
        return new(document with { SignableBy = SignableBy(document, reader) }, null);
    }

    public async Task<ContractDocumentResult> ReadDraftAsync(Guid actorId, Guid versionId,
        CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        var row = await VersionAsync(versionId, cancellationToken, draft: true);
        if (row is null) return Failed(ContractDocumentFailure.NotFound);
        if (await ReaderAsync(actor, actorId, row.Value.AirlineId, cancellationToken) is null)
            return Failed(ContractDocumentFailure.Forbidden);
        return new(await DocumentAsync(row.Value.VersionId, cancellationToken), null);
    }

    public async Task<ContractDocumentResult> SignAsync(Guid actorId, Guid versionId, SignContractInput input,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        var name = input.SignerName?.Trim();
        var title = input.SignerTitle?.Trim();
        if (input.RequestId == Guid.Empty || !input.Accepted || name is not { Length: >= 3 and <= 160 } ||
            title is not { Length: >= 2 and <= 120 } || input.DocumentSha256 is not { Length: 64 })
            return Failed(ContractDocumentFailure.Invalid);
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        var row = await VersionAsync(versionId, cancellationToken);
        if (row is null) return Failed(ContractDocumentFailure.NotFound);
        var reader = await ReaderAsync(actor, actorId, row.Value.AirlineId, cancellationToken);
        if (reader is null || !reader.CanSign) return Failed(ContractDocumentFailure.Forbidden);

        // A retry of the same request returns the recorded signature.
        var previous = await context.ContractSignatures.AsNoTracking()
            .SingleOrDefaultAsync(item => item.RequestId == input.RequestId, cancellationToken);
        if (previous is not null)
            return previous.ContractVersionId == row.Value.VersionId && previous.SignerAccountId == reader.AccountId &&
                   previous.SignerName == name && previous.SignerTitle == title &&
                   previous.DocumentSha256 == input.DocumentSha256.ToLowerInvariant()
                ? new(await DocumentAsync(row.Value.VersionId, cancellationToken), null, true)
                : Failed(ContractDocumentFailure.Conflict);

        var document = await DocumentAsync(row.Value.VersionId, cancellationToken);
        if (row.Value.Status != ContractVersionStatus.Approved) return Failed(ContractDocumentFailure.Conflict);
        if (!string.Equals(document.ContentSha256, input.DocumentSha256, StringComparison.OrdinalIgnoreCase))
            return Failed(ContractDocumentFailure.Conflict);
        if (document.Signatures.Any(item => item.Party == reader.Party.ToString()))
            return Failed(ContractDocumentFailure.AlreadySigned);

        var now = timeProvider.GetUtcNow();
        now = new DateTimeOffset(now.Ticks - now.Ticks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);
        context.ContractSignatures.Add(new ContractSignature
        {
            PublicId = Guid.CreateVersion7(), ContractVersionId = row.Value.VersionId, Party = reader.Party,
            SignerAccountId = reader.AccountId, SignerName = name, SignerTitle = title, SignedAt = now,
            DocumentSha256 = document.ContentSha256, RequestId = input.RequestId, CreatedAt = now, UpdatedAt = now,
        });
        // The contract counts as signed once both parties accepted the version in force.
        if (document.Signatures.Count == 1)
        {
            var contract = await context.Contracts.SingleAsync(item => item.Id == row.Value.ContractId, cancellationToken);
            contract.SignedOn = DateOnly.FromDateTime(now.UtcDateTime);
            contract.UpdatedAt = now;
        }
        CommercialAuditWriter.Add(context, reader.AccountId, "commercial.contract.signed",
            "commercial.contract_versions", versionId, $"{reader.Party}: {name}, {title}");
        foreach (var recipient in await CommercialNotificationRecipients.WithPermissionAsync(context,
                     "contracts.agreements.read", cancellationToken))
            AccountChangeOutboxWriter.Add(context, recipient, null, "airline_contracts", row.Value.ContractPublicId, now);
        if (reader.Party == ContractSignatureParty.Airline)
            await DepartmentNotificationWriter.NotifyAsync(context, Department.Contracts, "contracts.agreements.read",
                "contract_signed", versionId, document.AirlineName, now, cancellationToken);
        try
        {
            await context.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (exception.InnerException is SqlException { Number: 2601 or 2627 })
        {
            context.ChangeTracker.Clear();
            return Failed(ContractDocumentFailure.AlreadySigned);
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return Failed(ContractDocumentFailure.Conflict);
        }
        return new(await DocumentAsync(row.Value.VersionId, cancellationToken) with
            { SignableBy = null }, null);
    }

    private static ContractDocumentResult Failed(ContractDocumentFailure failure) => new(null, failure);

    private static string? SignableBy(ContractDocumentData document, Reader reader) =>
        reader.CanSign && document.VersionStatus == nameof(ContractVersionStatus.Approved) &&
        document.Signatures.All(item => item.Party != reader.Party.ToString())
            ? reader.Party.ToString() : null;

    private async Task<(long VersionId, long ContractId, Guid ContractPublicId, long AirlineId, ContractVersionStatus Status)?>
        VersionAsync(Guid versionId, CancellationToken cancellationToken, bool draft = false)
    {
        // Drafts follow the airline draft list: editable or awaiting Finance, on a live contract.
        var row = await (from version in context.ContractVersions.AsNoTracking()
                         join contract in context.Contracts.AsNoTracking() on version.ContractId equals contract.Id
                         where version.PublicId == versionId && (draft
                             ? (version.Status == ContractVersionStatus.Draft ||
                                version.Status == ContractVersionStatus.PendingFinanceApproval) &&
                               (contract.Status == ContractStatus.Draft || contract.Status == ContractStatus.Active)
                             : version.Status == ContractVersionStatus.Approved || version.Status == ContractVersionStatus.Superseded)
                         select new { version.Id, ContractId = contract.Id, contract.PublicId, contract.AirlineId, version.Status })
            .SingleOrDefaultAsync(cancellationToken);
        return row is null ? null : (row.Id, row.ContractId, row.PublicId, row.AirlineId, row.Status);
    }

    private async Task<Reader?> ReaderAsync(ActorContext? actor, Guid actorId, long airlineId,
        CancellationToken cancellationToken)
    {
        if (actor is null) return null;
        var accountId = await context.Users.AsNoTracking().Where(user => user.PublicId == actorId)
            .Select(user => user.Id).SingleAsync(cancellationToken);
        if (actor.Memberships.Any(membership => membership.Kind == MembershipKind.InternalStaff &&
                membership.OrganizationType == OrganizationType.AviamOperator))
            return InternalReaders.Any(actor.HasPermission)
                ? new Reader(accountId, ContractSignatureParty.Aviam, actor.HasPermission(SignPermission)) : null;
        if (!actor.Roles.Any(role => role.Code == "AIRLINE_CLIENT" && role.Portal == PortalKind.AirlinePortal)) return null;
        var organizations = actor.Memberships.Where(membership => membership.Kind == MembershipKind.AirlineClient &&
                membership.OrganizationType == OrganizationType.AirlineCustomer)
            .Select(membership => membership.OrganizationId).ToArray();
        var owns = await (from organization in context.Organizations.AsNoTracking()
                          join airline in context.Airlines.AsNoTracking() on organization.Id equals airline.OrganizationId
                          where organizations.Contains(organization.PublicId) && organization.Status == OrganizationStatus.Active &&
                                airline.IsActive && airline.Id == airlineId
                          select airline.Id).AnyAsync(cancellationToken);
        return owns ? new Reader(accountId, ContractSignatureParty.Airline, true) : null;
    }

    private async Task<ContractDocumentData> DocumentAsync(long versionId, CancellationToken cancellationToken)
    {
        var head = await (from version in context.ContractVersions.AsNoTracking()
                          join contract in context.Contracts.AsNoTracking() on version.ContractId equals contract.Id
                          join airline in context.Airlines.AsNoTracking() on contract.AirlineId equals airline.Id
                          join organization in context.Organizations.AsNoTracking() on airline.OrganizationId equals organization.Id
                          where version.Id == versionId
                          select new { ContractId = contract.PublicId, VersionId = version.PublicId, contract.ContractCode,
                              ContractStatus = contract.Status, Airline = airline.Name, airline.IataCode, organization.LegalName,
                              version.VersionNumber, version.Status, version.ValidFrom, version.ValidTo, version.CurrencyCode,
                              version.Terms, contract.SignedOn })
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
                item.SignedAt, item.DocumentSha256)).ToArray();
        return new ContractDocumentData(head.ContractId, head.VersionId, head.ContractCode, head.ContractStatus.ToString(),
            head.Airline, head.IataCode, string.IsNullOrWhiteSpace(head.LegalName) ? null : head.LegalName,
            head.VersionNumber, head.Status.ToString(), head.ValidFrom, head.ValidTo, head.CurrencyCode, stations, rates,
            head.Terms, head.SignedOn, signatures);
    }
}
