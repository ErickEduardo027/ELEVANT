# syntax=docker/dockerfile:1

ARG DOTNET_SDK_IMAGE=mcr.microsoft.com/dotnet/sdk:10.0@sha256:0e53453ccfc8ff2d51319fe80c678971c6d0f8008dff3565fa88e15840b69854
ARG DOTNET_ASPNET_IMAGE=mcr.microsoft.com/dotnet/aspnet:10.0@sha256:1dcd9841b075d1d1013caa170b86ae58b8a8a563de9a3e319fd46a45e7ecc130
ARG VCS_REF=unknown
ARG OCI_CREATED=unknown
ARG OCI_SOURCE=https://github.com/ErickEduardo027/ELEVANT

FROM ${DOTNET_SDK_IMAGE} AS restore
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

FROM ${DOTNET_ASPNET_IMAGE} AS final
ARG VCS_REF
ARG OCI_CREATED
ARG OCI_SOURCE
LABEL org.opencontainers.image.title="Elevant API" \
      org.opencontainers.image.description="Shared Elevant HTTP API" \
      org.opencontainers.image.revision=${VCS_REF} \
      org.opencontainers.image.created=${OCI_CREATED} \
      org.opencontainers.image.source=${OCI_SOURCE} \
      org.elevant.api.environment="Development"
WORKDIR /app
ENV ASPNETCORE_HTTP_PORTS=8080 \
    DOTNET_EnableDiagnostics=0
EXPOSE 8080
COPY --from=publish --chown=$APP_UID:$APP_UID /app/publish .
USER $APP_UID
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=4 \
    CMD ["dotnet", "Elevant.Api.dll", "--health-probe"]
ENTRYPOINT ["dotnet", "Elevant.Api.dll"]
