using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Integration;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Elevant.Persistence.Operations;

/// <summary>
/// AVIAM forms of an operation (ADR-0032): content assembled from the single operation record,
/// signatures drawn on the tablet against the exact content hash, and walk-around marks with photo.
/// Writes follow every mobile command: device-scoped idempotent receipts, a serializable
/// transaction, the assigned agent only, audit and the ramp change hints.
/// </summary>
internal sealed class EfOperationDocumentStore(ElevantDbContext context, TimeProvider timeProvider,
    IOperationalEvidenceStore evidence) : IOperationDocumentStore
{
    private const string SignCommand = "ramp.operation.document.sign.v1";
    private const string DamageCommand = "ramp.operation.damage_mark.record.v1";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<OperationDocumentsView?> ReadForAgentAsync(Guid accountId, IReadOnlyCollection<Guid> stations,
        Guid operationId, CancellationToken cancellationToken = default)
    {
        var authorization = new EfRampExecutionAuthorization(context, timeProvider);
        var actor = await authorization.ResolveActorAsync(accountId, stations, null, cancellationToken);
        if (!actor.IsSuccess) return null;
        var scope = await authorization.ResolveOperationAsync(actor.Access!, operationId, false, cancellationToken);
        return scope is null ? null : await ViewAsync(scope.Operation.Id, scope.Operation.PublicId, cancellationToken);
    }

    public Task<OperationDocumentWriteResult> SignAsync(OperationDocumentSignRequest request,
        CancellationToken cancellationToken = default) =>
        RunAsync(SignCommand, request.ActorAccountId, request.AllowedStationIds, request.OperationId, request.InstallationId,
            request.IdempotencyKey,
            Hash(new { command = SignCommand, operationId = request.OperationId, kind = request.Kind.ToString(),
                role = request.Role.ToString(), request.SignerName, request.SignerIdentification, request.DocumentSha256,
                strokes = OperationDocumentRules.StrokesJson(request.Strokes) }),
            async (scope, ct) =>
            {
                var operation = scope.Operation.Operation;
                if (!OperationDocumentRules.CanSign(operation.CurrentStatus, operation.ActualStartAt)) return false;
                var assembled = await new OperationDocumentAssembler(context).AssembleAsync(operation.Id, ct);
                var content = assembled?.Documents.SingleOrDefault(item => item.Kind == request.Kind);
                if (content is null) return false;
                var canonical = OperationDocumentRules.CanonicalJson(content);
                var sha = OperationDocumentRules.Sha256Of(canonical);
                // What the signer saw must be what is stored: a changed form is re-read and signed again.
                if (!string.Equals(sha, request.DocumentSha256, StringComparison.Ordinal)) return false;
                var version = await context.Set<OperationDocumentVersion>().SingleOrDefaultAsync(item =>
                    item.GroundOperationId == operation.Id && item.Kind == request.Kind && item.ContentSha256 == sha, ct);
                if (version is null)
                {
                    version = new OperationDocumentVersion
                    {
                        PublicId = Guid.CreateVersion7(), GroundOperationId = operation.Id, Kind = request.Kind,
                        DocumentNumber = content.Number, ContentJson = canonical, ContentSha256 = sha,
                        CreatedAt = scope.Now, UpdatedAt = scope.Now,
                    };
                    context.Add(version);
                    await context.SaveChangesAsync(ct);
                }
                else if (await context.Set<OperationDocumentSignature>().AnyAsync(item =>
                             item.OperationDocumentVersionId == version.Id && item.Role == request.Role, ct))
                    return false;
                var strokes = OperationDocumentRules.StrokesJson(request.Strokes);
                context.Add(new OperationDocumentSignature
                {
                    PublicId = Guid.CreateVersion7(), OperationDocumentVersionId = version.Id, Role = request.Role,
                    SignerName = request.SignerName, SignerIdentification = request.SignerIdentification,
                    CapturedByAccountId = scope.Actor.AccountInternalId,
                    MobileDeviceId = scope.Actor.Device!.Id, SignedAt = scope.Now, DocumentSha256 = sha,
                    StrokesJson = strokes, StrokesSha256 = OperationDocumentRules.Sha256Of(strokes),
                    RequestId = request.IdempotencyKey, CreatedAt = scope.Now, UpdatedAt = scope.Now,
                });
                Audit(scope, request.RequestId, "ramp.operation.document.signed", new
                {
                    kind = request.Kind.ToString(), number = content.Number, role = request.Role.ToString(),
                    signer = request.SignerName, documentSha256 = sha, installationId = request.InstallationId,
                });
                return true;
            }, cancellationToken);

    public Task<OperationDocumentWriteResult> RecordDamageMarkAsync(DamageMarkWriteRequest request,
        CancellationToken cancellationToken = default) =>
        RunAsync(DamageCommand, request.ActorAccountId, request.AllowedStationIds, request.OperationId, request.InstallationId,
            request.IdempotencyKey,
            Hash(new { command = DamageCommand, operationId = request.OperationId, request.MarkId, request.X, request.Y,
                request.Note, reportedAt = Truncate(request.ReportedAt) }),
            async (scope, ct) =>
            {
                var operation = scope.Operation.Operation;
                var tapped = Truncate(request.ReportedAt);
                // 3-N25: the same window as the milestones; 3-N06: a damage captured before the hand-off is still
                // taken while OCC reviews it.
                var window = await RampEvidenceWindowReader.ReadAsync(context, operation, scope.Now, ct);
                if (RampExecutionPolicy.MilestoneRejection(scope.Operation.TurnaroundStatus, operation.CurrentStatus,
                        operation.ActualStartAt, operation.ActualEndAt, string.Empty, tapped, window,
                        new Dictionary<string, DateTimeOffset>(), scope.Now) is { } rejection)
                    return rejection;
                if (await context.Set<OperationDamageMark>().AnyAsync(item => item.PublicId == request.MarkId, ct))
                    return RampProblemCodes.GenericConflict;
                context.Add(new OperationDamageMark
                {
                    PublicId = request.MarkId, GroundOperationId = operation.Id, PositionX = request.X,
                    PositionY = request.Y, Note = request.Note, ReportedByRampAgentId = scope.Actor.RampAgentInternalId,
                    ReportedAt = RampEvidenceTimePolicy.Clamp(tapped, scope.Now), CreatedAt = scope.Now,
                    UpdatedAt = scope.Now,
                });
                Audit(scope, request.RequestId, "ramp.operation.damage_mark.recorded", new
                {
                    markId = request.MarkId, request.X, request.Y, note = request.Note, installationId = request.InstallationId,
                });
                await PendingSubmissionEvidenceRefresher.RefreshAsync(context, scope.Actor, scope.Operation, scope.Now,
                    "damage_mark", request.RequestId, ct);
                return null;
            }, cancellationToken);

    public async Task<OperationDocumentWriteResult> AttachDamagePhotoAsync(DamagePhotoWriteRequest request,
        CancellationToken cancellationToken = default)
    {
        var authorization = new EfRampExecutionAuthorization(context, timeProvider);
        var actor = await authorization.ResolveActorAsync(request.ActorAccountId, request.AllowedStationIds,
            request.InstallationId, cancellationToken);
        if (!actor.IsSuccess)
            return OperationDocumentWriteResult.Failed(actor.Failure == RampExecutionAuthorizationFailure.Forbidden
                ? RampExecutionWriteFailure.Forbidden : RampExecutionWriteFailure.NotFound);
        var scope = await authorization.ResolveOperationAsync(actor.Access!, request.OperationId, false, cancellationToken);
        if (scope is null) return OperationDocumentWriteResult.Failed(RampExecutionWriteFailure.NotFound);
        var mark = await context.Set<OperationDamageMark>().SingleOrDefaultAsync(item =>
            item.PublicId == request.MarkId && item.GroundOperationId == scope.Operation.Id, cancellationToken);
        if (mark is null) return OperationDocumentWriteResult.Failed(RampExecutionWriteFailure.NotFound);
        var sha = Convert.ToHexStringLower(SHA256.HashData(request.Content));
        if (mark.PhotoSha256 is not null)
            // One photo per mark: the same bytes again is a retry, other bytes are a conflict.
            return string.Equals(mark.PhotoSha256, sha, StringComparison.Ordinal)
                ? OperationDocumentWriteResult.Success(await ViewAsync(scope.Operation.Id, scope.Operation.PublicId,
                    cancellationToken), null)
                : OperationDocumentWriteResult.Failed(RampExecutionWriteFailure.Conflict);

        var key = $"operations/{scope.Operation.PublicId:N}/damage/{mark.PublicId:N}" +
                  (request.ContentType == "image/png" ? ".png" : ".jpg");
        await evidence.PutAsync(key, request.Content, request.ContentType, cancellationToken);
        var now = Truncate(timeProvider.GetUtcNow());
        mark.PhotoObjectKey = key;
        mark.PhotoContentType = request.ContentType;
        mark.PhotoLength = request.Content.Length;
        mark.PhotoSha256 = sha;
        mark.PhotoUploadedAt = now;
        mark.UpdatedAt = now;
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = now, ActorType = AuditActorType.Account,
            ActorAccountId = actor.Access!.AccountInternalId, ActorDisplay = actor.Access.DisplayName,
            Action = "ramp.operation.damage_mark.photo_attached", EntityType = nameof(GroundOperation),
            EntityPublicId = scope.Operation.PublicId, OrganizationId = scope.AirlineOrganizationInternalId,
            StationId = scope.StationInternalId, Source = AuditSource.MobileSync, CorrelationId = Guid.CreateVersion7(),
            RequestId = request.RequestId, Reason = "Assigned ramp agent attached a walk-around photo.",
            MetadataJson = JsonSerializer.Serialize(new { markId = mark.PublicId, sha256 = sha, request.Content.Length }, Json),
        });
        await RampOperationChangeWriter.AnnounceAsync(context, scope.Operation.Id, now, false, cancellationToken);
        try
        {
            await context.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return OperationDocumentWriteResult.Failed(RampExecutionWriteFailure.Conflict);
        }
        return OperationDocumentWriteResult.Success(await ViewAsync(scope.Operation.Id, scope.Operation.PublicId,
            cancellationToken), null);
    }

    public async Task<OperationDocumentsView?> ReadForOccAsync(IReadOnlyCollection<Guid> stations, Guid operationId,
        CancellationToken cancellationToken = default)
    {
        var operation = await OccOperationAsync(stations, operationId, cancellationToken);
        return operation is null ? null : await ViewAsync(operation.Value.Id, operationId, cancellationToken);
    }

    public async Task<DamagePhoto?> ReadDamagePhotoForOccAsync(IReadOnlyCollection<Guid> stations, Guid operationId,
        Guid markId, CancellationToken cancellationToken = default)
    {
        var operation = await OccOperationAsync(stations, operationId, cancellationToken);
        if (operation is null) return null;
        var mark = await context.Set<OperationDamageMark>().AsNoTracking()
            .Where(item => item.PublicId == markId && item.GroundOperationId == operation.Value.Id &&
                           item.PhotoObjectKey != null)
            .Select(item => new { item.PhotoObjectKey, item.PhotoContentType }).SingleOrDefaultAsync(cancellationToken);
        if (mark is null) return null;
        var content = await evidence.GetAsync(mark.PhotoObjectKey!, cancellationToken);
        return content is null ? null : new DamagePhoto(content, mark.PhotoContentType ?? "image/jpeg");
    }

    public async Task<SignedOperationDocument?> ReadSignedServiceOrderForAirlineAsync(Guid organizationId,
        Guid operationId, CancellationToken cancellationToken = default)
    {
        var operationInternalId = await (
                from organization in context.Organizations.AsNoTracking()
                join airline in context.Airlines.AsNoTracking() on organization.Id equals airline.OrganizationId
                join turnaround in context.Turnarounds.AsNoTracking() on airline.Id equals turnaround.AirlineId
                join operation in context.GroundOperations.AsNoTracking() on turnaround.Id equals operation.TurnaroundId
                where organization.PublicId == organizationId && organization.Type == OrganizationType.AirlineCustomer &&
                      organization.Status == OrganizationStatus.Active && airline.IsActive &&
                      operation.PublicId == operationId
                select (long?)operation.Id).SingleOrDefaultAsync(cancellationToken);
        if (operationInternalId is null) return null;
        var required = OperationDocumentRules.RolesFor(OperationDocumentKind.ServiceOrder);
        var versions = await context.Set<OperationDocumentVersion>().AsNoTracking()
            .Where(item => item.GroundOperationId == operationInternalId && item.Kind == OperationDocumentKind.ServiceOrder)
            .OrderByDescending(item => item.Id).ToArrayAsync(cancellationToken);
        foreach (var version in versions)
        {
            var signatures = await SignaturesAsync([version.Id], cancellationToken);
            var mine = signatures.GetValueOrDefault(version.Id) ?? [];
            if (required.All(role => mine.Any(signature => signature.Role == role)))
                return new SignedOperationDocument(OperationDocumentRules.Parse(version.ContentJson), version.ContentSha256, mine);
        }
        return null;
    }

    private async Task<(long Id, Guid PublicId)?> OccOperationAsync(IReadOnlyCollection<Guid> stations, Guid operationId,
        CancellationToken cancellationToken)
    {
        var allowed = stations.Where(id => id != Guid.Empty).Distinct().ToArray();
        var id = await (from operation in context.GroundOperations.AsNoTracking()
                        join turnaround in context.Turnarounds.AsNoTracking() on operation.TurnaroundId equals turnaround.Id
                        join station in context.Stations.AsNoTracking() on turnaround.StationId equals station.Id
                        where operation.PublicId == operationId && allowed.Contains(station.PublicId)
                        select (long?)operation.Id).SingleOrDefaultAsync(cancellationToken);
        return id is long value ? (value, operationId) : null;
    }

    /// <summary>Current content of every form, with the signatures that still match it.</summary>
    private async Task<OperationDocumentsView> ViewAsync(long operationId, Guid operationPublicId,
        CancellationToken cancellationToken)
    {
        var assembled = await new OperationDocumentAssembler(context).AssembleAsync(operationId, cancellationToken)
                        ?? throw new InvalidOperationException("The operation disappeared while reading its forms.");
        var versions = await context.Set<OperationDocumentVersion>().AsNoTracking()
            .Where(item => item.GroundOperationId == operationId)
            .Select(item => new { item.Id, item.Kind, item.ContentSha256 }).ToArrayAsync(cancellationToken);
        var signatures = await SignaturesAsync(versions.Select(item => item.Id).ToArray(), cancellationToken);
        var documents = assembled.Documents.Select(content =>
        {
            var sha = OperationDocumentRules.Sha256Of(OperationDocumentRules.CanonicalJson(content));
            var current = versions.SingleOrDefault(item => item.Kind == content.Kind && item.ContentSha256 == sha);
            var valid = current is null ? [] : signatures.GetValueOrDefault(current.Id) ?? [];
            var stale = versions.Where(item => item.Kind == content.Kind && item.ContentSha256 != sha)
                .SelectMany(item => signatures.GetValueOrDefault(item.Id) ?? [])
                .Select(item => item.Role).Where(role => valid.All(signature => signature.Role != role))
                .Distinct().OrderBy(role => role).ToArray();
            return new OperationDocumentData(content, sha, OperationDocumentRules.RolesFor(content.Kind), valid, stale);
        }).ToArray();
        return new OperationDocumentsView(operationPublicId, documents, assembled.DamageMarks);
    }

    private async Task<Dictionary<long, OperationDocumentSignatureData[]>> SignaturesAsync(long[] versionIds,
        CancellationToken cancellationToken)
    {
        if (versionIds.Length == 0) return [];
        var rows = await context.Set<OperationDocumentSignature>().AsNoTracking()
            .Where(item => versionIds.Contains(item.OperationDocumentVersionId))
            .OrderBy(item => item.SignedAt)
            .Select(item => new { item.OperationDocumentVersionId, item.Role, item.SignerName, item.SignedAt,
                item.DocumentSha256, item.StrokesJson, item.SignerIdentification }).ToArrayAsync(cancellationToken);
        return rows.GroupBy(item => item.OperationDocumentVersionId).ToDictionary(group => group.Key, group => group
            .Select(item => new OperationDocumentSignatureData(item.Role, item.SignerName, item.SignedAt, item.DocumentSha256,
                OperationDocumentRules.ParseStrokes(item.StrokesJson), item.SignerIdentification)).ToArray());
    }

    private Task<OperationDocumentWriteResult> RunAsync(string commandType, Guid accountId,
        IReadOnlyCollection<Guid> stations, Guid operationId, Guid installationId, Guid idempotencyKey, string payloadHash,
        Func<RampReceiptScope, CancellationToken, Task<bool>> apply, CancellationToken cancellationToken) =>
        RunAsync(commandType, accountId, stations, operationId, installationId, idempotencyKey, payloadHash,
            async (scope, ct) => await apply(scope, ct) ? null : RampProblemCodes.GenericConflict, cancellationToken);

    /// <summary>
    /// Runs one form command whose <paramref name="apply"/> answers null when it applied or the code of the rule it
    /// broke, which the receipt keeps and the refusal carries (phase 3, block C).
    /// </summary>
    private async Task<OperationDocumentWriteResult> RunAsync(string commandType, Guid accountId,
        IReadOnlyCollection<Guid> stations, Guid operationId, Guid installationId, Guid idempotencyKey, string payloadHash,
        Func<RampReceiptScope, CancellationToken, Task<string?>> apply, CancellationToken cancellationToken)
    {
        var outcome = await new RampReceiptRunner(context, timeProvider).RunAsync(commandType, accountId, stations,
            operationId, installationId, idempotencyKey, payloadHash, apply, cancellationToken);
        return outcome.IsSuccess
            ? OperationDocumentWriteResult.Success(
                await ViewAsync(outcome.OperationId, outcome.OperationPublicId, cancellationToken), outcome.ReceiptId)
            : OperationDocumentWriteResult.Failed(outcome.Failure!.Value, outcome.ReceiptId, outcome.Code);
    }

    private void Audit(RampReceiptScope scope, string? requestId, string action, object metadata) =>
        new RampReceiptRunner(context, timeProvider).Audit(scope, requestId, action,
            "Assigned ramp agent captured an AVIAM form on the tablet.", metadata);

    private static string Hash(object canonical) => RampReceiptRunner.Hash(canonical);

    private static DateTimeOffset Truncate(DateTimeOffset value) => RampReceiptRunner.Truncate(value);
}
