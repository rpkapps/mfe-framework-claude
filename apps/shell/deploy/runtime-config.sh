#!/bin/sh
# Writes the shell's runtime-config.json from the environment when the image starts, so one
# build serves every environment (docs/decisions.md §36). POSIX sh and awk only, so it runs in an
# nginx:alpine image with no Node and no jq: copied into /docker-entrypoint.d/, the image runs it
# before nginx starts.
#
#   runtime-config.sh [directory]   (default: /usr/share/nginx/html)
#
# A variable that is unset or empty leaves its field out, and the shell applies its own default.
# The fields match RUNTIME_CONFIG_FIELDS in src/auth/runtime-config.ts; a test keeps them in step.

set -eu

directory="${1:-/usr/share/nginx/html}"
file="$directory/runtime-config.json"
temporary="$file.$$.tmp"

entries=''

add() {
  if [ -n "$entries" ]; then entries="$entries,"; fi
  entries="$entries
  \"$1\": $2"
}

# Backslashes, quotes and control characters escaped, so any value is a valid JSON string.
json_string() {
  printf '%s' "$1" | awk '
    BEGIN { ORS = ""; printf "\"" }
    NR > 1 { printf "\\n" }
    {
      gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); gsub(/\t/, "\\t"); gsub(/\r/, "\\r")
      print
    }
    END { printf "\"" }'
}

string_field() {
  eval "value=\${$2:-}"
  if [ -n "$value" ]; then add "$1" "$(json_string "$value")"; fi
}

boolean_field() {
  eval "value=\${$2:-}"
  case "$value" in
    '') ;;
    true | false) add "$1" "$value" ;;
    *)
      echo "runtime-config.sh: $2 must be true or false, not '$value'." >&2
      exit 1
      ;;
  esac
}

string_field oidcAuthority OIDC_AUTHORITY
string_field oidcClientId OIDC_CLIENT_ID
string_field oidcScope OIDC_SCOPE
string_field oidcGroupsClaim OIDC_GROUPS_CLAIM
boolean_field oidcDisabled OIDC_DISABLED

printf '{%s\n}\n' "$entries" > "$temporary"
mv "$temporary" "$file"
echo "runtime-config.sh: wrote $file"
