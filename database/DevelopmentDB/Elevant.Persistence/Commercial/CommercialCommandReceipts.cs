using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Elevant.Domain.Entities.Commercial;
using Elevant.Infrastructure.Persistence;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>
/// Idempotency receipts of the commercial and contract commands, kept in
/// <c>commercial.finance_pricing_commands</c> with the semantics of the Finance package commands: an
/// Idempotency-Key replays its first result only for the same actor, action and payload, and any
/// other use of the key is a conflict. The receipt is written in the command's own transaction, so a
/// replay never repeats its side effects (audit, emails, notifications).
/// </summary>
internal static class CommercialCommandReceipts
{
    private const string ReceiptIndex = "IX_finance_pricing_commands_request_id";

    internal enum Outcome { None, Replay, Conflict }

    internal readonly record struct Lookup(Outcome Outcome, Guid ResultId);

    /// <summary>
    /// SHA-256 of the route identifier and the normalized body. The payload never carries secrets
    /// (temporary passwords) nor the key itself.
    /// </summary>
    public static string Hash(object payload) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload))));

    public static async Task<Lookup> FindAsync(ElevantDbContext context, Guid key, long actorAccountId,
        string action, string hash, CancellationToken cancellationToken)
    {
        var prior = await context.Set<FinancePricingCommand>().AsNoTracking()
            .Where(item => item.RequestId == key)
            .Select(item => new { item.ActorAccountId, item.Action, item.PayloadHash, item.ResultId })
            .SingleOrDefaultAsync(cancellationToken);
        if (prior is null) return new Lookup(Outcome.None, Guid.Empty);
        return prior.ActorAccountId == actorAccountId && prior.Action == action && prior.PayloadHash == hash
            ? new Lookup(Outcome.Replay, prior.ResultId)
            : new Lookup(Outcome.Conflict, Guid.Empty);
    }

    public static void Add(ElevantDbContext context, Guid key, long actorAccountId, string action, string hash,
        Guid resultId, DateTimeOffset now) =>
        context.Set<FinancePricingCommand>().Add(new FinancePricingCommand
        {
            PublicId = Guid.CreateVersion7(), RequestId = key, ActorAccountId = actorAccountId, Action = action,
            PayloadHash = hash, ResultId = resultId, CreatedAt = now, UpdatedAt = now,
        });

    /// <summary>A concurrent command wrote the same key first; the caller looks the receipt up again.</summary>
    public static bool IsDuplicateKey(DbUpdateException exception) =>
        exception.InnerException is SqlException { Number: 2601 or 2627 } sql &&
        sql.Message.Contains(ReceiptIndex, StringComparison.Ordinal);
}
