FROM node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS build

WORKDIR /workspace/frontend/private-web
COPY frontend/private-web/package.json frontend/private-web/package-lock.json ./
COPY packages/api-client/package.json /workspace/packages/api-client/package.json
COPY packages/api-client/src/ /workspace/packages/api-client/src/
COPY packages/api-client/generated/ /workspace/packages/api-client/generated/
RUN npm ci --no-audit --no-fund

COPY frontend/private-web/app/ ./app/
COPY frontend/private-web/src/ ./src/
COPY frontend/private-web/public/ ./public/
COPY frontend/private-web/scripts/ ./scripts/
COPY frontend/private-web/next.config.mjs frontend/private-web/proxy.js frontend/private-web/tsconfig.json frontend/private-web/jsconfig.json frontend/private-web/postcss.config.js frontend/private-web/tailwind.config.js ./

ARG ELEVANT_DEPLOYMENT_ID
ARG NEXT_PUBLIC_ELEVANT_API_URL
ARG NEXT_PUBLIC_PROTOTYPE_API_URL
ARG NEXT_PUBLIC_HR_DEMO_MODE
ENV ELEVANT_DEPLOYMENT_ID=${ELEVANT_DEPLOYMENT_ID} \
    NEXT_PUBLIC_ELEVANT_API_URL=${NEXT_PUBLIC_ELEVANT_API_URL} \
    NEXT_PUBLIC_PROTOTYPE_API_URL=${NEXT_PUBLIC_PROTOTYPE_API_URL} \
    NEXT_PUBLIC_HR_DEMO_MODE=${NEXT_PUBLIC_HR_DEMO_MODE} \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS runtime

ARG VCS_REF=unknown
ARG OCI_CREATED=unknown
ARG OCI_SOURCE=unknown
ARG SOURCE_RUN_ID=unknown
ARG REQUIRED_API_MANIFEST=unknown
ARG OPENAPI_SHA256=unknown
ARG NEXT_PUBLIC_ELEVANT_API_URL=unknown
ARG NEXT_PUBLIC_PROTOTYPE_API_URL=unknown
ARG NEXT_PUBLIC_HR_DEMO_MODE=unknown

LABEL org.opencontainers.image.title="ELEVANT AVIAM Web" \
      org.opencontainers.image.description="Tailnet-only Development preview for internal AVIAM workflows" \
      org.opencontainers.image.revision=${VCS_REF} \
      org.opencontainers.image.created=${OCI_CREATED} \
      org.opencontainers.image.source=${OCI_SOURCE} \
      io.elevant.application="aviam-web" \
      io.elevant.environment="Development" \
      io.elevant.source.run-id=${SOURCE_RUN_ID} \
      io.elevant.api.required-manifest=${REQUIRED_API_MANIFEST} \
      io.elevant.openapi.sha256=${OPENAPI_SHA256} \
      io.elevant.web.api-origin=${NEXT_PUBLIC_ELEVANT_API_URL} \
      io.elevant.web.hr-demo-mode=${NEXT_PUBLIC_HR_DEMO_MODE}

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=8080 \
    HOME=/tmp \
    NEXT_PUBLIC_ELEVANT_API_URL=${NEXT_PUBLIC_ELEVANT_API_URL} \
    NEXT_PUBLIC_PROTOTYPE_API_URL=${NEXT_PUBLIC_PROTOTYPE_API_URL} \
    NEXT_PUBLIC_HR_DEMO_MODE=${NEXT_PUBLIC_HR_DEMO_MODE}

WORKDIR /app/frontend/private-web
COPY --from=build --chown=101:101 /workspace/frontend/private-web/.next/standalone /app/
COPY --from=build --chown=101:101 /workspace/frontend/private-web/.next/static ./.next/static
COPY --from=build --chown=101:101 /workspace/frontend/private-web/public ./public
COPY --from=build --chown=101:101 /workspace/frontend/private-web/scripts/healthcheck.mjs /app/healthcheck.mjs
RUN mkdir -p .next/cache && chown 101:101 .next/cache

USER 101:101
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=4 \
  CMD ["node", "/app/healthcheck.mjs"]
CMD ["node", "server.js"]
