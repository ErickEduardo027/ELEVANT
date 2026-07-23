using Microsoft.AspNetCore.SignalR;

namespace Elevant.Api.Hubs;

/// <summary>Connection point reserved for server-to-client operational updates.</summary>
public sealed class OperationsHub : Hub;
