using System.Globalization;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Persistence.Operations;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Infrastructure.Persistence.Seed.History;

/// <summary>
/// Chunks <c>ops-signatures:&lt;month&gt;</c>, registered last: the signed Service Order of every history operation that
/// reached the hand-off, as the tablet leaves it (ADR-0032, 3-N02). The operations chunks write no document row, so
/// without these OCC reads «Orden de Servicio: Sin firmar» and cannot approve the history deliveries still pending.
/// <para>
/// For each operation handed off by a history agent (<c>HIST-RA-*</c>) that has no Service Order version yet, the
/// chunk assembles the order with the app's own <see cref="OperationDocumentAssembler"/> (what OCC and the portal read
/// now), stores that content as the version with its SHA-256 and adds the two required signatures on it: the airline's
/// representative (a name of the airline's station staff) and the AVIAM agent who handed it off. Both sign after the
/// push-back and before the hand-off, with a deterministic drawn signature. Since the signature covers the current
/// content, the order reads signed (never «Firma desactualizada») and a pending delivery can be approved.
/// </para>
/// <para>
/// Insert-only, like the rest of the history: it changes no operation. History agents have no ELEVANT account and the
/// history has no tablets, so the capture is recorded on the OCC account that keeps the history
/// (<see cref="HistoryAnchors.Occ"/>) without a device. They come after every other chunk so a database that already
/// holds the history (the shared VPS) only adds them, and a fresh database gets them in the same run.
/// </para>
/// </summary>
internal static class ServiceOrderSignatureHistory
{
    public const string ChunkPrefix = "ops-signatures:";

    /// <summary>Station staff names the airline representatives are drawn from (three per airline).</summary>
    private static readonly string[] FirstNames =
    [
        "Laura", "Carlos", "María", "José", "Ana", "Luis", "Carmen", "Jorge", "Patricia", "Miguel", "Rosa", "Pedro",
        "Daniela", "Andrés", "Sofía", "Ricardo", "Gabriela", "Fernando", "Valeria", "Héctor", "Natalia", "Raúl",
        "Paola", "Ernesto",
    ];

    private static readonly string[] LastNames =
    [
        "Méndez", "Rosario", "Castillo", "Peña", "Guzmán", "Reyes", "Almonte", "Santana", "Vargas", "Jiménez",
        "Tavárez", "Polanco", "Cabrera", "Ortiz", "Herrera", "Medina", "Batista", "Núñez", "Familia", "Encarnación",
        "Morales", "Rivas", "Sánchez", "De la Cruz",
    ];

    public static IEnumerable<HistoryChunk> Chunks(DevelopmentHistoryOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        foreach (var month in options.Months())
            yield return HistoryChunk.Create(ChunkPrefix + month.Name, (chunk, ct) => RunMonthAsync(chunk, month, ct));
    }

    /// <summary>The three representatives an airline sends to sign at PUJ, the same on every database.</summary>
    internal static IReadOnlyList<string> RepresentativesOf(string airlineCode)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(airlineCode);
        var random = HistoryRandom.For("service-order:representatives:" + airlineCode);
        var names = new List<string>(3);
        while (names.Count < 3)
        {
            var name = random.Pick(FirstNames) + " " + random.Pick(LastNames);
            if (!names.Contains(name, StringComparer.Ordinal)) names.Add(name);
        }
        return names;
    }

    /// <summary>
    /// A handwritten-looking signature for <paramref name="stream"/>: two or three strokes left to right, normalized
    /// to the pad (0–1) with three decimals, as <see cref="OperationDocumentRules.NormalizeStrokes"/> keeps them.
    /// </summary>
    internal static IReadOnlyList<IReadOnlyList<decimal>> StrokesFor(string stream)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(stream);
        var random = HistoryRandom.For("service-order:strokes:" + stream);
        var count = random.Between(2, 3);
        var strokes = new List<IReadOnlyList<decimal>>(count + 1);
        var x = 0.06 + random.NextDouble() * 0.06;
        for (var index = 0; index < count; index++)
        {
            var width = 0.18 + random.NextDouble() * 0.16;
            var points = random.Between(14, 28);
            var amplitude = 0.10 + random.NextDouble() * 0.18;
            var frequency = 2.0 + random.NextDouble() * 3.0;
            var phase = random.NextDouble() * Math.PI * 2;
            var baseline = 0.45 + random.NextDouble() * 0.12;
            var stroke = new decimal[points * 2];
            for (var point = 0; point < points; point++)
            {
                var t = point / (double)(points - 1);
                var px = x + width * t + (random.NextDouble() - 0.5) * 0.01;
                var py = baseline + amplitude * Math.Sin(phase + frequency * Math.PI * t) * (1 - 0.4 * t) +
                         (random.NextDouble() - 0.5) * 0.02;
                stroke[point * 2] = Coordinate(px);
                stroke[point * 2 + 1] = Coordinate(py);
            }
            strokes.Add(stroke);
            x = Math.Min(0.62, x + width + 0.02 + random.NextDouble() * 0.04);
        }
        // The underline that closes most signatures.
        var from = 0.08 + random.NextDouble() * 0.08;
        var underline = 0.72 + random.NextDouble() * 0.08;
        strokes.Add([Coordinate(from), Coordinate(underline), Coordinate(Math.Min(0.94, x + 0.1)),
            Coordinate(underline - 0.02 - random.NextDouble() * 0.04)]);
        return strokes;
    }

    private static decimal Coordinate(double value) =>
        decimal.Round((decimal)Math.Clamp(value, 0.02, 0.98), 3, MidpointRounding.AwayFromZero);

    /// <summary>
    /// When the representative and the agent sign: after the push-back and before the hand-off, one after the other.
    /// A hand-off recorded right at the push-back leaves the last minutes before it.
    /// </summary>
    internal static (DateTimeOffset Representative, DateTimeOffset Agent) SigningTimes(DateTimeOffset? pushback,
        DateTimeOffset handedOffAt, string stream)
    {
        var random = HistoryRandom.For("service-order:signed-at:" + stream);
        var end = HistoryClock.Truncate(handedOffAt);
        var start = pushback is { } at && at < end.AddSeconds(-20) ? HistoryClock.Truncate(at) : end.AddMinutes(-3);
        var span = (end - start).TotalSeconds;
        var representative = start.AddSeconds(Math.Floor(span * (0.25 + random.NextDouble() * 0.2)));
        var agent = start.AddSeconds(Math.Floor(span * (0.55 + random.NextDouble() * 0.3)));
        if (agent <= representative) agent = representative.AddSeconds(5);
        if (agent >= end) agent = end.AddSeconds(-2);
        if (representative >= agent) representative = agent.AddSeconds(-3);
        return (HistoryClock.Truncate(representative), HistoryClock.Truncate(agent));
    }

    private sealed record Candidate(long OperationId, Guid OperationPublicId, long AirlineId, long AgentId,
        DateTimeOffset HandedOffAt, DateTimeOffset? Pushback);

    private static async Task RunMonthAsync(HistoryChunkContext chunk, HistoryPeriod month,
        CancellationToken cancellationToken)
    {
        var db = chunk.Db;
        var agents = chunk.Catalog.Agents.ToDictionary(agent => agent.RampAgentId);
        if (agents.Count == 0) return;
        var agentIds = agents.Keys.ToArray();
        var stationId = chunk.Anchors.Station.Id;
        var candidates = await (
                from submission in db.OperationSubmissions.AsNoTracking()
                join operation in db.GroundOperations.AsNoTracking() on submission.GroundOperationId equals operation.Id
                join turnaround in db.Turnarounds.AsNoTracking() on operation.TurnaroundId equals turnaround.Id
                where submission.RevisionNumber == 1 && agentIds.Contains(submission.SubmittedByRampAgentId) &&
                      turnaround.StationId == stationId && turnaround.OperationDate >= month.From &&
                      turnaround.OperationDate <= month.To &&
                      operation.CurrentStatus != GroundOperationStatus.Cancelled &&
                      !db.Set<OperationDocumentVersion>().Any(version => version.GroundOperationId == operation.Id &&
                          version.Kind == OperationDocumentKind.ServiceOrder)
                orderby operation.Id
                select new Candidate(operation.Id, operation.PublicId, turnaround.AirlineId,
                    submission.SubmittedByRampAgentId, submission.SubmittedAt,
                    db.Set<OperationMilestone>()
                        .Where(milestone => milestone.GroundOperationId == operation.Id &&
                                            milestone.Code == OperationCloseFacts.Pushback)
                        .Select(milestone => milestone.ActualAt).FirstOrDefault()))
            .ToArrayAsync(cancellationToken);
        if (candidates.Length == 0) return;

        var airlines = chunk.Catalog.Airlines.ToDictionary(airline => airline.Id);
        var assembler = new OperationDocumentAssembler(db);
        var versions = new List<(Candidate Candidate, OperationDocumentVersion Version)>(candidates.Length);
        foreach (var candidate in candidates)
        {
            var assembled = await assembler.AssembleAsync(candidate.OperationId, cancellationToken);
            var content = assembled?.Documents.SingleOrDefault(item => item.Kind == OperationDocumentKind.ServiceOrder);
            if (content is null) continue;
            var canonical = OperationDocumentRules.CanonicalJson(content);
            var key = Key(candidate);
            var (representativeAt, _) = SigningTimes(candidate.Pushback, candidate.HandedOffAt, key);
            versions.Add((candidate, HistoryChunkContext.Stamp(new OperationDocumentVersion
            {
                GroundOperationId = candidate.OperationId, Kind = OperationDocumentKind.ServiceOrder,
                DocumentNumber = content.Number, ContentJson = canonical,
                ContentSha256 = OperationDocumentRules.Sha256Of(canonical),
            }, key + ":version", representativeAt)));
        }
        await chunk.InsertAsync(versions.Select(item => (object)item.Version), cancellationToken);

        var capturedBy = chunk.Anchors.Occ.Id;
        var signatures = new List<object>(versions.Count * 2);
        foreach (var (candidate, version) in versions)
        {
            var key = Key(candidate);
            var (representativeAt, agentAt) = SigningTimes(candidate.Pushback, candidate.HandedOffAt, key);
            var code = airlines.TryGetValue(candidate.AirlineId, out var airline)
                ? airline.Designator
                : candidate.AirlineId.ToString(CultureInfo.InvariantCulture);
            var representatives = RepresentativesOf(code);
            var representative = representatives[HistoryRandom.For(key + ":representative").Next(representatives.Count)];
            var agent = agents[candidate.AgentId].DisplayName;
            signatures.Add(Signature(version, OperationSignatureRole.AirlineRepresentative, representative,
                representativeAt, key, capturedBy));
            signatures.Add(Signature(version, OperationSignatureRole.AviamAgent, agent, agentAt, key, capturedBy));
        }
        await chunk.InsertAsync(signatures, cancellationToken);
    }

    private static string Key(Candidate candidate) =>
        string.Create(CultureInfo.InvariantCulture, $"service-order:{candidate.OperationPublicId:N}");

    private static OperationDocumentSignature Signature(OperationDocumentVersion version, OperationSignatureRole role,
        string signer, DateTimeOffset signedAt, string key, long capturedBy)
    {
        var name = OperationDocumentRules.NormalizeSignerName(signer)
                   ?? throw new InvalidOperationException($"Invalid history signer «{signer}».");
        var strokes = OperationDocumentRules.StrokesJson(StrokesFor($"{key}:{role}:{name}"));
        var signatureKey = $"{key}:signature:{role}";
        return HistoryChunkContext.Stamp(new OperationDocumentSignature
        {
            OperationDocumentVersionId = version.Id, Role = role, SignerName = name, CapturedByAccountId = capturedBy,
            SignedAt = HistoryClock.Truncate(signedAt), DocumentSha256 = version.ContentSha256, StrokesJson = strokes,
            StrokesSha256 = OperationDocumentRules.Sha256Of(strokes), RequestId = HistoryKeys.Key(signatureKey),
        }, signatureKey, signedAt);
    }
}
