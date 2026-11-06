using Elevant.Application.Abstractions.Commercial;
using System.Security.Cryptography;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Messaging;
using Elevant.Application.Commercial;
using Elevant.Application.Identity;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Realtime;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>
/// Formal contract document, its validity step and the party signatures (ADR-0024, ADR-0025). It
/// also resolves the signed PDF attached to the activation email when that email is sent.
/// </summary>
internal sealed class EfContractDocumentStore(ElevantDbContext context, IActorContextResolver actors,
    TimeProvider timeProvider) : IContractDocumentStore
{
    private const string SignPermission = "contracts.agreements.sign";
    private const string ValidityPermission = "contracts.agreements.validity";
    public const string AttachmentPrefix = "contract-version:";
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
        // ADR-0025: every new signature is drawn; the PNG is checked before anything else is read.
        var image = ContractValidity.DecodeSignature(input.SignatureImagePng);
        if (image is null) return Failed(ContractDocumentFailure.Invalid, "signature_image_invalid");
        var imageSha256 = Convert.ToHexStringLower(SHA256.HashData(image));
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
                   previous.DocumentSha256 == input.DocumentSha256.ToLowerInvariant() &&
                   previous.SignatureImageSha256 == imageSha256
                ? new(await DocumentAsync(row.Value.VersionId, cancellationToken), null, true)
                : Failed(ContractDocumentFailure.Conflict);

        // 1-B: the contract is read, tracked, before every check and the signature always writes it, so its
        // rowversion turns a termination (or a validity change) committed in between into a conflict
        // instead of a signature on a closed contract. The tracker starts empty: an entity tracked by an
        // earlier command of this context would carry an old status and rowversion.
        context.ChangeTracker.Clear();
        var contract = await context.Contracts.SingleAsync(item => item.Id == row.Value.ContractId, cancellationToken);
        var document = await DocumentAsync(row.Value.VersionId, cancellationToken);
        if (row.Value.Status != ContractVersionStatus.Approved) return Failed(ContractDocumentFailure.Conflict);
        if (!string.Equals(document.ContentSha256, input.DocumentSha256, StringComparison.OrdinalIgnoreCase))
            return Failed(ContractDocumentFailure.Conflict);
        if (document.Signatures.Any(item => item.Party == reader.Party.ToString()))
            return Failed(ContractDocumentFailure.AlreadySigned);
        // A discarded or terminated contract is closed: its approved version is history, not an offer.
        if (contract.Status == ContractStatus.Terminated)
            return Failed(ContractDocumentFailure.Conflict, "contract_terminated");
        if (document.Validity is null) return Failed(ContractDocumentFailure.ValidityPending, "validity_pending");
        // The airline signs first; AVIAM countersigns what the airline already accepted.
        if (reader.Party == ContractSignatureParty.Aviam &&
            document.Signatures.All(item => item.Party != nameof(ContractSignatureParty.Airline)))
            return Failed(ContractDocumentFailure.AirlineSignaturePending, "airline_signature_pending");

        var now = timeProvider.GetUtcNow();
        now = new DateTimeOffset(now.Ticks - now.Ticks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);
        context.ContractSignatures.Add(new ContractSignature
        {
            PublicId = Guid.CreateVersion7(), ContractVersionId = row.Value.VersionId, Party = reader.Party,
            SignerAccountId = reader.AccountId, SignerName = name, SignerTitle = title, SignedAt = now,
            DocumentSha256 = document.ContentSha256, RequestId = input.RequestId, CreatedAt = now, UpdatedAt = now,
            SignatureImage = image, SignatureImageSha256 = imageSha256,
        });
        // The contract counts as signed once both parties accepted the version in force.
        if (document.Signatures.Count == 1) contract.SignedOn = DateOnly.FromDateTime(now.UtcDateTime);
        contract.UpdatedAt = now;
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
            // The contract changed after the checks; nothing was signed.
            context.ChangeTracker.Clear();
            return Failed(ContractDocumentFailure.Conflict,
                await TerminatedAsync(row.Value.ContractId, cancellationToken) ? "contract_terminated" : null);
        }
        // The second signature may complete the activation conditions (ADR-0024). A renewal of a
        // contract already in force activates nothing, so its signed PDF is sent from here.
        if (document.Signatures.Count == 1)
        {
            var status = await context.Contracts.AsNoTracking().Where(item => item.Id == row.Value.ContractId)
                .Select(item => item.Status).SingleAsync(cancellationToken);
            if (status == ContractStatus.Active)
            {
                await ContractActivation.QueueSignedContractEmailsAsync(context, row.Value.ContractId, row.Value.VersionId,
                    now, cancellationToken);
                await context.SaveChangesAsync(cancellationToken);
            }
            else await ContractActivation.ActivateReadyAsync(context, row.Value.AirlineId, reader.AccountId, now, cancellationToken);
        }
        return new(await DocumentAsync(row.Value.VersionId, cancellationToken) with
            { SignableBy = null }, null);
    }

    public async Task<ContractDocumentResult> SetValidityAsync(Guid actorId, Guid versionId, ContractValidityInput input,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor is null || !actor.HasPermission(ValidityPermission) ||
            !actor.Memberships.Any(membership => membership.Kind == MembershipKind.InternalStaff &&
                membership.OrganizationType == OrganizationType.AviamOperator))
            return Failed(ContractDocumentFailure.Forbidden);
        if (input.ExpectedDocumentSha256 is not { Length: 64 }) return Failed(ContractDocumentFailure.Invalid);
        var row = await VersionAsync(versionId, cancellationToken);
        if (row is null) return Failed(ContractDocumentFailure.NotFound);
        if (row.Value.Status != ContractVersionStatus.Approved) return Failed(ContractDocumentFailure.Conflict, "not_approved");
        // 1-B: version and contract are read, tracked, before the checks and both are written, so their
        // rowversions turn a termination or a signature committed in between into a conflict. The tracker
        // starts empty: an entity tracked by an earlier command of this context would be stale.
        context.ChangeTracker.Clear();
        var version = await context.ContractVersions.SingleAsync(item => item.Id == row.Value.VersionId, cancellationToken);
        var contract = await context.Contracts.SingleAsync(item => item.Id == row.Value.ContractId, cancellationToken);
        var current = await DocumentAsync(row.Value.VersionId, cancellationToken);
        if (current.Signatures.Count > 0) return Failed(ContractDocumentFailure.Conflict, "already_signed");
        if (contract.Status == ContractStatus.Terminated)
            return Failed(ContractDocumentFailure.Conflict, "contract_terminated");
        if (!string.Equals(current.ContentSha256, input.ExpectedDocumentSha256, StringComparison.OrdinalIgnoreCase))
            return Failed(ContractDocumentFailure.Conflict, "content_changed");

        var now = timeProvider.GetUtcNow();
        now = new DateTimeOffset(now.Ticks - now.Ticks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);
        var today = DateOnly.FromDateTime(now.UtcDateTime);
        var previousFrom = await context.ContractVersions.AsNoTracking()
            .Where(item => item.ContractId == row.Value.ContractId && item.Id != row.Value.VersionId &&
                (item.Status == ContractVersionStatus.Approved || item.Status == ContractVersionStatus.Superseded))
            .OrderByDescending(item => item.ValidFrom).Select(item => (DateOnly?)item.ValidFrom)
            .FirstOrDefaultAsync(cancellationToken);
        if (ContractValidity.Check(input.ValidFrom, input.ValidTo, input.RenewalMode, input.RenewalTermMonths,
                input.RenewalNoticeDays, input.TerminationNoticeDays, input.TerminationTerms, today, previousFrom) is { } code)
            return Failed(ContractDocumentFailure.Invalid, code);
        // Packages Finance approved must still cover the confirmed dates.
        var packages = await (from link in context.Set<ContractServicePackage>().AsNoTracking()
                              join package in context.Set<ServicePackageVersion>().AsNoTracking()
                                  on link.PackageVersionId equals package.Id
                              where link.ContractVersionId == row.Value.VersionId
                              select new { package.ValidFrom, package.ValidTo }).ToArrayAsync(cancellationToken);
        if (packages.Any(package => package.ValidFrom > input.ValidFrom ||
                package.ValidTo is { } until && until < input.ValidTo!.Value))
            return Failed(ContractDocumentFailure.Invalid, "packages_out_of_range");

        var accountId = await context.Users.AsNoTracking().Where(user => user.PublicId == actorId)
            .Select(user => user.Id).SingleAsync(cancellationToken);
        // Finance approval already ended the versions this one replaces the day before its start;
        // when Contratos moves the start, their end follows it.
        if (version.ValidFrom != input.ValidFrom)
            foreach (var replaced in await context.ContractVersions
                         .Where(item => item.ContractId == row.Value.ContractId && item.Id != row.Value.VersionId &&
                             item.Status == ContractVersionStatus.Superseded && item.ValidTo == version.ValidFrom.AddDays(-1))
                         .ToArrayAsync(cancellationToken))
            {
                if (input.ValidFrom.AddDays(-1) < replaced.ValidFrom)
                    return Failed(ContractDocumentFailure.Invalid, "valid_from_past");
                replaced.ValidTo = input.ValidFrom.AddDays(-1);
                replaced.UpdatedAt = now;
            }
        version.ValidFrom = input.ValidFrom;
        version.ValidTo = input.ValidTo;
        version.RenewalMode = Enum.Parse<ContractRenewalMode>(input.RenewalMode);
        version.RenewalTermMonths = input.RenewalTermMonths;
        version.RenewalNoticeDays = input.RenewalNoticeDays;
        version.TerminationNoticeDays = input.TerminationNoticeDays;
        version.TerminationTerms = string.IsNullOrWhiteSpace(input.TerminationTerms) ? null : input.TerminationTerms.Trim();
        version.ValidityConfirmedAt = now;
        version.ValidityConfirmedByAccountId = accountId;
        version.RenewalStartedAt = null;
        version.UpdatedAt = now;
        // The final code is printed on what both parties sign, so it is assigned now and never changes.
        if (ContractValidity.IsDraftCode(contract.ContractCode))
        {
            // Next number of the year from the codes already issued; the unique index on the code
            // turns a concurrent duplicate into a conflict the caller retries (CRUD schemas hold no
            // sequences: verify-development-team-access.sql).
            var prefix = ContractValidity.FinalCode(now.Year, 0)[..^4];
            var issued = await context.Contracts.AsNoTracking().Where(item => item.ContractCode.StartsWith(prefix))
                .Select(item => item.ContractCode).ToArrayAsync(cancellationToken);
            contract.ContractCode = ContractValidity.FinalCode(now.Year, ContractValidity.NextSequence(issued, now.Year));
        }
        contract.ExpiryNoticeSentAt = null;
        contract.UpdatedAt = now;
        CommercialAuditWriter.Add(context, accountId, "commercial.contract.validity_confirmed",
            "commercial.contract_versions", versionId,
            $"{input.ValidFrom:yyyy-MM-dd} – {input.ValidTo:yyyy-MM-dd} · {input.RenewalMode}");
        await ContractActivation.AnnounceAsync(context, contract, "contract_validity", now, cancellationToken);
        try
        {
            await context.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return Failed(ContractDocumentFailure.Conflict,
                await TerminatedAsync(row.Value.ContractId, cancellationToken) ? "contract_terminated" : "content_changed");
        }
        catch (DbUpdateException exception) when (exception.InnerException is SqlException { Number: 2601 or 2627 })
        {
            // Another contract took the same final code at the same time: read again and retry.
            context.ChangeTracker.Clear();
            return Failed(ContractDocumentFailure.Conflict, "content_changed");
        }
        var reader = await ReaderAsync(actor, actorId, row.Value.AirlineId, cancellationToken);
        var document = await DocumentAsync(row.Value.VersionId, cancellationToken);
        return new(reader is null ? document : document with { SignableBy = SignableBy(document, reader) }, null);
    }

    /// <summary>Document of an approved or superseded version for system use (the activation email), without a reader.</summary>
    internal async Task<ContractDocumentData?> SystemDocumentAsync(Guid versionId, CancellationToken cancellationToken)
    {
        var row = await VersionAsync(versionId, cancellationToken);
        return row is null ? null : await DocumentAsync(row.Value.VersionId, cancellationToken);
    }

    private static ContractDocumentResult Failed(ContractDocumentFailure failure, string? code = null) =>
        new(null, failure, Code: code);

    /// <summary>Whether the contract is terminated now, read past the change tracker (after a conflict).</summary>
    private Task<bool> TerminatedAsync(long contractId, CancellationToken cancellationToken) =>
        context.Contracts.AsNoTracking()
            .AnyAsync(item => item.Id == contractId && item.Status == ContractStatus.Terminated, cancellationToken);

    /// <summary>The party may sign now: validity confirmed, not signed yet and, for AVIAM, after the airline.</summary>
    private static string? SignableBy(ContractDocumentData document, Reader reader) =>
        reader.CanSign && document.VersionStatus == nameof(ContractVersionStatus.Approved) && document.Validity is not null &&
        document.ContractStatus != nameof(ContractStatus.Terminated) &&
        document.Signatures.All(item => item.Party != reader.Party.ToString()) &&
        (reader.Party == ContractSignatureParty.Airline ||
         document.Signatures.Any(item => item.Party == nameof(ContractSignatureParty.Airline)))
            ? reader.Party.ToString() : null;

    private async Task<(long VersionId, long ContractId, Guid ContractPublicId, long AirlineId, ContractVersionStatus Status)?>
        VersionAsync(Guid versionId, CancellationToken cancellationToken, bool draft = false)
    {
        // Drafts follow the draft lists: editable or awaiting Finance, on a contract that is not terminated.
        var row = await (from version in context.ContractVersions.AsNoTracking()
                         join contract in context.Contracts.AsNoTracking() on version.ContractId equals contract.Id
                         where version.PublicId == versionId && (draft
                             ? (version.Status == ContractVersionStatus.Draft ||
                                version.Status == ContractVersionStatus.PendingFinanceApproval) &&
                               contract.Status != ContractStatus.Terminated
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
                              // The airline's designator in the document: IATA, or ICAO for an operator without one.
                              ContractStatus = contract.Status, Airline = airline.Name,
                              AirlineCode = airline.IataCode ?? airline.IcaoCode, organization.LegalName,
                              version.VersionNumber, version.Status, version.ValidFrom, version.ValidTo, version.CurrencyCode,
                              version.Terms, contract.SignedOn, version.RenewalMode, version.RenewalTermMonths,
                              version.RenewalNoticeDays, version.TerminationNoticeDays, version.TerminationTerms,
                              version.ValidityConfirmedAt })
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
        return new ContractDocumentData(head.ContractId, head.VersionId, head.ContractCode, head.ContractStatus.ToString(),
            head.Airline, head.AirlineCode, string.IsNullOrWhiteSpace(head.LegalName) ? null : head.LegalName,
            head.VersionNumber, head.Status.ToString(), head.ValidFrom, head.ValidTo, head.CurrencyCode, stations, rates,
            head.Terms, head.SignedOn, signatures, validity);
    }
}
