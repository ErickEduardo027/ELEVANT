using System.Data;
using Elevant.Domain.Entities;

namespace Elevant.Infrastructure.Persistence.Seed.History;

/// <summary>
/// One atomic step of the history (<c>commercial</c>, <c>fx</c>, <c>ops:2026-W22</c>…). The runner executes it in its
/// own transaction at <see cref="Isolation"/>, then inserts its sentinel (<see cref="HistoryChunkRunner"/>), so a
/// chunk either committed every row and its sentinel or nothing. A chunk only inserts: the seeder login has SELECT
/// and INSERT on iam/ref/hr/commercial/ops and nothing else (no UPDATE, no audit, no outbox).
/// </summary>
internal abstract class HistoryChunk
{
    protected HistoryChunk(string name)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        if (name.Length > 60) throw new ArgumentOutOfRangeException(nameof(name), "A chunk name has at most 60 characters.");
        Name = name;
    }

    /// <summary>Unique name; the sentinel is <c>HistoryKeys.Key("chunk:" + Name)</c>.</summary>
    public string Name { get; }

    /// <summary>ReadCommitted by default; Serializable for chunks that number documents (e-NCF) like the API.</summary>
    public virtual IsolationLevel Isolation => IsolationLevel.ReadCommitted;

    /// <summary>
    /// Generates and inserts the chunk's rows. It may run more than once (the execution strategy retries a
    /// transient failure from the start, with a clear change tracker and a rebuilt catalog), so it derives
    /// everything from <paramref name="chunk"/> and never keeps state between runs.
    /// </summary>
    public abstract Task RunAsync(HistoryChunkContext chunk, CancellationToken cancellationToken);

    /// <summary>A chunk from a delegate: the usual way a generator declares its chunks.</summary>
    public static HistoryChunk Create(string name, Func<HistoryChunkContext, CancellationToken, Task> run,
        IsolationLevel isolation = IsolationLevel.ReadCommitted) => new DelegateChunk(name, run, isolation);

    private sealed class DelegateChunk(string name, Func<HistoryChunkContext, CancellationToken, Task> run,
        IsolationLevel isolation) : HistoryChunk(name)
    {
        public override IsolationLevel Isolation => isolation;

        public override Task RunAsync(HistoryChunkContext chunk, CancellationToken cancellationToken) =>
            run(chunk, cancellationToken);
    }
}

/// <summary>What a chunk works with: the context inside its transaction, the anchors, the catalog and helpers.</summary>
internal sealed class HistoryChunkContext(
    ElevantDbContext db,
    string chunkName,
    DevelopmentHistoryOptions options,
    HistoryAnchors anchors,
    HistoryCatalog catalog)
{
    /// <summary>The seeder context, inside the chunk's transaction. AutoDetectChanges is off: only insert.</summary>
    public ElevantDbContext Db { get; } = db;

    public string ChunkName { get; } = chunkName;

    public DevelopmentHistoryOptions Options { get; } = options;

    /// <summary>The base-seed rows every chunk relies on (station, accounts, services…).</summary>
    public HistoryAnchors Anchors { get; } = anchors;

    /// <summary>What earlier chunks created, rebuilt from the database for this run.</summary>
    public HistoryCatalog Catalog { get; } = catalog;

    /// <summary>Station local time (PUJ).</summary>
    public HistoryClock Clock { get; } = new(anchors.Station.IanaTimeZone);

    /// <summary>The deterministic random stream named <paramref name="stream"/>.</summary>
    public static HistoryRandom Random(string stream) => HistoryRandom.For(stream);

    /// <summary>The deterministic public id of <paramref name="suffix"/> (<see cref="HistoryKeys.Key"/>).</summary>
    public static Guid Key(string suffix) => HistoryKeys.Key(suffix);

    /// <summary>Sets the deterministic public id and the historical creation instant (created = updated).</summary>
    public static T Stamp<T>(T entity, string key, DateTimeOffset at) where T : AuditableEntity =>
        Stamp(entity, key, at, at);

    /// <summary>Sets the deterministic public id, creation and last-change instants. Never touch RowVersion.</summary>
    public static T Stamp<T>(T entity, string key, DateTimeOffset createdAt, DateTimeOffset updatedAt)
        where T : AuditableEntity
    {
        ArgumentNullException.ThrowIfNull(entity);
        entity.PublicId = HistoryKeys.Key(key);
        entity.CreatedAt = HistoryClock.Truncate(createdAt);
        entity.UpdatedAt = HistoryClock.Truncate(updatedAt);
        return entity;
    }

    /// <summary>
    /// Inserts one dependency layer: AddRange + SaveChanges (EF batches the INSERTs), then clears the change
    /// tracker so a large chunk keeps little in memory. Generated keys stay on the objects, so the next layer
    /// uses <c>parent.Id</c> as a foreign key. Pass rows in a stable order: identity values follow it.
    /// </summary>
    public async Task InsertAsync(IEnumerable<object> rows, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(rows);
        var batch = rows as IReadOnlyCollection<object> ?? rows.ToArray();
        if (batch.Count == 0) return;
        Db.AddRange(batch);
        await Db.SaveChangesAsync(cancellationToken);
        Db.ChangeTracker.Clear();
    }

    /// <summary>Inserts several layers in order, each with its own SaveChanges.</summary>
    public async Task InsertLayersAsync(CancellationToken cancellationToken, params IEnumerable<object>[] layers)
    {
        foreach (var layer in layers) await InsertAsync(layer, cancellationToken);
    }
}

/// <summary>
/// A generator: B (workforce), C (operations), D (finance, payables) and A (commercial, fx) each expose a static
/// <c>Chunks(DevelopmentHistoryOptions)</c> with this shape; <see cref="HistoryChunkRegistry"/> lists them in order.
/// </summary>
internal delegate IEnumerable<HistoryChunk> HistoryChunkSource(DevelopmentHistoryOptions options);
