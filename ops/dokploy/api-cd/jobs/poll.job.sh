#!/bin/sh
set -eu
exec /etc/dokploy/elevant/api-cd/elevant-api-cd \
  --config /etc/dokploy/elevant/api-cd/config.env --poll
