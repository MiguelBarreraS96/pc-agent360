#!/bin/sh
set -eu

CONFIG_TEMPLATE=/usr/share/nginx/html/assets/runtime-config.template.json
CONFIG_OUTPUT=/usr/share/nginx/html/assets/runtime-config.json
NGINX_TEMPLATE=/etc/nginx/templates/default.conf.template
NGINX_OUTPUT=/etc/nginx/conf.d/default.conf

fail() {
  printf '%s\n' "runtime configuration error: $1" >&2
  exit 1
}

require_value() {
  variable_name=$1
  variable_value=$(printenv "$variable_name" || true)

  [ -n "$variable_value" ] || fail "$variable_name is required"
  case "$variable_value" in
    *example.invalid*|*replace-with-*) fail "$variable_name contains a placeholder" ;;
  esac
}

require_value API_ORIGIN
require_value API_BASE_URL
require_value EMAIL_LINK_CONTINUE_URL
require_value FIREBASE_API_KEY
require_value FIREBASE_APP_ID
require_value FIREBASE_AUTH_DOMAIN
require_value FIREBASE_PROJECT_ID
require_value INACTIVITY_TIMEOUT_SECONDS

case "$API_ORIGIN" in
  https://*) ;;
  *) fail "API_ORIGIN must use HTTPS" ;;
esac
case "$API_ORIGIN" in
  */) fail "API_ORIGIN must not have a trailing slash" ;;
esac
[ "$API_BASE_URL" = "$API_ORIGIN/api/v1" ] || fail "API_BASE_URL must equal API_ORIGIN/api/v1"
case "$EMAIL_LINK_CONTINUE_URL" in
  https://*/auth/email-link) ;;
  *) fail "EMAIL_LINK_CONTINUE_URL must be an HTTPS /auth/email-link URL" ;;
esac
case "$FIREBASE_AUTH_DOMAIN" in
  *[!A-Za-z0-9.-]*|''|.*|*.) fail "FIREBASE_AUTH_DOMAIN is invalid" ;;
esac
case "$INACTIVITY_TIMEOUT_SECONDS" in
  *[!0-9]*|'') fail "INACTIVITY_TIMEOUT_SECONDS must be numeric" ;;
esac
[ "$INACTIVITY_TIMEOUT_SECONDS" -ge 60 ] && [ "$INACTIVITY_TIMEOUT_SECONDS" -le 3600 ] || fail "INACTIVITY_TIMEOUT_SECONDS is outside the allowed range"
command -v envsubst >/dev/null 2>&1 || fail "envsubst is unavailable"

umask 077
envsubst '${API_BASE_URL} ${EMAIL_LINK_CONTINUE_URL} ${FIREBASE_API_KEY} ${FIREBASE_APP_ID} ${FIREBASE_AUTH_DOMAIN} ${FIREBASE_PROJECT_ID} ${INACTIVITY_TIMEOUT_SECONDS}' \
  < "$CONFIG_TEMPLATE" > "$CONFIG_OUTPUT"
chmod 0644 "$CONFIG_OUTPUT"
envsubst '${API_ORIGIN}' < "$NGINX_TEMPLATE" > "$NGINX_OUTPUT"
rm -f "$CONFIG_TEMPLATE"

exec nginx -g 'daemon off;'
