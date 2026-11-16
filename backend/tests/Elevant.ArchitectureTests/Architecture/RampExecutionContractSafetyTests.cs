using System.Text.Json.Serialization;
using Elevant.Api.Controllers;
using Elevant.Application.Operations.SubmitRampOperationChecklist;
using Elevant.Application.Operations.TransitionRampOperationService;
using Elevant.Contracts.Operations;
using Microsoft.AspNetCore.Mvc;

namespace Elevant.ArchitectureTests.Architecture;

public sealed class RampExecutionContractSafetyTests
{
    [Fact]
    public void ChecklistAndServiceRoutesRemainVersionedAndServerScoped()
    {
        AssertRoute<RampOperationChecklistsController>();
        AssertRoute<RampOperationServicesController>();

        Assert.DoesNotContain(
            typeof(RampOperationChecklistsController)
                .GetMethod(nameof(RampOperationChecklistsController.SubmitChecklist))!
                .GetParameters(),
            parameter => IsClientControlledAuthority(parameter.Name));
        Assert.DoesNotContain(
            typeof(RampOperationServicesController)
                .GetMethod(nameof(RampOperationServicesController.Transition))!
                .GetParameters(),
            parameter => IsClientControlledAuthority(parameter.Name));
    }

    [Fact]
    public void PublicWriteContractsRejectUnknownJsonMembers()
    {
        AssertDisallowsUnknownMembers<SubmitRampOperationChecklistRequest>();
        AssertDisallowsUnknownMembers<RampChecklistAnswerRequest>();
        AssertDisallowsUnknownMembers<TransitionRampOperationServiceRequest>();
    }

    [Fact]
    public void PublicWriteContractsDoNotAcceptAuthorityOrNumericEnumValues()
    {
        var properties = new[]
        {
            typeof(SubmitRampOperationChecklistRequest),
            typeof(RampChecklistAnswerRequest),
            typeof(TransitionRampOperationServiceRequest),
        }.SelectMany(type => type.GetProperties()).ToArray();

        Assert.DoesNotContain(properties, property =>
            IsClientControlledAuthority(property.Name) ||
            property.PropertyType.IsEnum);
        Assert.Equal(
            typeof(string),
            typeof(RampChecklistAnswerRequest).GetProperty(
                nameof(RampChecklistAnswerRequest.Value))!.PropertyType);
        Assert.Equal(
            typeof(string),
            typeof(TransitionRampOperationServiceRequest).GetProperty(
                nameof(TransitionRampOperationServiceRequest.TargetStatus))!.PropertyType);
    }

    [Fact]
    public void ApplicationCommandsReceiveAccountOnlyFromTheApiBoundary()
    {
        Assert.Contains(
            typeof(SubmitRampOperationChecklistCommand).GetProperties(),
            property => property.Name == nameof(SubmitRampOperationChecklistCommand.AccountId) &&
                property.PropertyType == typeof(Guid));
        Assert.Contains(
            typeof(TransitionRampOperationServiceCommand).GetProperties(),
            property => property.Name == nameof(TransitionRampOperationServiceCommand.AccountId) &&
                property.PropertyType == typeof(Guid));
        Assert.DoesNotContain(
            typeof(SubmitRampOperationChecklistCommand).GetProperties(),
            property => property.Name.Contains("Station", StringComparison.Ordinal) ||
                property.Name.Contains("Agent", StringComparison.Ordinal));
        Assert.DoesNotContain(
            typeof(TransitionRampOperationServiceCommand).GetProperties(),
            property => property.Name.Contains("Station", StringComparison.Ordinal) ||
                property.Name.Contains("Agent", StringComparison.Ordinal));
    }

    [Fact]
    public void PublicExecutionResponsesExposeNoInternalKeysOrCredentials()
    {
        var responseTypes = new[]
        {
            typeof(GetRampOperationChecklistResponse),
            typeof(RampChecklistResponse),
            typeof(RampChecklistTemplateResponse),
            typeof(RampChecklistSectionResponse),
            typeof(RampChecklistItemResponse),
            typeof(RampChecklistAnswerResponse),
            typeof(RampChecklistSubmissionResponse),
            typeof(RampChecklistSubmissionSummaryResponse),
            typeof(RampOperationServiceTransitionResponse),
            typeof(RampOperationServiceExecutionResponse),
        };
        var properties = responseTypes.SelectMany(type => type.GetProperties()).ToArray();

        Assert.DoesNotContain(properties, property =>
            property.PropertyType == typeof(long) ||
            property.PropertyType == typeof(long?) ||
            property.Name.Contains("Password", StringComparison.OrdinalIgnoreCase) ||
            property.Name.Contains("Token", StringComparison.OrdinalIgnoreCase));
    }

    private static void AssertRoute<TController>()
    {
        var route = Assert.Single(typeof(TController)
            .GetCustomAttributes(typeof(RouteAttribute), inherit: false)
            .Cast<RouteAttribute>());

        Assert.Equal("api/v{version:apiVersion}/ramp/operations", route.Template);
    }

    private static void AssertDisallowsUnknownMembers<T>()
    {
        var attribute = Assert.Single(typeof(T)
            .GetCustomAttributes(typeof(JsonUnmappedMemberHandlingAttribute), inherit: false)
            .Cast<JsonUnmappedMemberHandlingAttribute>());

        Assert.Equal(JsonUnmappedMemberHandling.Disallow, attribute.UnmappedMemberHandling);
    }

    private static bool IsClientControlledAuthority(string? name) =>
        name is not null &&
        (name.Equals("accountId", StringComparison.OrdinalIgnoreCase) ||
         name.Equals("agentId", StringComparison.OrdinalIgnoreCase) ||
         name.Equals("stationId", StringComparison.OrdinalIgnoreCase) ||
         name.Equals("organizationId", StringComparison.OrdinalIgnoreCase));
}
