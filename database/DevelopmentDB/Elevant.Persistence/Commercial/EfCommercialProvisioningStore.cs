using System.Data;
using System.Net.Mail;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Realtime;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

internal sealed class EfCommercialProvisioningStore(
    ElevantDbContext context,
    CommercialPermissionGuard permissions,
    UserManager<ApplicationUser> userManager)
    : ICommercialProvisioningStore
{
    public async Task<IReadOnlyList<ProvisioningTaskData>?> ListPendingAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        if (!await permissions.IsSuperAdministratorAsync(actorId, cancellationToken))
            return null;
        return await (from request in context.ServiceRequests.AsNoTracking()
            join contract in context.Contracts.AsNoTracking()
                on request.Id equals contract.OriginatingServiceRequestId
            where request.Status == CommercialRequestStatus.Approved &&
                request.ProvisionedAccountId == null &&
                contract.Status == ContractStatus.Draft
            orderby request.ReviewedAt descending
            select new ProvisioningTaskData(request.PublicId, request.RequestCode,
                request.RequestedAirlineName, request.ContactName, request.ContactEmail,
                contract.PublicId, request.ReviewedAt ?? request.SubmittedAt))
            .ToArrayAsync(cancellationToken);
    }

    public async Task<ProvisioningResult> ProvisionAsync(Guid actorId, Guid requestId,
        ProvisionAirlineInput input, CancellationToken cancellationToken = default)
    {
        if (!await permissions.IsSuperAdministratorAsync(actorId, cancellationToken))
            return ProvisioningResult.Failed(ProvisioningFailure.Forbidden);
        if (input is null || !ValidEmail(input.Email) ||
            string.IsNullOrWhiteSpace(input.TemporaryPassword))
            return ProvisioningResult.Failed(ProvisioningFailure.Invalid);
        var email = input.Email.Trim();
        var strategy = context.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(
                IsolationLevel.Serializable, cancellationToken);
            var request = await context.ServiceRequests.SingleOrDefaultAsync(
                item => item.PublicId == requestId, cancellationToken);
            if (request is null)
                return ProvisioningResult.Failed(ProvisioningFailure.NotFound);
            if (request.Status != CommercialRequestStatus.Approved ||
                request.ProvisionedAccountId is not null || request.AirlineId is null)
                return ProvisioningResult.Failed(ProvisioningFailure.Conflict);
            var airline = await context.Airlines.SingleOrDefaultAsync(
                item => item.Id == request.AirlineId && item.IsActive, cancellationToken);
            var organization = airline is null ? null : await context.Organizations.SingleOrDefaultAsync(
                item => item.Id == airline.OrganizationId &&
                    item.Status == OrganizationStatus.Active, cancellationToken);
            var role = await context.Roles.SingleOrDefaultAsync(item =>
                item.NormalizedName == "AIRLINE_CLIENT" && item.IsActive,
                cancellationToken);
            if (organization is null || role is null)
                return ProvisioningResult.Failed(ProvisioningFailure.Conflict);
            var normalizedEmail = email.ToUpperInvariant();
            if (await context.Users.AnyAsync(item => item.NormalizedEmail == normalizedEmail,
                cancellationToken) || await context.Persons.AnyAsync(item =>
                item.PrimaryEmail == email, cancellationToken))
                return ProvisioningResult.Failed(ProvisioningFailure.Conflict);

            var words = request.ContactName.Trim().Split(' ',
                StringSplitOptions.RemoveEmptyEntries);
            var person = new Person
            {
                PublicId = Guid.CreateVersion7(),
                FirstName = words[0],
                LastName = words.Length > 1 ? string.Join(' ', words[1..]) : "Representante",
                PrimaryEmail = email,
                PhoneNumber = request.ContactPhone,
                // Technical linkage only; this is not a claimed legal identity number.
                IdentificationType = "COMMERCIAL_REQUEST",
                IdentificationNumber = request.PublicId.ToString("N"),
            };
            context.Persons.Add(person);
            await context.SaveChangesAsync(cancellationToken);
            var account = new ApplicationUser
            {
                PublicId = Guid.CreateVersion7(),
                PersonId = person.Id,
                UserName = email, Email = email, EmailConfirmed = true,
                LockoutEnabled = true,
                Status = AccountLifecycleStatus.Active,
                InvitationStatus = InvitationStatus.Accepted,
                MustChangePassword = true,
            };
            var created = await userManager.CreateAsync(account, input.TemporaryPassword);
            if (!created.Succeeded)
                return ProvisioningResult.Failed(ProvisioningFailure.Invalid);
            context.Set<IdentityUserRole<long>>().Add(new IdentityUserRole<long>
            { UserId = account.Id, RoleId = role.Id });
            context.OrganizationMemberships.Add(new OrganizationMembership
            {
                PublicId = Guid.CreateVersion7(),
                AccountId = account.Id, OrganizationId = organization.Id,
                Kind = MembershipKind.AirlineClient,
                Status = MembershipStatus.Active,
                JobTitle = request.ContactTitle,
            });
            request.ProvisionedAccountId = account.Id;
            request.UpdatedAt = DateTimeOffset.UtcNow;
            var admin = await context.Users.SingleAsync(item => item.PublicId == actorId,
                cancellationToken);
            context.AuditEntries.Add(new AuditEntry
            {
                PublicId = Guid.CreateVersion7(), OccurredAt = DateTimeOffset.UtcNow,
                ActorType = AuditActorType.Account, ActorAccountId = admin.Id,
                Action = "commercial.airline_account.provisioned",
                EntityType = "iam.accounts", EntityPublicId = account.PublicId,
                OrganizationId = organization.Id,
                Source = AuditSource.Api, CorrelationId = Guid.CreateVersion7(),
                Reason = $"Commercial request {request.RequestCode}",
            });
            AccountChangeOutboxWriter.Add(context, account.Id, null,
                "airline_contracts", request.PublicId, DateTimeOffset.UtcNow);
            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return ProvisioningResult.Success(account.PublicId);
        });
    }

    private static bool ValidEmail(string? email) =>
        !string.IsNullOrWhiteSpace(email) && email.Trim().Length <= 256 &&
        MailAddress.TryCreate(email.Trim(), out var address) &&
        string.Equals(address.Address, email.Trim(), StringComparison.OrdinalIgnoreCase);
}
