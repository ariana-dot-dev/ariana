#!/bin/sh
set -e

# Make sure the server folder exists
mkdir -p ${MOONLIGHT_WEB_PATH}/server

# Run main application
exec ${MOONLIGHT_WEB_PATH}/web-server "$@"