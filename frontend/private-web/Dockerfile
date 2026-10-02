FROM node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS build

WORKDIR /workspace/frontend/private-web

COPY frontend/private-web/package.json frontend/private-web/package-lock.json ./
COPY packages/api-client/package.json /workspace/packages/api-client/package.json
RUN npm ci --no-audit --no-fund

COPY packages/api-client/src/ /workspace/packages/api-client/src/
COPY packages/api-client/generated/ /workspace/packages/api-client/generated/
COPY frontend/private-web/ ./

ARG VITE_ELEVANT_API_URL
ARG VITE_PROTOTYPE_API_URL
ARG VITE_HR_DEMO_MODE
ENV VITE_ELEVANT_API_URL=${VITE_ELEVANT_API_URL} \
    VITE_PROTOTYPE_API_URL=${VITE_PROTOTYPE_API_URL} \
    VITE_HR_DEMO_MODE=${VITE_HR_DEMO_MODE}

RUN npm run build

FROM ghcr.io/nginx/nginx-unprivileged:1.30.4-alpine3.24@sha256:9b87ad3dd9f431c733f19dfb278c7eb3dba9dca381942c79818bb42f1a566a83 AS runtime

ARG VCS_REF=unknown
ARG OCI_CREATED=unknown
ARG OCI_SOURCE=unknown
ARG SOURCE_RUN_ID=unknown
ARG REQUIRED_API_MANIFEST=unknown
ARG OPENAPI_SHA256=unknown
ARG VITE_ELEVANT_API_URL=unknown
ARG VITE_HR_DEMO_MODE=unknown

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
      io.elevant.web.api-origin=${VITE_ELEVANT_API_URL} \
      io.elevant.web.hr-demo-mode=${VITE_HR_DEMO_MODE}

COPY --from=build --chown=101:101 /workspace/frontend/private-web/dist/ /usr/share/nginx/html/
COPY --chown=101:101 frontend/private-web/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --chown=101:101 frontend/private-web/nginx/security-headers.conf /etc/nginx/snippets/elevant-security-headers.conf
RUN case "${VITE_ELEVANT_API_URL}" in https://*) ;; *) exit 1 ;; esac \
    && api_ws_origin="wss://${VITE_ELEVANT_API_URL#https://}" \
    && sed -i "s|__ELEVANT_API_ORIGIN__|${VITE_ELEVANT_API_URL}|g" \
      /etc/nginx/snippets/elevant-security-headers.conf \
    && sed -i "s|__ELEVANT_WS_ORIGIN__|${api_ws_origin}|g" \
      /etc/nginx/snippets/elevant-security-headers.conf \
    && ! grep -Eq '__ELEVANT_(API|WS)_ORIGIN__' \
      /etc/nginx/snippets/elevant-security-headers.conf

EXPOSE 8080
USER 101:101

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=4 \
  CMD ["wget", "-q", "-T", "5", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]

ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
