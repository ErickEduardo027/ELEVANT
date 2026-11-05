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
using Microsoft.Extensions.DependencyInjection.Extensions;
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

        // Portal account emails (ADR-0022): links point at the public portal origin.
        services.TryAddSingleton(configuration.GetSection(Elevant.Application.Identity.AccountEmails.AccountEmailOptions.SectionName)
            .Get<Elevant.Application.Identity.AccountEmails.AccountEmailOptions>() ?? new());

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
        services.AddScoped<IRefreshTokenStore, EfRefreshTokenStore>();
        services.AddScoped<IAccountEmailStore, EfAccountEmailStore>();
        services.AddScoped<Elevant.Application.Abstractions.Messaging.IEmailOutboxStore, EfEmailOutboxStore>();
        services.AddScoped<IPasswordChangeStore, EfPasswordChangeStore>();
        services.AddScoped<IActorContextResolver, EfActorContextResolver>();
        services.AddScoped<IGovernanceStore, EfGovernanceStore>();
        services.AddScoped<EfDepartmentGovernanceStore>();
        services.AddScoped<IDepartmentGovernanceStore>(provider => provider.GetRequiredService<EfDepartmentGovernanceStore>());
        services.AddScoped<IEmployeeGovernanceStore>(provider => provider.GetRequiredService<EfDepartmentGovernanceStore>());
        services.AddScoped<IDepartmentNotificationStore, EfDepartmentNotificationStore>();
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
        services.AddScoped<IOccReportStore, EfOccReportStore>();
        services.AddScoped<IOccPositionStore, EfOccPositionStore>();
        services.AddScoped<IPositionCoverageStore, EfPositionCoverageStore>();
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
        services.AddScoped<IWorkforceReadinessStore, EfWorkforceReadinessStore>();
        services.AddScoped<Elevant.Application.Abstractions.Operations.IOccReadyContractsStore, EfOccReadyContractsStore>();
        services.AddScoped<Elevant.Application.Abstractions.Integration.IFlightFeedSyncStore, Elevant.Persistence.Integration.EfFlightFeedSyncStore>();
        services.AddScoped<Elevant.Application.Abstractions.Operations.IOccFlightFeedStore, Elevant.Persistence.Integration.EfOccFlightFeedStore>();
        // Defaults when Infrastructure is not composed (tests, database tool); its registrations win.
        Microsoft.Extensions.DependencyInjection.Extensions.ServiceCollectionDescriptorExtensions.TryAddSingleton(services, Elevant.Application.Integration.FlightFeedBudget.Default);
        Microsoft.Extensions.DependencyInjection.Extensions.ServiceCollectionDescriptorExtensions.TryAddSingleton<Elevant.Application.Abstractions.Integrations.IAirportFlightFeed, Elevant.Application.Abstractions.Integrations.UnconfiguredAirportFlightFeed>(services);
        services.AddSingleton<Elevant.Application.Abstractions.Commercial.IAirlineRegistrySource, Elevant.Persistence.Integration.ObservedAirlineRegistrySource>();
        services.AddScoped<EfContractDocumentStore>();
        services.AddScoped<IContractDocumentStore>(provider => provider.GetRequiredService<EfContractDocumentStore>());
        // The PDF renderer lives in Infrastructure; a factory keeps hosts without it (tools, tests) valid.
        services.AddScoped<Elevant.Application.Abstractions.Messaging.IEmailAttachmentResolver>(provider =>
            new EfContractAttachmentResolver(provider.GetRequiredService<EfContractDocumentStore>(),
                provider.GetRequiredService<Elevant.Application.Abstractions.Commercial.IContractPdfRenderer>()));
        services.AddScoped<IAirlinePermitStore, EfAirlinePermitStore>();
        services.AddScoped<IContractLifecycleStore, EfContractLifecycleStore>();
        services.AddScoped<IFinanceApprovedServicesReadStore, EfFinanceApprovedServicesReadStore>();
        services.AddScoped<IFinanceTariffReadStore, EfFinanceTariffReadStore>();
        services.AddScoped<IFinanceTariffBookStore, EfFinanceTariffBookStore>();
        services.AddScoped<IFinancePackageStore, EfFinancePackageStore>();
        services.AddScoped<IFinanceTaxStore, FinanceTaxStore>();
        // The persistence-only host has no fiscal transport. Resolve the optional sidecar ports
        // when the fiscal feature is used, as with the private financial document renderer below.
        services.AddScoped<IFinanceFiscalStore>(provider => new FinanceFiscalStore(
            provider.GetRequiredService<ElevantDbContext>(), provider.GetRequiredService<IActorContextResolver>(),
            provider.GetRequiredService<TimeProvider>(), provider.GetRequiredService<Elevant.Application.Finance.FinanceFiscalOptions>(),
            provider.GetRequiredService<IFiscalArtifactArchive>(), provider.GetRequiredService<IFiscalProvider>(),
            provider.GetRequiredService<IFiscalCallbackAuthenticator>(), provider.GetRequiredService<IFiscalArtifactBuilder>()));
        services.TryAddScoped<IFiscalArtifactArchive, FinanceFiscalPrivateArchive>();
        services.AddScoped<IFinancePayablesStore, FinancePayablesStore>();
        services.AddScoped<IFinanceTreasuryStore, FinanceTreasuryStore>();
        services.AddScoped<IFinancePreinvoiceReviewStore, EfFinancePreinvoiceReviewStore>();
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
        services.AddScoped<Elevant.Application.Operations.IRampExecutionCommandStore, EfRampExecutionCommandStore>();
        services.AddScoped<Elevant.Application.Operations.IOperationDocumentStore, EfOperationDocumentStore>();
        services.AddScoped<Elevant.Application.Operations.ICharterStore, EfCharterStore>();
        services.AddScoped<Elevant.Application.Finance.IFinanceCloseRulesStore, Elevant.Persistence.Finance.EfFinanceCloseRulesStore>();
        services.AddScoped<IOperationalEvidenceStore>(_ => new S3OperationalEvidenceStore(configuration));
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
