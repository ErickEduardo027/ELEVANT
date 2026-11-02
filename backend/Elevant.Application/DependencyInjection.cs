using Elevant.Application.Identity.CreateSession;
using Elevant.Application.Commercial;
using Elevant.Application.Finance;
using Elevant.Application.Identity.GetCurrentSession;
using Elevant.Application.Integration.RegisterMobileDevice;
using Elevant.Application.Operations.AssignOccOperation;
using Elevant.Application.Operations.CreateManualTurnaround;
using Elevant.Application.Operations.GetOccPlanningOptions;
using Elevant.Application.Operations.GetManualTurnaroundOptions;
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
        services.AddScoped<CreateSessionHandler>();
        services.AddScoped<Elevant.Application.Identity.ChangePassword.ChangePasswordHandler>();
        services.AddScoped<GetAirlinePortalBootstrapHandler>();
        services.AddScoped<GetAirlineContractsHandler>();
        services.AddScoped<GetAirlineOperationsHandler>();
        services.AddScoped<GetAirlineOperationHandler>();
        services.AddScoped<GetAirlineOperationalRequestsHandler>();
        services.AddScoped<GetAirlinePreinvoicesHandler>();
        services.AddScoped<AcceptAirlinePreinvoiceHandler>();
        services.AddScoped<DisputeAirlinePreinvoiceHandler>();
        services.AddScoped<SubmitCommercialRequestHandler>();
        services.AddScoped<GetFinanceApprovedServicesHandler>();
        services.AddScoped<CreatePreinvoiceDraftHandler>();
        services.AddScoped<SubmitPreinvoiceHandler>();
        services.AddScoped<ResolvePreinvoiceDisputeHandler>();
        services.AddScoped<IssueFinanceInvoiceHandler>();
        services.AddScoped<GetNonFiscalInvoiceHandler>();
        services.AddScoped<RecordNonFiscalPaymentHandler>();
        services.AddScoped<GetNonFiscalPaymentHandler>();
        services.AddScoped<GetAirlineInvoiceStatementHandler>();
        services.AddScoped<GetFinancialDocumentHandler>();
        services.AddScoped<GetPreinvoiceDraftHandler>();
        services.AddScoped<GetCurrentSessionHandler>();
        services.AddScoped<GetOccPlanningSnapshotHandler>();
        services.AddScoped<GetOccAircraftTrafficHandler>();
        services.AddScoped<GetOccPlanningOptionsHandler>();
        services.AddScoped<AssignOccOperationHandler>();
        services.AddScoped<CreateManualTurnaroundHandler>();
        services.AddScoped<GetManualTurnaroundOptionsHandler>();
        services.AddScoped<ProgramOccShiftHandler>();
        services.AddScoped<GetRampAssignedOperationsHandler>();
        services.AddScoped<RegisterMobileDeviceHandler>();
        services.AddScoped<StartRampOperationHandler>();
        services.AddScoped<GetRampOperationChecklistHandler>();
        services.AddScoped<SubmitRampOperationChecklistHandler>();
        services.AddScoped<TransitionRampOperationServiceHandler>();
        services.AddScoped<RampServiceChargesHandler>();
        services.AddScoped<RampIncidentHandler>();
        services.AddScoped<RampOperationSubmissionHandler>();
        services.AddScoped<RampOperationCorrectionHandler>();
        services.AddScoped<OccReviewHandler>();
        services.AddScoped<OperationalCommunicationHandler>();
        services.AddSingleton<OperationalPresenceRegistry>();
        services.AddScoped<OperationalPresenceHandler>();
        return services;
    }
}
