#!/bin/sh
set -eu

# Database starts at :00 and API at :15. Preserve the global lock order and
# stagger AVIAM after both prerequisites have had their normal opportunity.
sleep 30

exec /etc/dokploy/elevant/web-cd/elevant-web-cd \
  --app aviam-web \
  --config /etc/dokploy/elevant/web-cd/config.aviam-web.env \
  --poll
