#!/usr/bin/env bash
# Black-box check of a running deployment, from the outside. Run it after every deploy, and from a
# machine other than the server now and then (it is what a learner's phone sees).
#
#   scripts/ops/check-deploy.sh https://api.yourdomain.com
#   scripts/ops/check-deploy.sh https://api.yourdomain.com --expect-version 3.0.1
#   scripts/ops/check-deploy.sh https://staging.example.org --insecure      (self-signed certificate)
#
# Exit status 0 when nothing failed (warnings are allowed), 1 otherwise. Needs curl, openssl and awk.
set -uo pipefail

base="" expect_version="" insecure=no
while [[ $# -gt 0 ]]; do
  case "$1" in
    --expect-version) [[ $# -ge 2 ]] || { echo "--expect-version needs a value" >&2; exit 2; }; expect_version="$2"; shift ;;
    --insecure) insecure=yes ;;
    -h | --help) sed -n '2,/^set -uo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "unknown option: $1 (try --help)" >&2; exit 2 ;;
    *) base="${1%/}" ;;
  esac
  shift
done
[[ -n "$base" ]] || { echo "usage: check-deploy.sh https://api.yourdomain.com [--expect-version X] [--insecure]" >&2; exit 2; }
re='^(https?)://([^/:]+)(:([0-9]+))?$'
[[ $base =~ $re ]] || { echo "give the address as https://host or https://host:port (no path)" >&2; exit 2; }
scheme="${BASH_REMATCH[1]}" host="${BASH_REMATCH[2]}" port="${BASH_REMATCH[4]}"

curl_opts=(--silent --show-error --max-time 15)
[[ "$insecure" == yes ]] && curl_opts+=(--insecure)

passed=0 warned=0 failed=0
pass() { passed=$((passed + 1)); printf '  ok    %s\n' "$*"; }
warn() { warned=$((warned + 1)); printf '  WARN  %s\n' "$*"; }
fail() { failed=$((failed + 1)); printf '  FAIL  %s\n' "$*"; }

fetch() { # fetch PATH [extra curl args]: headers to $hdr, body to $body; prints the status code (000: no answer)
  local path="$1" status
  shift
  : > "$hdr"; : > "$body"
  status="$(curl "${curl_opts[@]}" "$@" --dump-header "$hdr" --output "$body" --write-out '%{http_code}' "$base$path" 2> /dev/null)" || true
  printf '%s' "${status:-000}"
}
header_count() { grep -ic "^$1:" "$hdr" || true; }
header_value() { grep -i "^$1:" "$hdr" | head -n 1 | cut -d: -f2- | tr -d '\r' | sed 's/^ *//'; }

hdr="$(mktemp)" body="$(mktemp)"
trap 'rm -f "$hdr" "$body"' EXIT
echo "Checking $base"

# 1. liveness and version
code="$(fetch /api/health)"
alive=no
if [[ "$code" == 200 ]] && grep -q '"status":"ok"' "$body"; then
  alive=yes
  version="$(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' "$body")"
  pass "/api/health answers (version $version)"
  if [[ -n "$expect_version" ]]; then
    if [[ "$version" == "$expect_version" ]]; then pass "running the expected version $expect_version"; else fail "running version $version, expected $expect_version"; fi
  fi
else
  fail "/api/health did not answer 200 with status ok (got $code)"
  if [[ "$code" == 000 ]]; then
    fail "no answer at all from $base: wrong address, the server is down, or the firewall is closed"
    echo
    echo "$passed passed, $warned warnings, $failed failed"
    exit 1
  fi
fi

# 2. readiness must not be public on a host that fronts the API with nginx
code="$(fetch /api/health/ready)"
case "$code" in
  403 | 404) pass "/api/health/ready is not open to the internet ($code)" ;;
  200) warn "/api/health/ready is reachable from here: it shows database latency and pool numbers (fine on a platform, closed by nginx/fastsewa.conf)" ;;
  503) warn "/api/health/ready says 503: the API is draining or cannot reach its database" ;;
  *) warn "/api/health/ready answered $code" ;;
esac

# 3. the public config the app reads at start-up
code="$(fetch /api/v1/config)"
if [[ "$code" == 200 ]] && grep -q '{' "$body"; then pass "/api/v1/config answers"; else fail "/api/v1/config did not answer 200 (got $code)"; fi

# 4. errors have the API's JSON shape (also tells us we are not looking at a generic web server)
code="$(fetch /api/v1/this-route-does-not-exist)"
if [[ "$code" == 404 ]] && grep -q '"code"' "$body"; then pass "unknown routes answer a JSON 404"; else fail "an unknown route did not answer the API's JSON 404 (got $code)"; fi

# 5. security headers, exactly once each (a duplicate usually means a proxy and the API both add it)
code="$(fetch /admin/)"
if [[ "$code" == 200 ]]; then
  pass "the admin console is served at /admin/"
  if [[ "$(header_count content-security-policy)" == 1 ]]; then pass "one Content-Security-Policy on the console"; else fail "the console must send exactly one Content-Security-Policy"; fi
  if [[ "$(header_value x-content-type-options)" == nosniff ]]; then pass "X-Content-Type-Options: nosniff"; else fail "X-Content-Type-Options: nosniff is missing"; fi
  if [[ "$scheme" == https ]]; then
    case "$(header_count strict-transport-security)" in
      1) pass "one Strict-Transport-Security header ($(header_value strict-transport-security))" ;;
      0) fail "Strict-Transport-Security is missing" ;;
      *) fail "Strict-Transport-Security is sent more than once" ;;
    esac
  fi
else
  warn "/admin/ answered $code (expected 200 unless ADMIN_CONSOLE_ENABLED=false)"
fi
if [[ -z "$(header_value x-powered-by)" ]]; then pass "no X-Powered-By header"; else warn "X-Powered-By is sent: $(header_value x-powered-by)"; fi
server_banner="$(header_value server)"
if [[ "$server_banner" =~ [0-9]+\.[0-9]+ ]]; then warn "the Server header reveals a version ($server_banner): set server_tokens off"; fi

# 6. CORS must not reflect arbitrary origins
fetch /api/v1/config --header 'Origin: https://attacker.invalid' > /dev/null
if grep -qi '^access-control-allow-origin: *\(\*\|https://attacker.invalid\)' "$hdr"; then fail "CORS allows an arbitrary origin: check ALLOWED_ORIGINS"; else pass "CORS does not allow arbitrary origins"; fi

# 7. plain http redirects to https (only when the address has no custom port)
if [[ "$scheme" == https && -z "$port" ]]; then
  code="$(curl "${curl_opts[@]}" --output /dev/null --write-out '%{http_code} %{redirect_url}' "http://$host/api/health" 2> /dev/null)" || true
  if [[ "$code" == "301 https://$host/api/health" ]]; then pass "http:// redirects to https://"; else warn "http://$host/api/health answered '$code' instead of a 301 to https (port 80 closed is also fine on a platform)"; fi
fi

# 8. certificate lifetime
if [[ "$scheme" == https ]]; then
  end="$(echo | openssl s_client -connect "$host:${port:-443}" -servername "$host" 2> /dev/null | openssl x509 -noout -enddate 2> /dev/null | cut -d= -f2)"
  if [[ -n "$end" ]]; then
    days=$(( ($(date -d "$end" +%s) - $(date +%s)) / 86400 ))
    if [[ "$days" -lt 7 ]]; then fail "the certificate expires in $days days: renewal is not working"
    elif [[ "$days" -lt 21 ]]; then warn "the certificate expires in $days days (it renews at 30): check certbot"
    else pass "the certificate is valid for $days more days"; fi
  else
    warn "could not read the certificate"
  fi
fi

# 9. speed of the cheapest request (network included)
if [[ "$alive" == yes ]]; then
  seconds="$(curl "${curl_opts[@]}" --output /dev/null --write-out '%{time_total}' "$base/api/health" 2> /dev/null)" || seconds=99
  if awk -v t="$seconds" 'BEGIN { exit !(t < 1.0) }'; then pass "/api/health took ${seconds}s"; else warn "/api/health took ${seconds}s (over 1 s: network or an overloaded server)"; fi
fi

echo
echo "$passed passed, $warned warnings, $failed failed"
[[ "$failed" -eq 0 ]]
