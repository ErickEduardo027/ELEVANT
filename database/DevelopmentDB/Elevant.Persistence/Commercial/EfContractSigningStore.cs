using System.Data;
using System.Security.Cryptography;
using System.Text.Json;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Finance;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace Elevant.Persistence.Commercial;

/// <summary>SQL owns transitions; Adobe and private objects are verified before activation.</summary>
internal sealed class EfContractSigningStore(
    ElevantDbContext context, CommercialPermissionGuard permissions,
    IActorContextResolver actors, IContractObjectStore objects,
    IContractDocumentGenerator generator, IRecordedContractPdfRenderer renderer,
    IContractSignGateway sign,
    IConfiguration configuration, TimeProvider clock) : IContractSigningStore
{
    private const int MaxDocumentBytes = 8 * 1024 * 1024;

    public async Task<ContractSigningResult<IReadOnlyList<ContractSignerOption>>> ListAviamSignersAsync(
        Guid actorId, CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId, "contracts.signing.issue", cancellationToken))
            return ContractSigningResult<IReadOnlyList<ContractSignerOption>>.Failed(
                ContractSigningFailure.Forbidden);
        var signers = await (from user in context.Users.AsNoTracking()
            join person in context.Persons.AsNoTracking() on user.PersonId equals person.Id
            join membership in context.OrganizationMemberships.AsNoTracking()
                on user.Id equals membership.AccountId
            join organization in context.Organizations.AsNoTracking()
                on membership.OrganizationId equals organization.Id
            where user.Status == AccountLifecycleStatus.Active &&
                  user.InvitationStatus == InvitationStatus.Accepted &&
                  user.EmailConfirmed && !user.MustChangePassword &&
                  membership.Kind == MembershipKind.InternalStaff &&
                  membership.Status == MembershipStatus.Active &&
                  organization.Type == OrganizationType.AviamOperator &&
                  organization.Status == OrganizationStatus.Active
            orderby person.FirstName, person.LastName
            select new ContractSignerOption(user.PublicId,
                person.FirstName + " " + person.LastName, user.Email!))
            .Distinct().Take(100).ToArrayAsync(cancellationToken);
        return ContractSigningResult<IReadOnlyList<ContractSignerOption>>.Success(signers);
    }

    public async Task<ContractSigningResult<IReadOnlyList<ContractSigningSummary>>> ListManagedAsync(
        Guid actorId, CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId, "contracts.signing.read", cancellationToken))
            return ContractSigningResult<IReadOnlyList<ContractSigningSummary>>.Failed(
                ContractSigningFailure.Forbidden);
        var ids = await (from version in context.ContractVersions.AsNoTracking()
            join contract in context.Contracts.AsNoTracking() on version.ContractId equals contract.Id
            where contract.RequiresElectronicSigning &&
                  version.Status != ContractVersionStatus.Superseded
            orderby version.UpdatedAt descending
            select version.PublicId).Take(200).ToArrayAsync(cancellationToken);
        var summaries = new List<ContractSigningSummary>(ids.Length);
        foreach (var id in ids)
        {
            var summary = await SummaryAsync(id, cancellationToken);
            if (summary is not null) summaries.Add(summary);
        }
        return ContractSigningResult<IReadOnlyList<ContractSigningSummary>>.Success(summaries);
    }

    public async Task<ContractSigningResult<ContractSigningSummary>> SetSignersAsync(
        Guid actorId, Guid versionId, Guid aviamSignerAccountId,
        CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId, "contracts.signing.issue", cancellationToken))
            return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Forbidden);
        var row = await LoadAsync(versionId, cancellationToken);
        if (row is null) return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.NotFound);
        var (version, contract, airline) = row.Value;
        if (!contract.RequiresElectronicSigning || version.Status != ContractVersionStatus.Draft ||
            contract.Status != ContractStatus.Draft || contract.OriginatingServiceRequestId is null)
            return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Conflict);
        var request = await context.ServiceRequests.SingleOrDefaultAsync(item =>
            item.Id == contract.OriginatingServiceRequestId, cancellationToken);
        if (request is null || request.Status != CommercialRequestStatus.Approved ||
            request.ProvisionedAccountId is null || !request.AuthorityDeclared)
            return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Conflict);
        var aviam = await context.Users.SingleOrDefaultAsync(user =>
            user.PublicId == aviamSignerAccountId, cancellationToken);
        var airlineSigner = await context.Users.SingleOrDefaultAsync(user =>
            user.Id == request.ProvisionedAccountId, cancellationToken);
        if (!Eligible(aviam) || !Eligible(airlineSigner) ||
            !string.Equals(airlineSigner!.Email, request.ContactEmail,
                StringComparison.OrdinalIgnoreCase))
            return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Invalid);
        var aviamMember = await (from membership in context.OrganizationMemberships.AsNoTracking()
            join organization in context.Organizations.AsNoTracking()
                on membership.OrganizationId equals organization.Id
            where membership.AccountId == aviam!.Id &&
                  membership.Kind == MembershipKind.InternalStaff &&
                  membership.Status == MembershipStatus.Active &&
                  organization.Type == OrganizationType.AviamOperator &&
                  organization.Status == OrganizationStatus.Active
            select membership.Id).AnyAsync(cancellationToken);
        var airlineMember = await context.OrganizationMemberships.AsNoTracking().AnyAsync(
            membership => membership.AccountId == airlineSigner!.Id &&
                          membership.OrganizationId == airline.OrganizationId &&
                          membership.Kind == MembershipKind.AirlineClient &&
                          membership.Status == MembershipStatus.Active, cancellationToken);
        if (!aviamMember || !airlineMember)
            return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Invalid);
        version.AviamSignerAccountId = aviam!.Id;
        version.AirlineSignerAccountId = airlineSigner!.Id;
        version.UpdatedAt = clock.GetUtcNow();
        await context.SaveChangesAsync(cancellationToken);
        return ContractSigningResult<ContractSigningSummary>.Success(
            (await SummaryAsync(versionId, cancellationToken))!);
    }

    public async Task<ContractSigningResult<ContractSigningSummary>> GetManagedAsync(
        Guid actorId, Guid versionId, CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId, "contracts.signing.read", cancellationToken))
            return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Forbidden);
        var summary = await SummaryAsync(versionId, cancellationToken);
        return summary is null
            ? ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.NotFound)
            : ContractSigningResult<ContractSigningSummary>.Success(summary);
    }

    public async Task<ContractSigningResult<byte[]>> PreviewAsync(Guid actorId,
        Guid versionId, CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId, "contracts.signing.preview", cancellationToken))
            return ContractSigningResult<byte[]>.Failed(ContractSigningFailure.Forbidden);
        var row = await LoadAsync(versionId, cancellationToken);
        if (row is null) return ContractSigningResult<byte[]>.Failed(ContractSigningFailure.NotFound);
        var (version, contract, airline) = row.Value;
        if (!contract.RequiresElectronicSigning || version.Status != ContractVersionStatus.Approved ||
            version.AviamSignerAccountId is null || version.AirlineSignerAccountId is null)
            return ContractSigningResult<byte[]>.Failed(ContractSigningFailure.Conflict);
        var existing = await context.ContractSigningEnvelopes.AsNoTracking()
            .SingleOrDefaultAsync(item => item.ContractVersionId == version.Id, cancellationToken);
        if (existing is not null)
        {
            if (existing.SigningMethod == "AcademicLocal" && !AcademicReady() ||
                existing.SigningMethod != "AcademicLocal" && !AdobeReady())
                return ContractSigningResult<byte[]>.Failed(ContractSigningFailure.Unavailable);
            return await ReadVerifiedAsync(existing.DraftObjectKey, existing.DraftSha256,
                cancellationToken);
        }
        if (AcademicReady())
            return await PrepareAcademicAsync(version, contract, airline, cancellationToken);
        if (!AdobeReady()) return ContractSigningResult<byte[]>.Failed(ContractSigningFailure.Unavailable);
        var templateKey = configuration["ContractSigning:Template:ObjectKey"]!;
        var template = await objects.GetAsync(templateKey, cancellationToken);
        if (template is null || template.Length is < 4 or > MaxDocumentBytes ||
            template[0] != 'P' || template[1] != 'K' ||
            !Matches(template, configuration["ContractSigning:Template:Sha256"]!))
            return ContractSigningResult<byte[]>.Failed(ContractSigningFailure.Corrupt);
        var stations = await (from link in context.Set<ContractVersionStation>().AsNoTracking()
            join station in context.Stations.AsNoTracking() on link.StationId equals station.Id
            where link.ContractVersionId == version.Id
            orderby station.Code
            select new { station.Code, station.Name }).ToArrayAsync(cancellationToken);
        var services = await (from rate in context.ContractServiceRates.AsNoTracking()
            join service in context.ServiceDefinitions.AsNoTracking()
                on rate.ServiceDefinitionId equals service.Id
            where rate.ContractVersionId == version.Id && rate.IsConfirmed == true
            orderby service.Code
            select new { service.Code, service.Name, rate.BillingUnit,
                rate.UnitPrice, rate.MinimumQuantity }).ToArrayAsync(cancellationToken);
        if (stations.Length == 0 || services.Length == 0 || string.IsNullOrWhiteSpace(version.Terms))
            return ContractSigningResult<byte[]>.Failed(ContractSigningFailure.Conflict);
        var aviam = await context.Users.AsNoTracking().SingleAsync(user =>
            user.Id == version.AviamSignerAccountId, cancellationToken);
        var airlineSigner = await context.Users.AsNoTracking().SingleAsync(user =>
            user.Id == version.AirlineSignerAccountId, cancellationToken);
        if (!Eligible(aviam) || !Eligible(airlineSigner))
            return ContractSigningResult<byte[]>.Failed(ContractSigningFailure.Conflict);
        var mergeJson = JsonSerializer.Serialize(new
        {
            Contract = new { contract.ContractCode, version.VersionNumber,
                version.CurrencyCode, version.ValidFrom, version.ValidTo, version.Terms },
            Airline = new { airline.Name, airline.IataCode, airline.IcaoCode },
            Stations = stations, Services = services,
            Signers = new { AviamEmail = aviam.Email, AirlineEmail = airlineSigner.Email },
        });
        var pdf = await generator.GenerateAsync(template, mergeJson, cancellationToken);
        if (!ValidPdf(pdf)) return ContractSigningResult<byte[]>.Failed(ContractSigningFailure.Corrupt);
        var hash = Hash(pdf);
        var key = $"contracts/{contract.PublicId:N}/{version.PublicId:N}/{hash}/draft.pdf";
        await objects.PutAsync(key, pdf, cancellationToken);
        var now = clock.GetUtcNow();
        var envelope = new ContractSigningEnvelope
        {
            PublicId = Guid.CreateVersion7(), ContractVersionId = version.Id,
            SigningMethod = "Adobe",
            Status = "Prepared", AviamSignerAccountId = aviam.Id,
            AirlineSignerAccountId = airlineSigner.Id,
            AviamSignerEmail = aviam.Email!, AirlineSignerEmail = airlineSigner.Email!,
            TemplateVersion = configuration["ContractSigning:Template:Version"]!,
            TemplateSha256 = configuration["ContractSigning:Template:Sha256"]!,
            DraftObjectKey = key, DraftSha256 = hash,
            CreatedAt = now, UpdatedAt = now,
        };
        context.ContractSigningEnvelopes.Add(envelope);
        await context.SaveChangesAsync(cancellationToken);
        return ContractSigningResult<byte[]>.Success(pdf);
    }

    public async Task<ContractSigningResult<ContractSigningSummary>> IssueAsync(Guid actorId,
        Guid versionId, CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId, "contracts.signing.issue", cancellationToken))
            return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Forbidden);
        if (!AcademicReady() && !AdobeReady())
            return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Unavailable);
        var row = await LoadAsync(versionId, cancellationToken);
        if (row is null) return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.NotFound);
        var (version, contract, airline) = row.Value;
        if (!contract.RequiresElectronicSigning || version.Status != ContractVersionStatus.Approved)
            return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Conflict);
        var envelope = await context.ContractSigningEnvelopes.SingleOrDefaultAsync(item =>
            item.ContractVersionId == version.Id, cancellationToken);
        if (envelope is null) return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Conflict);
        if (envelope.SigningMethod == "AcademicLocal" && !AcademicReady() ||
            envelope.SigningMethod != "AcademicLocal" && !AdobeReady())
            return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Unavailable);
        if (envelope.Status is "Issuing" or "Issued" or "AwaitingAirline" or "Finalizing" or "Formalized")
            return ContractSigningResult<ContractSigningSummary>.Success(
                (await SummaryAsync(versionId, cancellationToken))!);
        if (envelope.Status != "Prepared")
            return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Conflict);
        if (envelope.TemplateVersion != (envelope.SigningMethod == "AcademicLocal"
                ? renderer.TemplateVersion : configuration["ContractSigning:Template:Version"]) ||
            !string.Equals(envelope.TemplateSha256, envelope.SigningMethod == "AcademicLocal"
                ? renderer.TemplateSha256 : configuration["ContractSigning:Template:Sha256"],
                StringComparison.OrdinalIgnoreCase) ||
            version.AviamSignerAccountId != envelope.AviamSignerAccountId ||
            version.AirlineSignerAccountId != envelope.AirlineSignerAccountId)
            return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Conflict);
        var aviamSigner = await context.Users.AsNoTracking().SingleOrDefaultAsync(user =>
            user.Id == envelope.AviamSignerAccountId, cancellationToken);
        var airlineSigner = await context.Users.AsNoTracking().SingleOrDefaultAsync(user =>
            user.Id == envelope.AirlineSignerAccountId, cancellationToken);
        if (!Eligible(aviamSigner) || !Eligible(airlineSigner) ||
            !string.Equals(aviamSigner!.Email, envelope.AviamSignerEmail,
                StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(airlineSigner!.Email, envelope.AirlineSignerEmail,
                StringComparison.OrdinalIgnoreCase) ||
            !await context.OrganizationMemberships.AsNoTracking().AnyAsync(membership =>
                membership.AccountId == airlineSigner.Id &&
                membership.OrganizationId == airline.OrganizationId &&
                membership.Kind == MembershipKind.AirlineClient &&
                membership.Status == MembershipStatus.Active, cancellationToken))
            return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Conflict);
        var draft = await ReadVerifiedAsync(envelope.DraftObjectKey, envelope.DraftSha256,
            cancellationToken);
        if (!draft.IsSuccess) return ContractSigningResult<ContractSigningSummary>.Failed(
            draft.Failure!.Value);
        if (envelope.SigningMethod == "AcademicLocal")
        {
            var issuedAt = clock.GetUtcNow();
            envelope.Status = "Issued";
            envelope.IssuedAt = issuedAt;
            envelope.UpdatedAt = issuedAt;
            context.ContractSigningEvents.Add(new ContractSigningEvent
            { EnvelopeId = envelope.Id, Kind = "Issued", OccurredAt = issuedAt,
                ActorAccountId = await ActorKeyAsync(actorId, cancellationToken),
                DocumentSha256 = envelope.DraftSha256 });
            try { await context.SaveChangesAsync(cancellationToken); }
            catch (DbUpdateConcurrencyException)
            {
                context.ChangeTracker.Clear();
                var concurrent = await SummaryAsync(versionId, cancellationToken);
                return concurrent?.SigningStatus is "Issued" or "AwaitingAirline" or "Formalized"
                    ? ContractSigningResult<ContractSigningSummary>.Success(concurrent)
                    : ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Conflict);
            }
            return ContractSigningResult<ContractSigningSummary>.Success(
                (await SummaryAsync(versionId, cancellationToken))!);
        }
        var now = clock.GetUtcNow();
        envelope.Status = "Issuing";
        envelope.NextCheckAt = now.AddMinutes(5);
        envelope.UpdatedAt = now;
        context.ContractSigningEvents.Add(new ContractSigningEvent
        { EnvelopeId = envelope.Id, Kind = "Issuing", OccurredAt = now });
        try { await context.SaveChangesAsync(cancellationToken); }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            var concurrent = await SummaryAsync(versionId, cancellationToken);
            return concurrent?.SigningStatus is "Issuing" or "Issued" or "AwaitingAirline" or
                "Finalizing" or "Formalized"
                ? ContractSigningResult<ContractSigningSummary>.Success(concurrent)
                : ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Conflict);
        }
        // Persisting the intent first makes an uncertain Adobe response reconcilable.
        var externalId = envelope.PublicId.ToString("N");
        var agreementId = await sign.FindByExternalIdAsync(externalId, cancellationToken) ??
            await sign.CreateAsync(externalId, contract.ContractCode, draft.Value!,
                envelope.AviamSignerEmail, envelope.AirlineSignerEmail, cancellationToken);
        envelope.AdobeAgreementId = agreementId;
        envelope.Status = "Issued";
        envelope.IssuedAt = clock.GetUtcNow();
        envelope.NextCheckAt = envelope.IssuedAt.Value.AddMinutes(2);
        envelope.UpdatedAt = envelope.IssuedAt.Value;
        context.ContractSigningEvents.Add(new ContractSigningEvent
        { EnvelopeId = envelope.Id, Kind = "Issued", OccurredAt = envelope.IssuedAt.Value });
        await context.SaveChangesAsync(cancellationToken);
        return ContractSigningResult<ContractSigningSummary>.Success(
            (await SummaryAsync(versionId, cancellationToken))!);
    }

    private async Task<ContractSigningResult<byte[]>> PrepareAcademicAsync(
        ContractVersion version, Contract contract,
        Elevant.Domain.Entities.Reference.Airline airline,
        CancellationToken cancellationToken)
    {
        if (contract.OriginatingServiceRequestId is null ||
            version.AviamSignerAccountId is null || version.AirlineSignerAccountId is null)
            return ContractSigningResult<byte[]>.Failed(ContractSigningFailure.Conflict);
        var request = await context.ServiceRequests.AsNoTracking().SingleOrDefaultAsync(item =>
            item.Id == contract.OriginatingServiceRequestId, cancellationToken);
        var airlineOrganization = await context.Organizations.AsNoTracking()
            .SingleAsync(item => item.Id == airline.OrganizationId, cancellationToken);
        var aviamOrganization = await context.Organizations.AsNoTracking()
            .Where(item => item.Type == OrganizationType.AviamOperator &&
                           item.Status == OrganizationStatus.Active &&
                           context.OrganizationMemberships.AsNoTracking().Any(member =>
                               member.OrganizationId == item.Id &&
                               member.AccountId == version.AviamSignerAccountId &&
                               member.Kind == MembershipKind.InternalStaff &&
                               member.Status == MembershipStatus.Active))
            .OrderBy(item => item.Id).FirstOrDefaultAsync(cancellationToken);
        if (request is null || aviamOrganization is null ||
            request.Status != CommercialRequestStatus.Approved || !request.AuthorityDeclared ||
            string.IsNullOrWhiteSpace(version.Terms))
            return ContractSigningResult<byte[]>.Failed(ContractSigningFailure.Conflict);
        var signers = await (from user in context.Users.AsNoTracking()
            join person in context.Persons.AsNoTracking() on user.PersonId equals person.Id
            where user.Id == version.AviamSignerAccountId ||
                  user.Id == version.AirlineSignerAccountId
            select new { user.Id, user.PublicId, user.Email, User = user,
                Name = person.FirstName + " " + person.LastName }).ToArrayAsync(cancellationToken);
        var aviam = signers.SingleOrDefault(item => item.Id == version.AviamSignerAccountId);
        var representative = signers.SingleOrDefault(item => item.Id == version.AirlineSignerAccountId);
        if (aviam is null || representative is null || !Eligible(aviam.User) ||
            !Eligible(representative.User) ||
            !string.Equals(representative.Email, request.ContactEmail,
                StringComparison.OrdinalIgnoreCase))
            return ContractSigningResult<byte[]>.Failed(ContractSigningFailure.Conflict);
        var stations = await (from link in context.Set<ContractVersionStation>().AsNoTracking()
            join station in context.Stations.AsNoTracking() on link.StationId equals station.Id
            where link.ContractVersionId == version.Id orderby station.Code
            select new ContractPdfStation(station.Code, station.Name)).ToArrayAsync(cancellationToken);
        var serviceRows = await (from rate in context.ContractServiceRates.AsNoTracking()
            join service in context.ServiceDefinitions.AsNoTracking()
                on rate.ServiceDefinitionId equals service.Id
            where rate.ContractVersionId == version.Id && rate.IsConfirmed == true
            orderby service.Code
            select new { service.Id, service.PublicId, service.Code, service.Name,
                rate.BillingUnit, rate.UnitPrice, rate.MinimumQuantity }).ToArrayAsync(cancellationToken);
        var packageRows = await (from link in context.Set<ContractServicePackage>().AsNoTracking()
            join package in context.Set<ServicePackageVersion>().AsNoTracking()
                on link.PackageVersionId equals package.Id
            where link.ContractVersionId == version.Id orderby package.Code
            select package).ToArrayAsync(cancellationToken);
        var packages = new List<ContractPdfPackage>(packageRows.Length);
        var covered = new HashSet<long>();
        foreach (var package in packageRows)
        {
            var components = await (from component in context.Set<ServicePackageComponent>().AsNoTracking()
                join service in context.ServiceDefinitions.AsNoTracking()
                    on component.ServiceDefinitionId equals service.Id
                where component.PackageVersionId == package.Id orderby service.Code
                select new { component.ServiceDefinitionId, service.PublicId, service.Code,
                    service.Name, component.BillingUnit, component.IncludedQuantity,
                    component.ExcessBlockSize, component.ExcessBlockPrice })
                .ToArrayAsync(cancellationToken);
            foreach (var component in components) covered.Add(component.ServiceDefinitionId);
            packages.Add(new ContractPdfPackage(package.PublicId, package.Code, package.Name,
                package.VersionNumber, package.BasePrice, package.Scope.ToString(),
                components.Select(component => new ContractPdfPackageComponent(
                    component.PublicId, component.Code, component.Name, component.BillingUnit,
                    component.IncludedQuantity, component.ExcessBlockSize,
                    component.ExcessBlockPrice)).ToArray()));
        }
        if (stations.Length == 0 || serviceRows.Length == 0 ||
            serviceRows.Any(service => service.UnitPrice < 0) ||
            packages.Any(package => package.Components.Count == 0))
            return ContractSigningResult<byte[]>.Failed(ContractSigningFailure.Conflict);
        // A service included in a package appears in its component list, not as an extra charge.
        var standalone = serviceRows.Where(service => !covered.Contains(service.Id))
            .Select(service => new ContractPdfService(service.PublicId, service.Code,
                service.Name, service.BillingUnit, service.UnitPrice,
                service.MinimumQuantity)).ToArray();
        var now = clock.GetUtcNow();
        var snapshot = new ContractPdfSnapshot(contract.PublicId, version.PublicId,
            request.PublicId, contract.ContractCode, request.RequestCode,
            version.VersionNumber, now, aviamOrganization.LegalName,
            request.AirlineLegalNameSnapshot ?? airlineOrganization.LegalName,
            airline.IataCode, aviam.Name, aviam.Email!, request.ContactName,
            request.ContactTitle ?? string.Empty, representative.Email!, version.ValidFrom,
            version.ValidTo, version.CurrencyCode, version.Terms!, stations,
            standalone, packages);
        var pdf = renderer.RenderDraft(snapshot);
        if (!ValidPdf(pdf)) return ContractSigningResult<byte[]>.Failed(ContractSigningFailure.Corrupt);
        var hash = Hash(pdf);
        var key = $"contracts/{contract.PublicId:N}/{version.PublicId:N}/{hash}/draft.pdf";
        await objects.PutAsync(key, pdf, cancellationToken);
        if (!(await ReadVerifiedAsync(key, hash, cancellationToken)).IsSuccess)
            return ContractSigningResult<byte[]>.Failed(ContractSigningFailure.Corrupt);
        var envelope = new ContractSigningEnvelope
        {
            PublicId = Guid.CreateVersion7(), ContractVersionId = version.Id,
            SigningMethod = "AcademicLocal", Status = "Prepared",
            AviamSignerAccountId = aviam.Id, AirlineSignerAccountId = representative.Id,
            AviamSignerEmail = aviam.Email!, AirlineSignerEmail = representative.Email!,
            TemplateVersion = renderer.TemplateVersion,
            TemplateSha256 = renderer.TemplateSha256,
            SnapshotJson = JsonSerializer.Serialize(snapshot), DraftObjectKey = key,
            DraftSha256 = hash, CreatedAt = now, UpdatedAt = now,
        };
        context.ContractSigningEnvelopes.Add(envelope);
        try { await context.SaveChangesAsync(cancellationToken); }
        catch (DbUpdateException)
        {
            context.ChangeTracker.Clear();
            var concurrent = await context.ContractSigningEnvelopes.AsNoTracking()
                .SingleOrDefaultAsync(item => item.ContractVersionId == version.Id,
                    cancellationToken);
            if (concurrent is null) throw;
            return await ReadVerifiedAsync(concurrent.DraftObjectKey, concurrent.DraftSha256,
                cancellationToken);
        }
        return ContractSigningResult<byte[]>.Success(pdf);
    }

    public async Task<ContractSigningResult<byte[]>> GetManagedDraftAsync(Guid actorId,
        Guid versionId, CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId, "contracts.signing.preview", cancellationToken))
            return ContractSigningResult<byte[]>.Failed(ContractSigningFailure.Forbidden);
        var version = await context.ContractVersions.AsNoTracking().SingleOrDefaultAsync(item =>
            item.PublicId == versionId, cancellationToken);
        if (version is null) return ContractSigningResult<byte[]>.Failed(ContractSigningFailure.NotFound);
        var envelope = await context.ContractSigningEnvelopes.AsNoTracking()
            .SingleOrDefaultAsync(item => item.ContractVersionId == version.Id, cancellationToken);
        return envelope is null
            ? ContractSigningResult<byte[]>.Failed(ContractSigningFailure.Conflict)
            : await ReadVerifiedAsync(envelope.DraftObjectKey, envelope.DraftSha256,
                cancellationToken);
    }

    public async Task<ContractSigningResult<byte[]>> GetAirlineDraftAsync(Guid actorId,
        Guid contractId, CancellationToken cancellationToken = default)
    {
        var access = await AirlineEnvelopeAsync(actorId, contractId, true, cancellationToken);
        if (!access.IsSuccess) return ContractSigningResult<byte[]>.Failed(access.Failure!.Value);
        var envelope = access.Value!.Envelope;
        if (envelope?.SigningMethod != "AcademicLocal" || envelope.IssuedAt is null)
            return ContractSigningResult<byte[]>.Failed(ContractSigningFailure.Conflict);
        return await ReadVerifiedAsync(envelope.DraftObjectKey, envelope.DraftSha256,
            cancellationToken);
    }

    public async Task<ContractSigningResult<ContractSigningSummary>> AcceptAviamAsync(Guid actorId,
        Guid versionId, Guid requestId, string expectedDraftSha256,
        CancellationToken cancellationToken = default)
    {
        var user = await context.Users.AsNoTracking().SingleOrDefaultAsync(item =>
            item.PublicId == actorId, cancellationToken);
        if (!Eligible(user))
            return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Forbidden);
        var internalMember = await (from member in context.OrganizationMemberships.AsNoTracking()
            join organization in context.Organizations.AsNoTracking()
                on member.OrganizationId equals organization.Id
            where member.AccountId == user!.Id &&
                  member.Kind == MembershipKind.InternalStaff &&
                  member.Status == MembershipStatus.Active &&
                  organization.Type == OrganizationType.AviamOperator &&
                  organization.Status == OrganizationStatus.Active
            select member.Id).AnyAsync(cancellationToken);
        if (!internalMember)
            return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Forbidden);
        var version = await context.ContractVersions.AsNoTracking().SingleOrDefaultAsync(item =>
            item.PublicId == versionId, cancellationToken);
        if (version is null) return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.NotFound);
        return await AcceptAcademicAsync(actorId, version.Id, user!.Id, requestId,
            expectedDraftSha256, false, cancellationToken);
    }

    public async Task<ContractSigningResult<ContractSigningSummary>> AcceptAirlineAsync(Guid actorId,
        Guid contractId, Guid requestId, string expectedDraftSha256,
        CancellationToken cancellationToken = default)
    {
        var access = await AirlineEnvelopeAsync(actorId, contractId, true, cancellationToken);
        if (!access.IsSuccess)
            return ContractSigningResult<ContractSigningSummary>.Failed(access.Failure!.Value);
        var user = await context.Users.AsNoTracking().SingleAsync(item =>
            item.PublicId == actorId, cancellationToken);
        var version = await context.ContractVersions.AsNoTracking().SingleOrDefaultAsync(item =>
            item.PublicId == access.Value!.VersionId, cancellationToken);
        if (version is null)
            return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.NotFound);
        return await AcceptAcademicAsync(actorId, version.Id,
            user.Id, requestId, expectedDraftSha256, true, cancellationToken);
    }

    private async Task<ContractSigningResult<ContractSigningSummary>> AcceptAcademicAsync(
        Guid actorId, long versionKey, long actorKey, Guid requestId,
        string expectedDraftSha256, bool airline,
        CancellationToken cancellationToken)
    {
        if (!AcademicReady())
            return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Unavailable);
        if (requestId == Guid.Empty || expectedDraftSha256?.Length != 64)
            return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Invalid);
        var version = await context.ContractVersions.AsNoTracking().SingleAsync(item =>
            item.Id == versionKey, cancellationToken);
        var envelope = await context.ContractSigningEnvelopes.SingleOrDefaultAsync(item =>
            item.ContractVersionId == versionKey, cancellationToken);
        if (envelope?.SigningMethod != "AcademicLocal" ||
            !string.Equals(expectedDraftSha256, envelope.DraftSha256,
                StringComparison.OrdinalIgnoreCase))
            return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Conflict);
        if ((airline ? envelope.AirlineSignerAccountId : envelope.AviamSignerAccountId) != actorKey)
            return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Forbidden);
        var user = await context.Users.AsNoTracking().SingleAsync(item =>
            item.Id == actorKey, cancellationToken);
        if (!Eligible(user) || !string.Equals(user.Email,
            airline ? envelope.AirlineSignerEmail : envelope.AviamSignerEmail,
            StringComparison.OrdinalIgnoreCase))
            return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Forbidden);
        var priorRequest = airline ? envelope.AirlineAcceptanceRequestId :
            envelope.AviamAcceptanceRequestId;
        if (priorRequest == requestId)
        {
            if (airline && envelope.Status == "Finalizing")
                return await FinalizeAcademicAsync(version.PublicId, envelope.Id,
                    cancellationToken);
            return ContractSigningResult<ContractSigningSummary>.Success(
                (await SummaryAsync(version.PublicId, cancellationToken))!);
        }
        if (priorRequest is not null ||
            envelope.Status != (airline ? "AwaitingAirline" : "Issued"))
            return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Conflict);
        var draft = await ReadVerifiedAsync(envelope.DraftObjectKey, envelope.DraftSha256,
            cancellationToken);
        if (!draft.IsSuccess)
            return ContractSigningResult<ContractSigningSummary>.Failed(draft.Failure!.Value);
        var now = clock.GetUtcNow();
        if (airline)
        {
            if (envelope.AviamAcceptedAt is null)
                return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Conflict);
            envelope.AirlineAcceptedAt = now;
            envelope.AirlineAcceptanceRequestId = requestId;
            envelope.Status = "Finalizing";
        }
        else
        {
            envelope.AviamAcceptedAt = now;
            envelope.AviamAcceptanceRequestId = requestId;
            envelope.Status = "AwaitingAirline";
        }
        envelope.UpdatedAt = now;
        context.ContractSigningEvents.Add(new ContractSigningEvent
        { EnvelopeId = envelope.Id, Kind = airline ? "AirlineAccepted" : "AviamAccepted",
            ActorAccountId = actorKey, RequestId = requestId,
            DocumentSha256 = envelope.DraftSha256, OccurredAt = now });
        try { await context.SaveChangesAsync(cancellationToken); }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Conflict);
        }
        return airline
            ? await FinalizeAcademicAsync(version.PublicId, envelope.Id, cancellationToken)
            : ContractSigningResult<ContractSigningSummary>.Success(
                (await SummaryAsync(version.PublicId, cancellationToken))!);
    }

    private async Task<ContractSigningResult<ContractSigningSummary>> FinalizeAcademicAsync(
        Guid versionId, long envelopeId, CancellationToken cancellationToken)
    {
        var envelope = await context.ContractSigningEnvelopes.SingleAsync(item =>
            item.Id == envelopeId, cancellationToken);
        if (envelope.Status == "Formalized")
            return ContractSigningResult<ContractSigningSummary>.Success(
                (await SummaryAsync(versionId, cancellationToken))!);
        if (envelope.SigningMethod != "AcademicLocal" || envelope.Status != "Finalizing" ||
            envelope.AviamAcceptedAt is null || envelope.AirlineAcceptedAt is null ||
            envelope.SnapshotJson is null)
            return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Conflict);
        var draft = await ReadVerifiedAsync(envelope.DraftObjectKey, envelope.DraftSha256,
            cancellationToken);
        if (!draft.IsSuccess)
            return ContractSigningResult<ContractSigningSummary>.Failed(draft.Failure!.Value);
        ContractPdfSnapshot snapshot;
        try { snapshot = JsonSerializer.Deserialize<ContractPdfSnapshot>(envelope.SnapshotJson)!; }
        catch (JsonException)
        { return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Corrupt); }
        if (snapshot is null || snapshot.VersionId != versionId)
            return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Corrupt);
        var actorRows = await context.Users.AsNoTracking()
            .Where(user => user.Id == envelope.AviamSignerAccountId ||
                           user.Id == envelope.AirlineSignerAccountId)
            .Select(user => new { user.Id, user.PublicId, user.Email })
            .ToArrayAsync(cancellationToken);
        var aviam = actorRows.SingleOrDefault(user => user.Id == envelope.AviamSignerAccountId);
        var airline = actorRows.SingleOrDefault(user => user.Id == envelope.AirlineSignerAccountId);
        if (aviam is null || airline is null ||
            !string.Equals(aviam.Email, snapshot.AviamSignerEmail,
                StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(airline.Email, snapshot.AirlineSignerEmail,
                StringComparison.OrdinalIgnoreCase))
            return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Corrupt);
        var aviamEvidence = new ContractAcceptanceEvidence(aviam.PublicId, "Aviam",
            snapshot.AviamSignerName, snapshot.AviamSignerEmail,
            envelope.AviamAcceptedAt.Value, envelope.DraftSha256);
        var airlineEvidence = new ContractAcceptanceEvidence(airline.PublicId, "Airline",
            snapshot.AirlineSignerName, snapshot.AirlineSignerEmail,
            envelope.AirlineAcceptedAt.Value, envelope.DraftSha256);
        var finalPdf = renderer.RenderFinal(draft.Value!, aviamEvidence, airlineEvidence);
        var evidencePdf = renderer.RenderEvidence(snapshot, envelope.DraftSha256,
            aviamEvidence, airlineEvidence);
        if (!ValidPdf(finalPdf) || !ValidPdf(evidencePdf))
            return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Corrupt);
        var finalHash = Hash(finalPdf);
        var evidenceHash = Hash(evidencePdf);
        var finalKey = $"contracts/{snapshot.ContractId:N}/{versionId:N}/{finalHash}/final.pdf";
        var evidenceKey = $"contracts/{snapshot.ContractId:N}/{versionId:N}/{evidenceHash}/evidence.pdf";
        await objects.PutAsync(finalKey, finalPdf, cancellationToken);
        await objects.PutAsync(evidenceKey, evidencePdf, cancellationToken);
        if (!(await ReadVerifiedAsync(finalKey, finalHash, cancellationToken)).IsSuccess ||
            !(await ReadVerifiedAsync(evidenceKey, evidenceHash, cancellationToken)).IsSuccess)
            return ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Corrupt);
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            var completed = await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(
                    IsolationLevel.Serializable, cancellationToken);
                var currentEnvelope = await context.ContractSigningEnvelopes.SingleAsync(item =>
                    item.Id == envelopeId, cancellationToken);
                if (currentEnvelope.Status == "Formalized") return true;
                var version = await context.ContractVersions.SingleAsync(item =>
                    item.Id == currentEnvelope.ContractVersionId, cancellationToken);
                var contract = await context.Contracts.SingleAsync(item =>
                    item.Id == version.ContractId, cancellationToken);
                if (currentEnvelope.Status != "Finalizing" ||
                    !contract.RequiresElectronicSigning ||
                    version.Status != ContractVersionStatus.Approved ||
                    contract.Status != ContractStatus.Draft)
                    return false;
                var formalizedAt = clock.GetUtcNow();
                contract.Status = ContractStatus.Active;
                contract.SignedOn = DateOnly.FromDateTime(formalizedAt.UtcDateTime);
                contract.UpdatedAt = formalizedAt;
                context.Set<ContractStatusEvent>().Add(new ContractStatusEvent
                { ContractId = contract.Id, FromStatus = ContractStatus.Draft,
                    ToStatus = ContractStatus.Active, OccurredAt = formalizedAt,
                    Reason = "Two recorded local acceptances and private PDFs verified" });
                currentEnvelope.SignedObjectKey = finalKey;
                currentEnvelope.SignedSha256 = finalHash;
                currentEnvelope.AuditObjectKey = evidenceKey;
                currentEnvelope.AuditSha256 = evidenceHash;
                currentEnvelope.FormalizedAt = formalizedAt;
                currentEnvelope.Status = "Formalized";
                currentEnvelope.UpdatedAt = formalizedAt;
                context.ContractSigningEvents.Add(new ContractSigningEvent
                { EnvelopeId = currentEnvelope.Id, Kind = "Formalized", OccurredAt = formalizedAt,
                    DocumentSha256 = finalHash });
                AccountChangeOutboxWriter.Add(context, currentEnvelope.AirlineSignerAccountId,
                    null, "airline_contracts", contract.PublicId, formalizedAt);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return true;
            });
            if (!completed)
                return ContractSigningResult<ContractSigningSummary>.Failed(
                    ContractSigningFailure.Conflict);
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            var concurrent = await SummaryAsync(versionId, cancellationToken);
            return concurrent?.SigningStatus == "Formalized"
                ? ContractSigningResult<ContractSigningSummary>.Success(concurrent)
                : ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.Conflict);
        }
        context.ChangeTracker.Clear();
        return ContractSigningResult<ContractSigningSummary>.Success(
            (await SummaryAsync(versionId, cancellationToken))!);
    }

    public async Task<ContractSigningResult<ContractSigningSummary>> GetAirlineAsync(
        Guid actorId, Guid contractId, CancellationToken cancellationToken = default)
    {
        var envelope = await AirlineEnvelopeAsync(actorId, contractId, false, cancellationToken);
        if (envelope.Failure is { } failure)
            return ContractSigningResult<ContractSigningSummary>.Failed(failure);
        var summary = await SummaryAsync(envelope.Value!.VersionId, cancellationToken);
        return summary is null
            ? ContractSigningResult<ContractSigningSummary>.Failed(ContractSigningFailure.NotFound)
            : ContractSigningResult<ContractSigningSummary>.Success(summary);
    }

    public async Task<ContractSigningResult<Uri>> GetAirlineSigningUrlAsync(
        Guid actorId, Guid contractId, CancellationToken cancellationToken = default)
    {
        var access = await AirlineEnvelopeAsync(actorId, contractId, true, cancellationToken);
        if (!access.IsSuccess) return ContractSigningResult<Uri>.Failed(access.Failure!.Value);
        var envelope = access.Value!.Envelope;
        if (envelope?.SigningMethod == "AcademicLocal")
            return ContractSigningResult<Uri>.Failed(ContractSigningFailure.Unavailable);
        if (envelope is null || envelope.Status != "AwaitingAirline" ||
            envelope.AdobeAgreementId is null)
            return ContractSigningResult<Uri>.Failed(ContractSigningFailure.Conflict);
        var url = await sign.GetSigningUrlAsync(envelope.AdobeAgreementId,
            envelope.AirlineSignerEmail, cancellationToken);
        if (url is null) return ContractSigningResult<Uri>.Failed(ContractSigningFailure.Conflict);
        if (url.Scheme != Uri.UriSchemeHttps || !AdobeHost(url.Host))
            return ContractSigningResult<Uri>.Failed(ContractSigningFailure.Corrupt);
        return ContractSigningResult<Uri>.Success(url);
    }

    public async Task<ContractSigningResult<byte[]>> GetFinalPdfAsync(Guid actorId,
        Guid contractId, CancellationToken cancellationToken = default)
    {
        var access = await AirlineEnvelopeAsync(actorId, contractId, true, cancellationToken);
        if (!access.IsSuccess) return ContractSigningResult<byte[]>.Failed(access.Failure!.Value);
        var envelope = access.Value!.Envelope;
        if (envelope?.Status != "Formalized" || envelope.SignedObjectKey is null ||
            envelope.SignedSha256 is null || envelope.AuditObjectKey is null ||
            envelope.AuditSha256 is null)
            return ContractSigningResult<byte[]>.Failed(ContractSigningFailure.Conflict);
        var audit = await ReadVerifiedAsync(envelope.AuditObjectKey, envelope.AuditSha256,
            cancellationToken);
        if (!audit.IsSuccess) return ContractSigningResult<byte[]>.Failed(audit.Failure!.Value);
        return await ReadVerifiedAsync(envelope.SignedObjectKey, envelope.SignedSha256,
            cancellationToken);
    }

    public async Task<ContractSigningResult<byte[]>> GetManagedEvidenceAsync(Guid actorId,
        Guid versionId, bool audit, CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId, "contracts.signing.read", cancellationToken))
            return ContractSigningResult<byte[]>.Failed(ContractSigningFailure.Forbidden);
        var version = await context.ContractVersions.AsNoTracking().SingleOrDefaultAsync(item =>
            item.PublicId == versionId, cancellationToken);
        if (version is null) return ContractSigningResult<byte[]>.Failed(ContractSigningFailure.NotFound);
        var envelope = await context.ContractSigningEnvelopes.AsNoTracking()
            .SingleOrDefaultAsync(item => item.ContractVersionId == version.Id, cancellationToken);
        if (envelope?.Status != "Formalized")
            return ContractSigningResult<byte[]>.Failed(ContractSigningFailure.Conflict);
        if (envelope.AuditObjectKey is null || envelope.AuditSha256 is null ||
            envelope.SignedObjectKey is null || envelope.SignedSha256 is null)
            return ContractSigningResult<byte[]>.Failed(ContractSigningFailure.Corrupt);
        var signed = await ReadVerifiedAsync(envelope.SignedObjectKey, envelope.SignedSha256,
            cancellationToken);
        if (!signed.IsSuccess) return signed;
        var evidence = await ReadVerifiedAsync(envelope.AuditObjectKey, envelope.AuditSha256,
            cancellationToken);
        return audit ? evidence : evidence.IsSuccess ? signed : evidence;
    }

    public async Task ReconcileDueAsync(CancellationToken cancellationToken = default)
    {
        if (!AdobeReady()) return;
        var now = clock.GetUtcNow();
        var ids = await context.ContractSigningEnvelopes.AsNoTracking()
            .Where(item => item.SigningMethod == "Adobe" &&
                           (item.Status == "Issuing" || item.Status == "Issued" ||
                            item.Status == "AwaitingAirline" || item.Status == "Finalizing") &&
                           item.NextCheckAt <= now)
            .OrderBy(item => item.NextCheckAt)
            .Select(item => item.Id).Take(20).ToArrayAsync(cancellationToken);
        foreach (var id in ids)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try { await ReconcileOneAsync(id, cancellationToken); }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
            catch
            {
                context.ChangeTracker.Clear();
                var envelope = await context.ContractSigningEnvelopes.SingleOrDefaultAsync(
                    item => item.Id == id, cancellationToken);
                if (envelope is null) continue;
                envelope.CheckAttempts++;
                envelope.LastCheckedAt = clock.GetUtcNow();
                envelope.NextCheckAt = envelope.LastCheckedAt.Value.AddMinutes(
                    Math.Min(1440, 5 * (1 << Math.Min(envelope.CheckAttempts, 8))));
                if (envelope.CheckAttempts >= 12) envelope.Status = "Incident";
                envelope.UpdatedAt = envelope.LastCheckedAt.Value;
                await context.SaveChangesAsync(cancellationToken);
            }
        }
    }

    private async Task ReconcileOneAsync(long id, CancellationToken cancellationToken)
    {
        var envelope = await context.ContractSigningEnvelopes.SingleAsync(item =>
            item.Id == id, cancellationToken);
        var now = clock.GetUtcNow();
        if (envelope.Status == "Issuing")
        {
            var found = await sign.FindByExternalIdAsync(envelope.PublicId.ToString("N"),
                cancellationToken);
            if (found is null)
            {
                envelope.CheckAttempts++;
                envelope.LastCheckedAt = now;
                envelope.NextCheckAt = now.AddMinutes(Math.Min(1440, 5 * (1 << Math.Min(envelope.CheckAttempts, 8))));
                if (envelope.CheckAttempts >= 12) envelope.Status = "Incident";
                await context.SaveChangesAsync(cancellationToken);
                return;
            }
            envelope.AdobeAgreementId = found;
            envelope.Status = "Issued";
            envelope.IssuedAt ??= now;
            context.ContractSigningEvents.Add(new ContractSigningEvent
            { EnvelopeId = envelope.Id, Kind = "Issued", OccurredAt = now });
        }
        if (envelope.AdobeAgreementId is null) throw new InvalidOperationException();
        var state = await sign.GetStateAsync(envelope.AdobeAgreementId, cancellationToken);
        if (state.SignerEmails.Count != 2)
            throw new InvalidDataException("Acrobat Sign recipient details are unavailable.");
        if (!string.Equals(state.SignerEmails[0], envelope.AviamSignerEmail,
                StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(state.SignerEmails[1], envelope.AirlineSignerEmail,
                StringComparison.OrdinalIgnoreCase))
        {
            envelope.Status = "Incident";
            context.ContractSigningEvents.Add(new ContractSigningEvent
            { EnvelopeId = envelope.Id, Kind = "SignerMismatch", OccurredAt = now });
        }
        else if (state.Status is "CANCELLED" or "ABORTED" or "EXPIRED")
        {
            envelope.Status = "Cancelled";
            context.ContractSigningEvents.Add(new ContractSigningEvent
            { EnvelopeId = envelope.Id, Kind = "Cancelled", OccurredAt = now });
        }
        else if (state.Status == "SIGNED")
        {
            envelope.Status = "Finalizing";
            var pdf = await sign.GetSignedPdfAsync(envelope.AdobeAgreementId, cancellationToken);
            var audit = await sign.GetAuditPdfAsync(envelope.AdobeAgreementId, cancellationToken);
            if (!ValidPdf(pdf) || !ValidPdf(audit)) throw new InvalidDataException();
            var signedHash = Hash(pdf);
            var auditHash = Hash(audit);
            var prefix = $"contracts/{envelope.PublicId:N}/final";
            var signedKey = $"{prefix}/{signedHash}/contract.pdf";
            var auditKey = $"{prefix}/{auditHash}/audit.pdf";
            await objects.PutAsync(signedKey, pdf, cancellationToken);
            await objects.PutAsync(auditKey, audit, cancellationToken);
            if (!(await ReadVerifiedAsync(signedKey, signedHash, cancellationToken)).IsSuccess ||
                !(await ReadVerifiedAsync(auditKey, auditHash, cancellationToken)).IsSuccess)
                throw new InvalidDataException();
            var strategy = context.Database.CreateExecutionStrategy();
            await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(
                    IsolationLevel.Serializable, cancellationToken);
                var currentEnvelope = await context.ContractSigningEnvelopes.SingleAsync(item =>
                    item.Id == id, cancellationToken);
                if (currentEnvelope.Status == "Formalized") return;
                var version = await context.ContractVersions.SingleAsync(item =>
                    item.Id == currentEnvelope.ContractVersionId, cancellationToken);
                var contract = await context.Contracts.SingleAsync(item =>
                    item.Id == version.ContractId, cancellationToken);
                if (!contract.RequiresElectronicSigning ||
                    contract.Status != ContractStatus.Draft ||
                    version.Status != ContractVersionStatus.Approved)
                    throw new InvalidDataException("The contract cannot be formalized.");
                contract.Status = ContractStatus.Active;
                contract.SignedOn = DateOnly.FromDateTime(now.UtcDateTime);
                contract.UpdatedAt = now;
                context.Set<ContractStatusEvent>().Add(new ContractStatusEvent
                {
                    ContractId = contract.Id, FromStatus = ContractStatus.Draft,
                    ToStatus = ContractStatus.Active, OccurredAt = now,
                    Reason = "Adobe agreement and private evidence verified",
                });
                AccountChangeOutboxWriter.Add(context, currentEnvelope.AirlineSignerAccountId,
                    null, "airline_contracts", contract.PublicId, now);
                currentEnvelope.SignedObjectKey = signedKey;
                currentEnvelope.SignedSha256 = signedHash;
                currentEnvelope.AuditObjectKey = auditKey;
                currentEnvelope.AuditSha256 = auditHash;
                currentEnvelope.FormalizedAt = now;
                currentEnvelope.Status = "Formalized";
                currentEnvelope.LastCheckedAt = now;
                currentEnvelope.CheckAttempts++;
                currentEnvelope.NextCheckAt = null;
                currentEnvelope.UpdatedAt = now;
                context.ContractSigningEvents.Add(new ContractSigningEvent
                { EnvelopeId = currentEnvelope.Id, Kind = "Formalized", OccurredAt = now });
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
            });
            return;
        }
        else if (state.Status == "OUT_FOR_SIGNATURE")
        {
            var airlineUrl = await sign.GetSigningUrlAsync(envelope.AdobeAgreementId,
                envelope.AirlineSignerEmail, cancellationToken);
            if (airlineUrl is not null) envelope.Status = "AwaitingAirline";
        }
        envelope.LastCheckedAt = now;
        envelope.CheckAttempts++;
        envelope.NextCheckAt = envelope.Status is "Formalized" or "Cancelled" or "Incident"
            ? null : now.AddMinutes(Math.Min(1440, 2 * (1 << Math.Min(envelope.CheckAttempts, 9))));
        envelope.UpdatedAt = now;
        await context.SaveChangesAsync(cancellationToken);
    }

    private async Task<ContractSigningResult<(Guid VersionId, ContractSigningEnvelope? Envelope)>>
        AirlineEnvelopeAsync(Guid actorId, Guid contractId, bool signerOnly,
            CancellationToken cancellationToken)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor is null || actor.AccountId != actorId ||
            !actor.Roles.Any(role => role.Code == "AIRLINE_CLIENT" &&
                role.Portal == PortalKind.AirlinePortal))
            return ContractSigningResult<(Guid, ContractSigningEnvelope?)>.Failed(
                ContractSigningFailure.Forbidden);
        var organizations = actor.Memberships.Where(membership =>
                membership.OrganizationType == OrganizationType.AirlineCustomer &&
                membership.Kind == MembershipKind.AirlineClient)
            .Select(membership => membership.OrganizationId).Distinct().ToArray();
        if (organizations.Length != 1)
            return ContractSigningResult<(Guid, ContractSigningEnvelope?)>.Failed(
                ContractSigningFailure.Forbidden);
        var row = await (from contract in context.Contracts.AsNoTracking()
            join airline in context.Airlines.AsNoTracking() on contract.AirlineId equals airline.Id
            join organization in context.Organizations.AsNoTracking()
                on airline.OrganizationId equals organization.Id
            join version in context.ContractVersions.AsNoTracking() on contract.Id equals version.ContractId
            where contract.PublicId == contractId && organization.PublicId == organizations[0] &&
                  contract.RequiresElectronicSigning &&
                  version.Status == ContractVersionStatus.Approved
            orderby version.VersionNumber descending
            select new { version.Id, version.PublicId }).FirstOrDefaultAsync(cancellationToken);
        if (row is null)
            return ContractSigningResult<(Guid, ContractSigningEnvelope?)>.Failed(
                ContractSigningFailure.NotFound);
        var envelope = await context.ContractSigningEnvelopes.AsNoTracking()
            .SingleOrDefaultAsync(item => item.ContractVersionId == row.Id, cancellationToken);
        if (signerOnly)
        {
            var user = await context.Users.AsNoTracking().SingleOrDefaultAsync(item =>
                item.PublicId == actorId, cancellationToken);
            if (envelope is null || !Eligible(user) ||
                envelope.AirlineSignerAccountId != user!.Id ||
                !string.Equals(envelope.AirlineSignerEmail, user.Email,
                    StringComparison.OrdinalIgnoreCase))
                return ContractSigningResult<(Guid, ContractSigningEnvelope?)>.Failed(
                    ContractSigningFailure.Forbidden);
        }
        return ContractSigningResult<(Guid, ContractSigningEnvelope?)>.Success(
            (row.PublicId, envelope));
    }

    private async Task<(ContractVersion Version, Contract Contract,
        Elevant.Domain.Entities.Reference.Airline Airline)?> LoadAsync(Guid versionId,
        CancellationToken cancellationToken)
    {
        var row = await (from version in context.ContractVersions
            join contract in context.Contracts on version.ContractId equals contract.Id
            join airline in context.Airlines on contract.AirlineId equals airline.Id
            where version.PublicId == versionId
            select new { version, contract, airline }).SingleOrDefaultAsync(cancellationToken);
        return row is null ? null : (row.version, row.contract, row.airline);
    }

    private async Task<ContractSigningSummary?> SummaryAsync(Guid versionId,
        CancellationToken cancellationToken)
    {
        var row = await (from version in context.ContractVersions.AsNoTracking()
            join contract in context.Contracts.AsNoTracking() on version.ContractId equals contract.Id
            join airline in context.Airlines.AsNoTracking() on contract.AirlineId equals airline.Id
            where version.PublicId == versionId && contract.RequiresElectronicSigning
            select new { version, contract, airline }).SingleOrDefaultAsync(cancellationToken);
        if (row is null) return null;
        var envelope = await context.ContractSigningEnvelopes.AsNoTracking()
            .SingleOrDefaultAsync(item => item.ContractVersionId == row.version.Id,
                cancellationToken);
        var signerIds = new[] { row.version.AviamSignerAccountId,
            row.version.AirlineSignerAccountId }.Where(id => id is not null).ToArray();
        var signers = await context.Users.AsNoTracking()
            .Where(user => signerIds.Contains(user.Id))
            .Select(user => new { user.Id, user.PublicId, user.Email })
            .ToArrayAsync(cancellationToken);
        var aviam = signers.FirstOrDefault(user => user.Id == row.version.AviamSignerAccountId);
        var airlineSigner = signers.FirstOrDefault(user => user.Id == row.version.AirlineSignerAccountId);
        return new ContractSigningSummary(row.contract.PublicId, row.version.PublicId,
            row.contract.ContractCode, row.airline.Name,
            row.version.Status.ToString(), envelope?.Status ?? "AwaitingEmission", true,
            aviam?.PublicId, aviam?.Email, airlineSigner?.PublicId,
            airlineSigner?.Email, envelope?.IssuedAt, envelope?.FormalizedAt,
            envelope?.DraftSha256, envelope?.SignedSha256, envelope?.AuditSha256,
            envelope?.LastCheckedAt, envelope?.NextCheckAt,
            envelope?.SigningMethod, envelope?.AviamAcceptedAt,
            envelope?.AirlineAcceptedAt);
    }

    private async Task<ContractSigningResult<byte[]>> ReadVerifiedAsync(string key,
        string sha256, CancellationToken cancellationToken)
    {
        var bytes = await objects.GetAsync(key, cancellationToken);
        return bytes is not null && ValidPdf(bytes) && Matches(bytes, sha256)
            ? ContractSigningResult<byte[]>.Success(bytes)
            : ContractSigningResult<byte[]>.Failed(ContractSigningFailure.Corrupt);
    }

    private bool AcademicReady() => configuration.GetValue<bool>("ContractSigning:Enabled") &&
        string.Equals(configuration["ContractSigning:Mode"], "AcademicLocal",
            StringComparison.OrdinalIgnoreCase) &&
        !string.IsNullOrWhiteSpace(configuration["ContractSigning:LocalArchiveDirectory"]);

    private bool AdobeReady() => configuration.GetValue<bool>("ContractSigning:Enabled") &&
        !string.Equals(configuration["ContractSigning:Mode"], "AcademicLocal",
            StringComparison.OrdinalIgnoreCase) &&
        configuration.GetValue<bool>("ContractSigning:PolicyApproved") &&
        configuration.GetValue<bool>("ContractSigning:RetentionApproved") &&
        configuration.GetValue<bool>("ContractSigning:Template:LegalApproved") &&
        configuration.GetValue<bool>("ContractSigning:Template:ContractsApproved") &&
        !string.IsNullOrWhiteSpace(configuration["ContractSigning:Template:ObjectKey"]) &&
        !string.IsNullOrWhiteSpace(configuration["ContractSigning:Template:Version"]) &&
        configuration["ContractSigning:Template:Sha256"] is { Length: 64 } &&
        !string.IsNullOrWhiteSpace(configuration["ContractSigning:AdobePdf:ClientId"]) &&
        !string.IsNullOrWhiteSpace(configuration["ContractSigning:AdobePdf:ClientSecret"]) &&
        !string.IsNullOrWhiteSpace(configuration["ContractSigning:AdobeSign:ApiBaseUrl"]) &&
        !string.IsNullOrWhiteSpace(configuration["ContractSigning:AdobeSign:ClientId"]) &&
        !string.IsNullOrWhiteSpace(configuration["ContractSigning:AdobeSign:ClientSecret"]) &&
        !string.IsNullOrWhiteSpace(configuration["ContractSigning:AdobeSign:RefreshToken"]) &&
        !string.IsNullOrWhiteSpace(configuration["MediaStorage:Endpoint"]) &&
        !string.IsNullOrWhiteSpace(configuration["MediaStorage:Bucket"]) &&
        !string.IsNullOrWhiteSpace(configuration["MediaStorage:AccessKey"]) &&
        !string.IsNullOrWhiteSpace(configuration["MediaStorage:SecretKey"]);

    private static bool Eligible(ApplicationUser? user) => user is
    {
        Status: AccountLifecycleStatus.Active,
        InvitationStatus: InvitationStatus.Accepted,
        EmailConfirmed: true, MustChangePassword: false,
    } && !string.IsNullOrWhiteSpace(user.Email);

    private static bool AdobeHost(string host) =>
        host.EndsWith(".adobesign.com", StringComparison.OrdinalIgnoreCase) ||
        host.EndsWith(".echosign.com", StringComparison.OrdinalIgnoreCase) ||
        host.EndsWith(".adobe.com", StringComparison.OrdinalIgnoreCase);

    private static bool ValidPdf(byte[]? bytes) => bytes is
    { Length: >= 5 and <= MaxDocumentBytes } &&
        bytes.AsSpan(0, 5).SequenceEqual("%PDF-"u8);

    private static string Hash(byte[] bytes) =>
        Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

    private static bool Matches(byte[] bytes, string expected) =>
        string.Equals(Hash(bytes), expected, StringComparison.OrdinalIgnoreCase);

    private async Task<long?> ActorKeyAsync(Guid actorId, CancellationToken cancellationToken) =>
        await context.Users.AsNoTracking().Where(user => user.PublicId == actorId)
            .Select(user => (long?)user.Id).SingleOrDefaultAsync(cancellationToken);
}
