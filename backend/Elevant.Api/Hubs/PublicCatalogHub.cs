using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace Elevant.Api.Hubs;

/// <summary>Broadcast-only anonymous channel for published commercial catalog changes.</summary>
[AllowAnonymous]
public sealed class PublicCatalogHub : Hub;
