using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Abstractions.Realtime;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Commercial;
using Elevant.Persistence.Finance;
using Elevant.Persistence.Integration;
using Elevant.Persistence.Operations;
using Elevant.Persistence.Realtime;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace Elevant.Persistence;

/// <summary>Registers the shared SQL Server persistence layer.</summary>
public static class DependencyInjection
{
    private const string DatabaseConnectionName = "ElevantDatabase";

    /// <summary>Adds the Elevant database context and readiness check.</summary>
    public static IServiceCollection AddPersistence(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        var connectionString = configuration.GetConnectionString(DatabaseConnectionName);
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException(
                $"ConnectionStrings:{DatabaseConnectionName} must be supplied by the environment or secret store.");
        }

        services.AddDbContext<ElevantDbContext>(options =>
            options.UseSqlServer(connectionString, ElevantSqlServerOptions.Configure));

        services
            .AddIdentityCore<ApplicationUser>(options =>
            {
                options.Password.RequiredLength = 14;
                options.Password.RequireDigit = true;
                options.Password.RequireLowercase = true;
                options.Password.RequireUppercase = true;
                options.Password.RequireNonAlphanumeric = true;
                options.User.RequireUniqueEmail = true;
                options.Lockout.AllowedForNewUsers = true;
                options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
                options.Lockout.MaxFailedAccessAttempts = 5;
            })
            .AddRoles<ApplicationRole>()
            .AddEntityFrameworkStores<ElevantDbContext>();

        services.AddScoped<ICredentialVerifier, IdentityCredentialVerifier>();
        services.AddScoped<ISessionSecurityVersionStore, EfSessionSecurityVersionStore>();
        services.AddScoped<IPasswordChangeStore, EfPasswordChangeStore>();
        services.AddScoped<IActorContextResolver, EfActorContextResolver>();
        services.AddScoped<IGovernanceStore, EfGovernanceStore>();
        services.AddScoped<IRampProfileStore, EfRampProfileStore>();
        services.AddScoped<IAirlinePortalReadStore, EfAirlinePortalReadStore>();
        services.AddScoped<IAffiliationStore, EfAffiliationStore>();
        services.AddScoped<ICommercialIntakeStore, EfCommercialIntakeStore>();
        services.AddScoped<ICommercialCatalogStore, EfCommercialCatalogStore>();
        services.AddScoped<CommercialPermissionGuard>();
        services.AddScoped<ICommercialCatalogManagementStore, EfCommercialCatalogManagementStore>();
        services.AddScoped<ICommercialAirlineManagementStore, EfCommercialAirlineManagementStore>();
        services.AddScoped<ICommercialMediaStore>(provider => new EfCommercialMediaStore(
            provider.GetRequiredService<ElevantDbContext>(),
            provider.GetRequiredService<CommercialPermissionGuard>(),
            provider.GetRequiredService<IActorContextResolver>(), configuration));
        services.AddScoped<ICommercialWorkflowStore, EfCommercialWorkflowStore>();
        services.AddScoped<ICommercialProvisioningStore, EfCommercialProvisioningStore>();
        services.AddScoped<IContractDraftStore, EfContractDraftStore>();
        services.AddScoped<IManagedContractReadStore, EfManagedContractReadStore>();
        services.AddScoped<IFinanceApprovedServicesReadStore, EfFinanceApprovedServicesReadStore>();
        services.AddScoped<IFinancePreinvoiceListStore, EfFinancePreinvoiceListStore>();
        services.AddScoped<IPreinvoiceDraftStore, EfPreinvoiceDraftStore>();
        services.AddScoped<IOccPlanningReadStore, EfOccPlanningReadStore>();
        services.AddScoped<IOccPlanningCommandStore, EfOccPlanningCommandStore>();
        services.AddScoped<IManualTurnaroundStore, EfManualTurnaroundStore>();
        services.AddScoped<IManualTurnaroundOptionsStore, EfManualTurnaroundOptionsStore>();
        services.AddScoped<IOccShiftProgrammingStore, EfOccShiftProgrammingStore>();
        services.AddScoped<IRampOperationsReadStore, EfRampOperationsReadStore>();
        services.AddScoped<IMobileDeviceCommandStore, EfMobileDeviceCommandStore>();
        services.AddScoped<IRampOperationsCommandStore, EfRampOperationsCommandStore>();
        services.AddScoped<IRampOperationChecklistReadStore, EfRampOperationChecklistReadStore>();
        services.AddScoped<IRampOperationChecklistCommandStore, EfRampOperationChecklistCommandStore>();
        services.AddScoped<IRampOperationServiceCommandStore, EfRampOperationServiceCommandStore>();
        services.AddScoped<IRampIncidentStore, EfRampIncidentStore>();
        services.AddScoped<IRampOperationSubmissionStore, EfRampOperationSubmissionStore>();
        services.AddScoped<IRampOperationCorrectionStore, EfRampOperationCorrectionStore>();
        services.AddScoped<IOccReviewStore, EfOccReviewStore>();
        services.AddScoped<IOperationalCommunicationStore, EfOperationalCommunicationStore>();
        services.AddScoped<IAccountChangeDispatcherStore, EfAccountChangeDispatcherStore>();
        services.AddScoped<IAccountChangeReadStore, EfAccountChangeReadStore>();

        services
            .AddHealthChecks()
            .AddDbContextCheck<ElevantDbContext>(
                name: "sql-server",
                failureStatus: HealthStatus.Unhealthy,
                tags: ["ready"]);

        return services;
    }
}
