# syntax=docker/dockerfile:1

ARG DOTNET_VERSION=10.0

FROM mcr.microsoft.com/dotnet/sdk:${DOTNET_VERSION} AS restore
WORKDIR /src

COPY ["Elevant.sln", "./"]
COPY ["Directory.Build.props", "Directory.Packages.props", "global.json", "NuGet.config", "./"]
COPY ["src/Elevant.Api/Elevant.Api.csproj", "src/Elevant.Api/"]
COPY ["src/Elevant.Api/packages.lock.json", "src/Elevant.Api/"]
COPY ["src/Elevant.Application/Elevant.Application.csproj", "src/Elevant.Application/"]
COPY ["src/Elevant.Application/packages.lock.json", "src/Elevant.Application/"]
COPY ["src/Elevant.Contracts/Elevant.Contracts.csproj", "src/Elevant.Contracts/"]
COPY ["src/Elevant.Contracts/packages.lock.json", "src/Elevant.Contracts/"]
COPY ["src/Elevant.Domain/Elevant.Domain.csproj", "src/Elevant.Domain/"]
COPY ["src/Elevant.Domain/packages.lock.json", "src/Elevant.Domain/"]
COPY ["src/Elevant.Infrastructure/Elevant.Infrastructure.csproj", "src/Elevant.Infrastructure/"]
COPY ["src/Elevant.Infrastructure/packages.lock.json", "src/Elevant.Infrastructure/"]
COPY ["tests/Elevant.ArchitectureTests/Elevant.ArchitectureTests.csproj", "tests/Elevant.ArchitectureTests/"]
COPY ["tests/Elevant.ArchitectureTests/packages.lock.json", "tests/Elevant.ArchitectureTests/"]
COPY ["tests/Elevant.IntegrationTests/Elevant.IntegrationTests.csproj", "tests/Elevant.IntegrationTests/"]
COPY ["tests/Elevant.IntegrationTests/packages.lock.json", "tests/Elevant.IntegrationTests/"]
COPY ["tests/Elevant.UnitTests/Elevant.UnitTests.csproj", "tests/Elevant.UnitTests/"]
COPY ["tests/Elevant.UnitTests/packages.lock.json", "tests/Elevant.UnitTests/"]

RUN dotnet restore "Elevant.sln" --locked-mode

FROM restore AS publish
COPY src/ src/
RUN dotnet publish "src/Elevant.Api/Elevant.Api.csproj" \
    --configuration Release \
    --no-restore \
    --output /app/publish \
    /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:${DOTNET_VERSION} AS final
WORKDIR /app
ENV ASPNETCORE_HTTP_PORTS=8080 \
    DOTNET_EnableDiagnostics=0
EXPOSE 8080
COPY --from=publish /app/publish .
USER $APP_UID
ENTRYPOINT ["dotnet", "Elevant.Api.dll"]
