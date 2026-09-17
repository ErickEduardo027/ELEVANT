using System.Reflection;
using Elevant.Contracts.Operations;

namespace Elevant.ArchitectureTests.Architecture;

public sealed class OccPlanningContractSafetyTests
{
    [Fact]
    public void OccPlanningContractsExposeOnlyStablePublicIdentifiers()
    {
        var contractTypes = typeof(OccPlanningSnapshotResponse).Assembly
            .GetTypes()
            .Where(type => type.Namespace == typeof(OccPlanningSnapshotResponse).Namespace)
            .ToArray();

        var longProperties = contractTypes
            .SelectMany(type => type.GetProperties(BindingFlags.Instance | BindingFlags.Public))
            .Where(property => property.PropertyType == typeof(long) ||
                property.PropertyType == typeof(long?))
            .Select(property => $"{property.DeclaringType?.Name}.{property.Name}")
            .ToArray();

        Assert.Empty(longProperties);
    }

    [Fact]
    public void OccPlanningContractsDoNotExposeCredentialOrIdentityDocumentFields()
    {
        var forbiddenFragments = new[]
        {
            "password",
            "token",
            "email",
            "identification",
            "documentnumber",
        };
        var exposedNames = typeof(OccPlanningSnapshotResponse).Assembly
            .GetTypes()
            .Where(type => type.Namespace == typeof(OccPlanningSnapshotResponse).Namespace)
            .SelectMany(type => type.GetProperties(BindingFlags.Instance | BindingFlags.Public))
            .Select(property => property.Name)
            .ToArray();

        Assert.DoesNotContain(
            exposedNames,
            name => forbiddenFragments.Any(fragment =>
                name.Contains(fragment, StringComparison.OrdinalIgnoreCase)));
    }
}
