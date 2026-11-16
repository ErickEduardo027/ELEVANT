ARG NODE_IMAGE=node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf

FROM ${NODE_IMAGE} AS build
WORKDIR /workspace

ARG VCS_REF
ARG OCI_CREATED
ARG OCI_SOURCE
ARG REQUIRED_API_MANIFEST
ARG OPENAPI_SHA256
ARG SOURCE_RUN_ID
ARG ELEVANT_DEPLOYMENT_ID
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_ELEVANT_API_URL
ARG NEXT_PUBLIC_PROTOTYPE_API_URL
ARG NEXT_PUBLIC_DEMO_FORM_MODE=preview

ENV NEXT_TELEMETRY_DISABLED=1 \
    VCS_REF=${VCS_REF} \
    OCI_CREATED=${OCI_CREATED} \
    OCI_SOURCE=${OCI_SOURCE} \
    REQUIRED_API_MANIFEST=${REQUIRED_API_MANIFEST} \
    OPENAPI_SHA256=${OPENAPI_SHA256} \
    SOURCE_RUN_ID=${SOURCE_RUN_ID} \
    ELEVANT_DEPLOYMENT_ID=${ELEVANT_DEPLOYMENT_ID} \
    NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    NEXT_PUBLIC_ELEVANT_API_URL=${NEXT_PUBLIC_ELEVANT_API_URL} \
    NEXT_PUBLIC_PROTOTYPE_API_URL=${NEXT_PUBLIC_PROTOTYPE_API_URL} \
    NEXT_PUBLIC_DEMO_FORM_MODE=${NEXT_PUBLIC_DEMO_FORM_MODE}

COPY frontend/public-web/package.json frontend/public-web/package-lock.json frontend/public-web/
COPY packages/api-client/package.json packages/api-client/
RUN cd frontend/public-web && npm ci --no-audit --no-fund

COPY frontend/public-web/ frontend/public-web/
COPY packages/api-client/ packages/api-client/
RUN cd frontend/public-web \
    && node scripts/validate-development-env.mjs \
    && npm run build

FROM ${NODE_IMAGE} AS runtime
ARG VCS_REF
ARG OCI_CREATED
ARG OCI_SOURCE
ARG REQUIRED_API_MANIFEST
ARG OPENAPI_SHA256
ARG SOURCE_RUN_ID
ARG NEXT_PUBLIC_ELEVANT_API_URL

LABEL org.opencontainers.image.title="ELEVANT Public Web" \
      org.opencontainers.image.description="ELEVANT customer-facing Development preview" \
      org.opencontainers.image.revision=${VCS_REF} \
      org.opencontainers.image.created=${OCI_CREATED} \
      org.opencontainers.image.source=${OCI_SOURCE} \
      io.elevant.application="public-web" \
      io.elevant.environment="Development" \
      io.elevant.source.run-id=${SOURCE_RUN_ID} \
      io.elevant.api.required-manifest=${REQUIRED_API_MANIFEST} \
      io.elevant.openapi.sha256=${OPENAPI_SHA256} \
      io.elevant.web.api-origin=${NEXT_PUBLIC_ELEVANT_API_URL}

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

WORKDIR /app/frontend/public-web
COPY --from=build --chown=node:node /workspace/frontend/public-web/.next/standalone /app/
COPY --from=build --chown=node:node /workspace/frontend/public-web/public ./public
COPY --from=build --chown=node:node /workspace/frontend/public-web/.next/static ./.next/static
COPY --from=build --chown=node:node /workspace/frontend/public-web/scripts/healthcheck.mjs /app/healthcheck.mjs
RUN mkdir -p .next/cache && chown node:node .next/cache

USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=4 \
  CMD ["node", "/app/healthcheck.mjs"]
CMD ["node", "server.js"]
