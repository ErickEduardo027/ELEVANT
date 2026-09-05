#!/bin/sh
set -eu

# Public Web follows database (:00), API (:15) and AVIAM (:30). Locks remain
# authoritative if an earlier operation legitimately takes longer.
sleep 45

exec /etc/dokploy/elevant/web-cd/elevant-web-cd \
  --app public-web \
  --config /etc/dokploy/elevant/web-cd/config.public-web.env \
  --poll
