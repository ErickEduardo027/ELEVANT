using Elevant.Application.Identity.CreateSession;
using Elevant.Application.Commercial;
using Elevant.Application.Finance;
using Elevant.Application.Identity.GetCurrentSession;
using Elevant.Application.Integration.RegisterMobileDevice;
using Elevant.Application.Operations.AssignOccOperation;
using Elevant.Application.Operations.CreateManualTurnaround;
using Elevant.Application.Operations.GetOccPlanningOptions;
using Elevant.Application.Operations.GetManualTurnaroundOptions;
using Elevant.Application.Operations.GetOccAgentShift;
using Elevant.Application.Operations.GetOccPlanningSnapshot;
using Elevant.Application.Operations.ProgramOccShift;
using Elevant.Application.Operations.GetRampAssignedOperations;
using Elevant.Application.Operations.GetRampOperationChecklist;
using Elevant.Application.Operations;
using Elevant.Application.Operations.StartRampOperation;
using Elevant.Application.Operations.SubmitRampOperationChecklist;
using Elevant.Application.Operations.TransitionRampOperationService;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.Application;

/// <summary>Registers application use cases and application-level technical services.</summary>
public static class DependencyInjection
{
    /// <summary>Adds the application use cases and application-level technical services.</summary>
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddSingleton(TimeProvider.System);
        services.AddScoped<Elevant.Application.Integration.FlightFeedSynchronizer>();
        services.AddScoped<CreateSessionHandler>();
        services.AddScoped<Elevant.Application.Identity.RefreshSession.RefreshSessionHandler>();
        services.AddScoped<Elevant.Application.Identity.ChangePassword.ChangePasswordHandler>();
        services.AddScoped<GetAirlinePortalBootstrapHandler>();
        services.AddScoped<GetAirlinePortalStandingHandler>();
        services.AddScoped<GetAirlineContractsHandler>();
        services.AddScoped<GetAirlineOperationsHandler>();
        services.AddScoped<GetAirlineOperationHandler>();
        services.AddScoped<GetAirlineOperationalRequestsHandler>();
        services.AddScoped<SubmitCommercialRequestHandler>();
        services.AddScoped<GetNonFiscalInvoiceHandler>();
        services.AddScoped<GetNonFiscalPaymentHandler>();
        services.AddScoped<GetAirlineInvoiceStatementHandler>();
        services.AddScoped<GetFinancialDocumentHandler>();
        services.AddScoped<GetCurrentSessionHandler>();
        services.AddScoped<GetOccPlanningSnapshotHandler>();
        services.AddScoped<GetOccAircraftTrafficHandler>();
        services.AddScoped<GetOccPlanningOptionsHandler>();
        services.AddScoped<AssignOccOperationHandler>();
        services.AddScoped<CreateManualTurnaroundHandler>();
        services.AddScoped<GetManualTurnaroundOptionsHandler>();
        services.AddScoped<ProgramOccShiftHandler>();
        services.AddScoped<GetOccAgentShiftHandler>();
        services.AddScoped<GetRampAssignedOperationsHandler>();
        services.AddScoped<RegisterMobileDeviceHandler>();
        services.AddScoped<StartRampOperationHandler>();
        services.AddScoped<GetRampOperationChecklistHandler>();
        services.AddScoped<SubmitRampOperationChecklistHandler>();
        services.AddScoped<TransitionRampOperationServiceHandler>();
        services.AddScoped<RampExecutionHandler>();
        services.AddScoped<OperationDocumentHandler>();
        services.AddScoped<CharterHandler>();
        services.AddScoped<Elevant.Application.Finance.IssueInvoiceHandler>();
        services.AddScoped<Elevant.Application.Finance.CloseOperationsWithoutChargeHandler>();
        services.AddScoped<Elevant.Application.Finance.GetFinancePendingOperationsHandler>();
        services.AddScoped<Elevant.Application.Finance.PayInvoiceByCardHandler>();
        services.AddScoped<Elevant.Application.Finance.CardPaymentAvailabilityHandler>();
        // 4-N05: without Infrastructure (tools, tests) there is no card gateway; AddInfrastructure registers the real one.
        Microsoft.Extensions.DependencyInjection.Extensions.ServiceCollectionDescriptorExtensions.TryAddSingleton(services,
            Elevant.Application.Finance.CardPaymentAvailability.Disabled);
        services.AddScoped<Elevant.Application.Finance.FinanceCloseRulesHandler>();
        services.AddScoped<AirlineServiceOrderHandler>();
        services.AddScoped<RampServiceChargesHandler>();
        services.AddScoped<RampIncidentHandler>();
        services.AddScoped<RampOperationSubmissionHandler>();
        services.AddScoped<RampOperationCorrectionHandler>();
        services.AddScoped<OccReviewHandler>();
        services.AddScoped<OperationalCommunicationHandler>();
        services.AddSingleton<OperationalPresenceRegistry>();
        services.AddScoped<OperationalPresenceHandler>();
        // ADR-0041: without Infrastructure (tools, tests) there is no DemoFlights:Mode and demo flights stay off.
        Microsoft.Extensions.DependencyInjection.Extensions.ServiceCollectionDescriptorExtensions.TryAddSingleton(services,
            Elevant.Application.Integration.DemoFlights.DemoFlightAvailability.Disabled);
        services.AddScoped<Elevant.Application.Integration.DemoFlights.DemoFlightHandler>();
        // ADR-0041: «Cargar posiciones de Punta Cana», under the same DemoFlights:Mode.
        services.AddScoped<Elevant.Application.Operations.DemoStation.DemoStationHandler>();
        // ADR-0042: without Infrastructure (tools, tests) there is no AirTraffic section: no network is ever read.
        Microsoft.Extensions.DependencyInjection.Extensions.ServiceCollectionDescriptorExtensions.TryAddSingleton<
            Elevant.Application.Abstractions.Operations.IAirTrafficProvider,
            Elevant.Application.Abstractions.Operations.UnconfiguredAirTrafficProvider>(services);
        Microsoft.Extensions.DependencyInjection.Extensions.ServiceCollectionDescriptorExtensions.TryAddSingleton(services,
            Elevant.Application.Operations.AirPicture.AirTrafficSettings.Disabled);
        // ADR-0042: one air picture in memory for every screen, read by AirTrafficPollWorker only while someone watches.
        services.AddSingleton<Elevant.Application.Operations.AirPicture.AirPictureService>();
        return services;
    }
}
