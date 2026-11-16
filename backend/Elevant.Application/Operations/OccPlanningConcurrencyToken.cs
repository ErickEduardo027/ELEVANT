using System.Security.Cryptography;
using System.Text.Json;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

/// <summary>
/// Creates opaque strong validators for OCC planning representations. Consumers must
/// round-trip these values and never infer the underlying persistence model.
/// </summary>
public static class OccPlanningConcurrencyToken
{
    private const int Sha256Length = 32;

    public static string CreateOptions(
        TurnaroundStatus turnaroundStatus,
        GroundOperationStatus operationStatus,
        DateTimeOffset plannedStartAt,
        DateTimeOffset plannedEndAt,
        ReadOnlySpan<byte> operationRowVersion,
        OccPlanningOptionsSourceData options)
    {
        ArgumentNullException.ThrowIfNull(options);

        var canonicalOptions = options with
        {
            Turnaround = options.Turnaround with { ConcurrencyToken = string.Empty },
        };
        var payload = new OptionsVersionPayload(
            "occ-planning-options-v1",
            turnaroundStatus,
            operationStatus,
            plannedStartAt,
            plannedEndAt,
            Convert.ToBase64String(operationRowVersion),
            canonicalOptions);

        return Hash(payload);
    }

    public static string CreateAssignment(
        ReadOnlySpan<byte> operationRowVersion,
        OccAssignmentData assignment)
    {
        ArgumentNullException.ThrowIfNull(assignment);

        var payload = new AssignmentVersionPayload(
            "occ-planning-assignment-v1",
            Convert.ToBase64String(operationRowVersion),
            assignment with { ConcurrencyToken = string.Empty });

        return Hash(payload);
    }

    public static bool TryDecode(string? token, out byte[] digest)
    {
        digest = [];
        if (string.IsNullOrWhiteSpace(token) || token.Trim() != token)
        {
            return false;
        }

        try
        {
            var decoded = Convert.FromBase64String(token);
            if (decoded.Length != Sha256Length ||
                !string.Equals(
                    Convert.ToBase64String(decoded),
                    token,
                    StringComparison.Ordinal))
            {
                return false;
            }

            digest = decoded;
            return true;
        }
        catch (FormatException)
        {
            return false;
        }
    }

    public static bool Matches(string token, ReadOnlySpan<byte> expectedDigest) =>
        TryDecode(token, out var actualDigest) &&
        expectedDigest.Length == Sha256Length &&
        CryptographicOperations.FixedTimeEquals(actualDigest, expectedDigest);

    private static string Hash<T>(T payload)
    {
        var canonical = JsonSerializer.SerializeToUtf8Bytes(payload);
        return Convert.ToBase64String(SHA256.HashData(canonical));
    }

    private sealed record OptionsVersionPayload(
        string Scheme,
        TurnaroundStatus TurnaroundStatus,
        GroundOperationStatus OperationStatus,
        DateTimeOffset PlannedStartAt,
        DateTimeOffset PlannedEndAt,
        string OperationRowVersion,
        OccPlanningOptionsSourceData Options);

    private sealed record AssignmentVersionPayload(
        string Scheme,
        string OperationRowVersion,
        OccAssignmentData Assignment);
}
