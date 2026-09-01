#!/bin/sh
set -eu

# Database CD also starts at the minute boundary. Give its normal poll first
# access to the shared database lock; a longer database operation still wins
# through the controller's fail-closed non-blocking lock.
sleep 15

exec /etc/dokploy/elevant/api-cd/elevant-api-cd \
  --config /etc/dokploy/elevant/api-cd/config.env --poll
