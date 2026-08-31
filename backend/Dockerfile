# syntax=docker/dockerfile:1

ARG DOTNET_VERSION=10.0

FROM mcr.microsoft.com/dotnet/sdk:${DOTNET_VERSION} AS restore
WORKDIR /src

COPY ["Directory.Build.props", "Directory.Packages.props", "global.json", "NuGet.config", "dotnet-tools.json", "./"]
COPY ["backend/Elevant.sln", "backend/Elevant.sln"]
COPY ["backend/Elevant.Api/Elevant.Api.csproj", "backend/Elevant.Api/"]
COPY ["backend/Elevant.Api/packages.lock.json", "backend/Elevant.Api/"]
COPY ["backend/Elevant.Application/Elevant.Application.csproj", "backend/Elevant.Application/"]
COPY ["backend/Elevant.Application/packages.lock.json", "backend/Elevant.Application/"]
COPY ["backend/Elevant.Contracts/Elevant.Contracts.csproj", "backend/Elevant.Contracts/"]
COPY ["backend/Elevant.Contracts/packages.lock.json", "backend/Elevant.Contracts/"]
COPY ["backend/Elevant.Domain/Elevant.Domain.csproj", "backend/Elevant.Domain/"]
COPY ["backend/Elevant.Domain/packages.lock.json", "backend/Elevant.Domain/"]
COPY ["backend/Elevant.Infrastructure/Elevant.Infrastructure.csproj", "backend/Elevant.Infrastructure/"]
COPY ["backend/Elevant.Infrastructure/packages.lock.json", "backend/Elevant.Infrastructure/"]
COPY ["backend/tests/Elevant.ArchitectureTests/Elevant.ArchitectureTests.csproj", "backend/tests/Elevant.ArchitectureTests/"]
COPY ["backend/tests/Elevant.ArchitectureTests/packages.lock.json", "backend/tests/Elevant.ArchitectureTests/"]
COPY ["backend/tests/Elevant.IntegrationTests/Elevant.IntegrationTests.csproj", "backend/tests/Elevant.IntegrationTests/"]
COPY ["backend/tests/Elevant.IntegrationTests/packages.lock.json", "backend/tests/Elevant.IntegrationTests/"]
COPY ["backend/tests/Elevant.UnitTests/Elevant.UnitTests.csproj", "backend/tests/Elevant.UnitTests/"]
COPY ["backend/tests/Elevant.UnitTests/packages.lock.json", "backend/tests/Elevant.UnitTests/"]
COPY ["database/DevelopmentDB/Elevant.Persistence/Elevant.Persistence.csproj", "database/DevelopmentDB/Elevant.Persistence/"]
COPY ["database/DevelopmentDB/Elevant.Persistence/packages.lock.json", "database/DevelopmentDB/Elevant.Persistence/"]
COPY ["database/DevelopmentDB/Elevant.DatabaseTool/Elevant.DatabaseTool.csproj", "database/DevelopmentDB/Elevant.DatabaseTool/"]
COPY ["database/DevelopmentDB/Elevant.DatabaseTool/packages.lock.json", "database/DevelopmentDB/Elevant.DatabaseTool/"]

RUN dotnet restore "backend/Elevant.sln" --locked-mode

FROM restore AS publish
COPY backend/Elevant.Api/ backend/Elevant.Api/
COPY backend/Elevant.Application/ backend/Elevant.Application/
COPY backend/Elevant.Contracts/ backend/Elevant.Contracts/
COPY backend/Elevant.Domain/ backend/Elevant.Domain/
COPY backend/Elevant.Infrastructure/ backend/Elevant.Infrastructure/
COPY database/DevelopmentDB/Elevant.Persistence/ database/DevelopmentDB/Elevant.Persistence/
RUN dotnet publish "backend/Elevant.Api/Elevant.Api.csproj" \
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
