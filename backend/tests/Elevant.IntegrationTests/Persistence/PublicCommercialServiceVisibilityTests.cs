using Elevant.Domain.Entities.Reference;
using Elevant.Persistence.Commercial;

namespace Elevant.IntegrationTests.Persistence;

public sealed class PublicCommercialServiceVisibilityTests
{
    [Theory]
    [InlineData(true, true, true)]
    [InlineData(true, false, false)]
    [InlineData(false, true, false)]
    [InlineData(false, false, false)]
    public void CatalogAndIntakeShareThePublishedActiveServiceRule(
        bool active, bool published, bool expected)
    {
        var service = new ServiceDefinition { IsActive = active, IsPublic = published };

        Assert.Equal(expected,
            PublicCommercialServiceVisibility.PublishedActive.Compile()(service));
    }
}
