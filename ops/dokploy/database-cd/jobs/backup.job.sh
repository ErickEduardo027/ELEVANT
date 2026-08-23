#!/bin/sh
set -eu
exec /etc/dokploy/elevant/database-cd/elevant-database-cd \
  --config /etc/dokploy/elevant/database-cd/config.env --backup
