using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Finance;
using Elevant.Application.Commercial;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Commercial;
using Elevant.Persistence.Operations;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Elevant.Persistence.Finance;

/// <summary>Serializes source-line reservation and immutable draft snapshots.</summary>
internal sealed class EfPreinvoiceDraftStore(
    ElevantDbContext context, TimeProvider timeProvider) : IPreinvoiceDraftStore
{
    public async Task<IReadOnlyList<PreinvoiceDisputeData>?> GetDisputesAsync(
        Guid accountId, Guid draftId, CancellationToken cancellationToken = default)
    {
        if (await GetAsync(accountId, draftId, cancellationToken) is null) return null;
        var now = timeProvider.GetUtcNow();
        var internalId = await (
            from item in context.Preinvoices.AsNoTracking()
            join station in context.Stations.AsNoTracking() on item.StationId equals station.Id
            join account in context.Users.AsNoTracking() on accountId equals account.PublicId
            join grant in context.AccountStationScopes.AsNoTracking()
                on new { AccountId = account.Id, StationId = station.Id }
                equals new { grant.AccountId, grant.StationId }
            where item.PublicId == draftId && grant.GrantedAt <= now && grant.RevokedAt == null
            select (long?)item.Id).SingleOrDefaultAsync(cancellationToken);
        return internalId is null ? null : await PreinvoiceDisputeReader.ReadAsync(
            context, internalId.Value, cancellationToken);
    }

    public async Task<PreinvoiceDraftDetail?> GetAsync(
        Guid accountId, Guid draftId, CancellationToken cancellationToken = default)
    {
        var actor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(accountId, cancellationToken);
        if (actor is null ||
            !actor.Roles.Any(role => role.Code == "FINANZAS" && role.Portal == PortalKind.BackOffice) ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff))
            return null;
        var allowedStationIds = actor.StationScopes.Select(scope => scope.StationId).ToArray();
        var now = timeProvider.GetUtcNow();
        var draft = await (
            from item in context.Preinvoices.AsNoTracking()
            join airline in context.Airlines.AsNoTracking() on item.AirlineId equals airline.Id
            join station in context.Stations.AsNoTracking() on item.StationId equals station.Id
            where item.PublicId == draftId && allowedStationIds.Contains(station.PublicId) &&
                  context.Users.AsNoTracking().Any(account =>
                      account.PublicId == accountId &&
                      context.AccountStationScopes.AsNoTracking().Any(grant =>
                          grant.AccountId == account.Id && grant.StationId == station.Id &&
                          grant.GrantedAt <= now && grant.RevokedAt == null))
            select new
            {
                item.Id, item.PublicId, item.From, item.To, item.CurrencyCode,
                item.Total, item.Status, AirlineId = airline.PublicId,
                AirlineName = airline.Name, StationId = station.PublicId,
            }).SingleOrDefaultAsync(cancellationToken);
        if (draft is null) return null;

        var lines = await (
            from line in context.PreinvoiceLines.AsNoTracking()
            join service in context.OperationServices.AsNoTracking()
                on line.OperationServiceId equals service.Id
            join submission in context.OperationSubmissions.AsNoTracking()
                on line.ApprovedSubmissionId equals submission.Id
            where line.PreinvoiceId == draft.Id
            orderby line.LineNumber
            select new PreinvoiceDraftLineDetail(
                line.PublicId, service.PublicId, submission.PublicId,
                line.LineNumber, line.OperationCode, line.OperationDate,
                line.ServiceCode, line.ServiceName, line.ExecutedQuantity,
                line.BillingUnit, line.UnitPrice, line.CurrencyCode, line.Amount))
            .ToArrayAsync(cancellationToken);
        return new PreinvoiceDraftDetail(draft.PublicId, draft.AirlineId,
            draft.AirlineName, draft.StationId, draft.From, draft.To,
            draft.CurrencyCode, draft.Total, draft.Status.ToString(), lines);
    }

    public async Task<PreinvoiceDraftResult> CreateAsync(
        CreatePreinvoiceDraftCommand request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var payloadHash = HashRequest(request);
        var strategy = context.Database.CreateExecutionStrategy();
        PreinvoiceDraftResult? attempt = null;
        try
        {
            return await strategy.ExecuteInTransactionAsync(
                async token =>
                {
                    context.ChangeTracker.Clear();
                    attempt = await CreateInsideTransactionAsync(request, payloadHash, token);
                    if (!attempt.IsSuccess) context.ChangeTracker.Clear();
                    return attempt;
                },
                async token =>
                {
                    context.ChangeTracker.Clear();
                    if (attempt is null || !attempt.IsSuccess) return attempt is not null;
                    return await context.Preinvoices.AsNoTracking().AnyAsync(
                        item => item.RequestId == request.RequestId &&
                            item.PayloadHash == payloadHash &&
                            item.PublicId == attempt.DraftId, token);
                },
                IsolationLevel.Serializable,
                cancellationToken);
        }
        catch (DbUpdateException exception) when (IsConflict(exception.GetBaseException()))
        {
            context.ChangeTracker.Clear();
            return await ReplayOrConflictAsync(request, payloadHash, cancellationToken);
        }
        catch (RetryLimitExceededException exception) when (IsConflict(exception.GetBaseException()))
        {
            context.ChangeTracker.Clear();
            return await ReplayOrConflictAsync(request, payloadHash, cancellationToken);
        }
        catch (SqlException exception) when (IsConflict(exception))
        {
            context.ChangeTracker.Clear();
            return await ReplayOrConflictAsync(request, payloadHash, cancellationToken);
        }
    }

    private async Task<PreinvoiceDraftResult> ReplayOrConflictAsync(
        CreatePreinvoiceDraftCommand request, string payloadHash,
        CancellationToken cancellationToken)
    {
        // A concurrent commit can win the unique request key before this transaction.
        var prior = await context.Preinvoices.AsNoTracking()
            .Where(item => item.RequestId == request.RequestId)
            .Select(item => new { item.PublicId, item.PayloadHash,
                item.CreatedByAccountId })
            .SingleOrDefaultAsync(cancellationToken);
        if (prior is not null && prior.PayloadHash == payloadHash)
        {
            var ownerId = await context.Users.AsNoTracking()
                .Where(item => item.PublicId == request.AccountId)
                .Select(item => (long?)item.Id)
                .SingleOrDefaultAsync(cancellationToken);
            if (prior.CreatedByAccountId == ownerId)
                return PreinvoiceDraftResult.Success(prior.PublicId, true);
        }
        return PreinvoiceDraftResult.Failed(PreinvoiceDraftFailure.Conflict);
    }

    private async Task<PreinvoiceDraftResult> CreateInsideTransactionAsync(
        CreatePreinvoiceDraftCommand request, string payloadHash,
        CancellationToken cancellationToken)
    {
        var actor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(request.AccountId, cancellationToken);
        if (actor is null ||
            !actor.Roles.Any(role => role.Code == "FINANZAS" && role.Portal == PortalKind.BackOffice) ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff) ||
            !actor.StationScopes.Any(scope => scope.StationId == request.StationId))
            return PreinvoiceDraftResult.Failed(PreinvoiceDraftFailure.NotFound);

        var now = timeProvider.GetUtcNow();
        var scope = await (
            from account in context.Users.AsNoTracking()
            from station in context.Stations.AsNoTracking()
            where account.PublicId == request.AccountId &&
                  station.PublicId == request.StationId && station.IsActive &&
                  context.AccountStationScopes.AsNoTracking().Any(grant =>
                      grant.AccountId == account.Id && grant.StationId == station.Id &&
                      grant.GrantedAt <= now && grant.RevokedAt == null)
            select new { AccountId = account.Id, StationId = station.Id })
            .SingleOrDefaultAsync(cancellationToken);
        if (scope is null) return PreinvoiceDraftResult.Failed(PreinvoiceDraftFailure.NotFound);

        var prior = await context.Preinvoices.AsNoTracking()
            .Where(item => item.RequestId == request.RequestId)
            .Select(item => new { item.PublicId, item.PayloadHash, item.CreatedByAccountId })
            .SingleOrDefaultAsync(cancellationToken);
        if (prior is not null)
            return prior.PayloadHash == payloadHash && prior.CreatedByAccountId == scope.AccountId
                ? PreinvoiceDraftResult.Success(prior.PublicId, true)
                : PreinvoiceDraftResult.Failed(PreinvoiceDraftFailure.Conflict);

        var requestedIds = request.ServiceIds.ToArray();
        var rows = await (
            from service in context.OperationServices.AsNoTracking()
            join operation in context.GroundOperations.AsNoTracking()
                on service.GroundOperationId equals operation.Id
            join turnaround in context.Turnarounds.AsNoTracking()
                on operation.TurnaroundId equals turnaround.Id
            join airline in context.Airlines.AsNoTracking()
                on turnaround.AirlineId equals airline.Id
            join definition in context.ServiceDefinitions.AsNoTracking()
                on service.ServiceDefinitionId equals definition.Id
            join submission in context.OperationSubmissions.AsNoTracking()
                on operation.Id equals submission.GroundOperationId
            join decision in context.ReviewDecisions.AsNoTracking()
                on submission.Id equals decision.OperationSubmissionId
            where requestedIds.Contains(service.PublicId) &&
                  turnaround.StationId == scope.StationId &&
                  turnaround.OperationDate >= request.From &&
                  turnaround.OperationDate <= request.To &&
                  operation.CurrentStatus == GroundOperationStatus.Approved &&
                  submission.Status == SubmissionStatus.Approved &&
                  decision.Outcome == ReviewOutcome.Approved &&
                  !context.OperationSubmissions.AsNoTracking().Any(later =>
                      later.GroundOperationId == operation.Id &&
                      later.RevisionNumber > submission.RevisionNumber)
            orderby turnaround.OperationDate, turnaround.OperationCode, service.LineNumber, service.Id
            select new
            {
                ServiceId = service.Id, ServicePublicId = service.PublicId,
                SubmissionId = submission.Id, submission.EvidenceJson,
                AirlineId = airline.Id, AirlinePublicId = airline.PublicId,
                turnaround.OperationDate, turnaround.OperationCode,
                definition.Code, definition.Name,
                service.CurrentStatus, service.ContractedQuantity,
                service.ExecutedQuantity, service.BillingUnitSnapshot,
                service.UnitPriceSnapshot, service.CurrencyCodeSnapshot,
            }).ToArrayAsync(cancellationToken);
        if (rows.Length != requestedIds.Length)
            return PreinvoiceDraftResult.Failed(PreinvoiceDraftFailure.NotFound);
        var serviceInternalIds = rows.Select(row => row.ServiceId).ToArray();
        if (await context.PreinvoiceLines.AsNoTracking().AnyAsync(
            line => serviceInternalIds.Contains(line.OperationServiceId),
            cancellationToken))
            return PreinvoiceDraftResult.Failed(PreinvoiceDraftFailure.Conflict);

        var approvedRows = rows.Select(row =>
        {
            OccReviewServiceData? evidence = null;
            try
            {
                if (row.EvidenceJson is not null)
                    evidence = OperationSubmissionEvidence.Parse(row.EvidenceJson).Services
                        .SingleOrDefault(item => item.Id == row.ServicePublicId);
            }
            catch (JsonException) { }
            catch (InvalidOperationException) { }
            var matches = evidence is not null &&
                evidence.Status == row.CurrentStatus.ToString() &&
                evidence.ContractedQuantity == row.ContractedQuantity &&
                evidence.ExecutedQuantity == row.ExecutedQuantity &&
                evidence.Unit == row.BillingUnitSnapshot;
            var valuation = matches
                ? FinanceApprovedServicePolicy.Evaluate(row.CurrentStatus,
                    row.ExecutedQuantity, row.UnitPriceSnapshot,
                    row.CurrencyCodeSnapshot, row.BillingUnitSnapshot)
                : new FinanceServiceValuation(false, "approved_evidence_mismatch", null);
            return new
            {
                Candidate = new PreinvoiceDraftCandidate(row.ServicePublicId,
                    row.AirlinePublicId, request.StationId, row.OperationDate,
                    row.CurrencyCodeSnapshot, valuation.Ready, valuation.Amount),
                Code = evidence?.Code ?? row.Code,
                Name = evidence?.Name ?? row.Name,
            };
        }).ToArray();
        var evaluated = PreinvoiceDraftPolicy.Evaluate(
            request.StationId, request.From, request.To,
            approvedRows.Select(item => item.Candidate).ToArray());
        if (!evaluated.Ready)
            return PreinvoiceDraftResult.Failed(PreinvoiceDraftFailure.Unprocessable,
                evaluated.Failure);

        var draft = new Preinvoice
        {
            PublicId = Guid.CreateVersion7(), AirlineId = rows[0].AirlineId,
            StationId = scope.StationId, CreatedByAccountId = scope.AccountId,
            RequestId = request.RequestId, PayloadHash = payloadHash,
            From = request.From, To = request.To, CurrencyCode = evaluated.Currency!,
            Total = evaluated.Total!.Value, Status = PreinvoiceStatus.Draft,
            CreatedAt = now, UpdatedAt = now,
        };
        context.Preinvoices.Add(draft);
        await context.SaveChangesAsync(cancellationToken);

        for (var index = 0; index < rows.Length; index++)
        {
            var row = rows[index];
            context.PreinvoiceLines.Add(new PreinvoiceLine
            {
                PublicId = Guid.CreateVersion7(), PreinvoiceId = draft.Id,
                OperationServiceId = row.ServiceId, ApprovedSubmissionId = row.SubmissionId,
                LineNumber = index + 1, OperationCode = row.OperationCode,
                OperationDate = row.OperationDate,
                ServiceCode = approvedRows[index].Code,
                ServiceName = approvedRows[index].Name,
                ExecutedQuantity = row.ExecutedQuantity,
                BillingUnit = row.BillingUnitSnapshot,
                UnitPrice = row.UnitPriceSnapshot!.Value,
                CurrencyCode = row.CurrencyCodeSnapshot!,
                Amount = evaluated.Lines[index].Amount,
                CreatedAt = now, UpdatedAt = now,
            });
        }
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = now,
            ActorType = AuditActorType.Account, ActorAccountId = scope.AccountId,
            ActorDisplay = actor.DisplayName, Action = "finance.preinvoice.draft.created",
            EntityType = nameof(Preinvoice), EntityPublicId = draft.PublicId,
            StationId = scope.StationId, Source = AuditSource.Api,
            CorrelationId = request.RequestId, RequestId = request.RequestId.ToString("D"),
            Reason = "Finance grouped approved service snapshots in a non-fiscal draft.",
        });
        await FinanceApprovedServiceChangeWriter.AddAsync(context,
            scope.StationId, draft.PublicId, now, "finance_preinvoices", cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        return PreinvoiceDraftResult.Success(draft.PublicId, false);
    }

    private static string HashRequest(CreatePreinvoiceDraftCommand request)
    {
        var source = $"{request.AccountId:D}|{request.StationId:D}|{request.From:yyyy-MM-dd}|" +
            $"{request.To:yyyy-MM-dd}|{string.Join(',', request.ServiceIds.Order())}";
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(source)));
    }

    private static bool IsConflict(Exception exception) =>
        exception is SqlException sql && sql.Number is 2601 or 2627 or 1205 or 1222 or 3960;
}
