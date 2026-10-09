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
        services.AddScoped<IDepartmentGovernanceStore, EfDepartmentGovernanceStore>();
        services.AddScoped<IDepartmentGovernanceStore, EfDepartmentGovernanceStore>();
        services.AddScoped<IRampProfileStore, EfRampProfileStore>();
        services.AddScoped<IRampMobileAccessRequestStore, EfRampMobileAccessRequestStore>();
        services.AddScoped<IHumanResourcesQualificationReadStore, EfHumanResourcesQualificationReadStore>();
        services.AddScoped<IHumanResourcesQualificationWriteStore, EfHumanResourcesQualificationWriteStore>();
        services.AddScoped<IHumanResourcesPermitReadStore, EfHumanResourcesPermitReadStore>();
        services.AddScoped<IHumanResourcesPermitWriteStore, EfHumanResourcesPermitWriteStore>();
        services.AddScoped<IHumanResourcesShiftReadStore, EfHumanResourcesShiftReadStore>();
        services.AddScoped<IHumanResourcesScheduleWarningStore, EfHumanResourcesScheduleWarningStore>();
        services.AddScoped<IHumanResourcesShiftWriteStore, EfHumanResourcesShiftWriteStore>();
        services.AddScoped<IHumanResourcesAvailabilityReadStore, EfHumanResourcesAvailabilityReadStore>();
        services.AddScoped<IHumanResourcesAvailabilityWriteStore, EfHumanResourcesAvailabilityWriteStore>();
        services.AddScoped<IHumanResourcesReportStore, EfHumanResourcesReportStore>();
        services.AddScoped<IAirlinePortalReadStore, EfAirlinePortalReadStore>();
        services.AddScoped<IAirlinePreinvoiceAcceptanceStore, EfAirlinePreinvoiceAcceptanceStore>();
        services.AddScoped<IAirlinePreinvoiceDisputeStore, EfAirlinePreinvoiceDisputeStore>();
        services.AddScoped<IAffiliationStore, EfAffiliationStore>();
        services.AddScoped<ICommercialIntakeStore, EfCommercialIntakeStore>();
        services.AddScoped<ICommercialCatalogStore, EfCommercialCatalogStore>();
        services.AddScoped<CommercialPermissionGuard>();
        services.AddScoped<ICommercialCatalogManagementStore, EfCommercialCatalogManagementStore>();
        services.AddScoped<IServiceClosureStore, EfServiceClosureStore>();
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
        services.AddScoped<IFinanceTariffReadStore, EfFinanceTariffReadStore>();
        services.AddScoped<IFinanceTariffBookStore, EfFinanceTariffBookStore>();
        services.AddScoped<IPreinvoiceLineEditStore, EfPreinvoiceLineEditStore>();
        services.AddScoped<IFinanceInvoiceLedgerStore, EfFinanceInvoiceLedgerStore>();
        services.AddScoped<IFinanceReportStore, EfFinanceReportStore>();
        services.AddScoped<IFinanceReportExportAudit, EfFinanceReportExportAudit>();
        services.AddScoped<IFinanceReconciliationReadStore, EfFinanceReconciliationReadStore>();
        services.AddScoped<IFinancePreinvoiceListStore, EfFinancePreinvoiceListStore>();
        services.AddScoped<IPreinvoiceDraftStore, EfPreinvoiceDraftStore>();
        services.AddScoped<IPreinvoiceSubmissionStore, EfPreinvoiceSubmissionStore>();
        services.AddScoped<IPreinvoiceDisputeResolutionStore, EfPreinvoiceDisputeResolutionStore>();
        services.AddScoped<IFinanceInvoiceIssueStore, EfFinanceInvoiceIssueStore>();
        services.AddScoped<INonFiscalInvoiceReadStore, EfNonFiscalInvoiceReadStore>();
        services.AddScoped<INonFiscalPaymentStore, EfNonFiscalPaymentStore>();
        services.AddScoped<INonFiscalPaymentReadStore, EfNonFiscalPaymentReadStore>();
        services.AddScoped<IPrivateFinancialObjectStore>(
            _ => new S3PrivateFinancialObjectStore(configuration));
        services.AddScoped<IFinancialDocumentStore>(provider => new EfFinancialDocumentStore(
            provider.GetRequiredService<ElevantDbContext>(),
            provider.GetRequiredService<IPrivateFinancialObjectStore>(),
            provider.GetRequiredService<IFinancialDocumentPdfRenderer>(),
            provider.GetRequiredService<TimeProvider>()));
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
        services.AddScoped<IRampServiceChargeStore, EfRampServiceChargeStore>();
        services.AddScoped<IRampIncidentStore, EfRampIncidentStore>();
        services.AddScoped<IAttendanceDraftStore, EfAttendanceDraftStore>();
        services.AddScoped<IAttendanceValidationStore, EfAttendanceValidationStore>();
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
