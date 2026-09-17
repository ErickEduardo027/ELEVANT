using Elevant.Api.Controllers;
using Elevant.Application.Operations.GetRampAssignedOperations;
using Elevant.Contracts.Operations;
using Microsoft.AspNetCore.Mvc;

namespace Elevant.ArchitectureTests.Architecture;

public sealed class RampOperationsContractSafetyTests
{
    [Fact]
    public void RampReadDerivesAgentAndStationAuthorityOnTheServer()
    {
        var queryProperties = typeof(GetRampAssignedOperationsQuery)
            .GetProperties()
            .Select(property => (property.Name, property.PropertyType))
            .ToArray();

        Assert.Equal([(nameof(GetRampAssignedOperationsQuery.AccountId), typeof(Guid))], queryProperties);

        var action = typeof(RampOperationsController).GetMethod(
            nameof(RampOperationsController.GetAssignedOperations));

        Assert.NotNull(action);
        var parameter = Assert.Single(action.GetParameters());
        Assert.Equal(typeof(CancellationToken), parameter.ParameterType);
        Assert.Equal(
            "api/v{version:apiVersion}/ramp/operations",
            Assert.Single(typeof(RampOperationsController)
                .GetCustomAttributes(typeof(RouteAttribute), inherit: false)
                .Cast<RouteAttribute>())
                .Template);
    }

    [Fact]
    public void RampReadResponseHasOneServerOwnedOperationsRoot()
    {
        var property = Assert.Single(typeof(RampAssignedOperationsResponse).GetProperties());

        Assert.Equal(nameof(RampAssignedOperationsResponse.Operations), property.Name);
        Assert.Equal(typeof(IReadOnlyList<RampAssignedOperationResponse>), property.PropertyType);
        Assert.DoesNotContain(
            typeof(RampAssignedOperationsResponse).Assembly.GetTypes()
                .Where(type => type.Namespace == typeof(RampAssignedOperationsResponse).Namespace)
                .SelectMany(type => type.GetProperties()),
            candidate => candidate.Name.Contains("Password", StringComparison.OrdinalIgnoreCase) ||
                candidate.Name.Contains("Token", StringComparison.OrdinalIgnoreCase));
    }
}
