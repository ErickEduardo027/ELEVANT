# syntax=docker/dockerfile:1

ARG DOTNET_VERSION=10.0

FROM mcr.microsoft.com/dotnet/sdk:${DOTNET_VERSION} AS restore
WORKDIR /src

COPY ["backend/Elevant.sln", "./"]
COPY ["backend/Directory.Build.props", "backend/Directory.Packages.props", "backend/global.json", "backend/NuGet.config", "./"]
COPY ["backend/src/Elevant.Api/Elevant.Api.csproj", "src/Elevant.Api/"]
COPY ["backend/src/Elevant.Api/packages.lock.json", "src/Elevant.Api/"]
COPY ["backend/src/Elevant.Application/Elevant.Application.csproj", "src/Elevant.Application/"]
COPY ["backend/src/Elevant.Application/packages.lock.json", "src/Elevant.Application/"]
COPY ["backend/src/Elevant.Contracts/Elevant.Contracts.csproj", "src/Elevant.Contracts/"]
COPY ["backend/src/Elevant.Contracts/packages.lock.json", "src/Elevant.Contracts/"]
COPY ["backend/src/Elevant.DatabaseTool/Elevant.DatabaseTool.csproj", "src/Elevant.DatabaseTool/"]
COPY ["backend/src/Elevant.DatabaseTool/packages.lock.json", "src/Elevant.DatabaseTool/"]
COPY ["backend/src/Elevant.Domain/Elevant.Domain.csproj", "src/Elevant.Domain/"]
COPY ["backend/src/Elevant.Domain/packages.lock.json", "src/Elevant.Domain/"]
COPY ["backend/src/Elevant.Infrastructure/Elevant.Infrastructure.csproj", "src/Elevant.Infrastructure/"]
COPY ["backend/src/Elevant.Infrastructure/packages.lock.json", "src/Elevant.Infrastructure/"]
COPY ["backend/tests/Elevant.ArchitectureTests/Elevant.ArchitectureTests.csproj", "tests/Elevant.ArchitectureTests/"]
COPY ["backend/tests/Elevant.ArchitectureTests/packages.lock.json", "tests/Elevant.ArchitectureTests/"]
COPY ["backend/tests/Elevant.IntegrationTests/Elevant.IntegrationTests.csproj", "tests/Elevant.IntegrationTests/"]
COPY ["backend/tests/Elevant.IntegrationTests/packages.lock.json", "tests/Elevant.IntegrationTests/"]
COPY ["backend/tests/Elevant.UnitTests/Elevant.UnitTests.csproj", "tests/Elevant.UnitTests/"]
COPY ["backend/tests/Elevant.UnitTests/packages.lock.json", "tests/Elevant.UnitTests/"]

RUN dotnet restore "Elevant.sln" --locked-mode

FROM restore AS publish
COPY backend/src/ src/
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
