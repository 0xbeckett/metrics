# shellcheck shell=bash
# Cross-invocation failure tracking + alert-line formatting for scripts/refresh-metrics.sh.
#
# refresh-metrics.sh is a oneshot: every systemd tick is a fresh process, so "have we failed
# N times in a row?" cannot live in memory. It lives in a tiny state file (two lines) that this
# library reads and writes. The formatting helpers turn a captured error log into ONE safe line
# for the beckett channel — deliberately stripping quoted samples, parenthesised detail, absolute
# paths and stack frames so a privacy-scan failure can never paste the very value it caught, and
# a node crash can never dump its stack. Kept separate from the script so the tricky bits (state
# transitions, redaction, reason extraction) are unit-testable without running a real harvest.

# Read the persisted streak into RA_FAILURES / RA_ALERTED. Missing/garbled file => a clean slate.
ra_read_state() {
  RA_FAILURES=0
  RA_ALERTED=0
  local f="$1" k v
  [[ -f "$f" ]] || return 0
  while IFS='=' read -r k v; do
    case "$k" in
      failures) [[ "$v" =~ ^[0-9]+$ ]] && RA_FAILURES="$v" ;;
      alerted)  [[ "$v" =~ ^[01]$ ]]   && RA_ALERTED="$v" ;;
    esac
  done <"$f"
}

# Persist the streak. Args: <state_file> <failures> <alerted 0|1>.
ra_write_state() {
  local f="$1" dir
  dir=$(dirname -- "$f")
  mkdir -p -- "$dir"
  printf 'failures=%s\nalerted=%s\n' "$2" "$3" >"$f"
}

# Reduce a blob of stderr on stdin to a single public-safe line on stdout:
#   - drop "…"-quoted samples and (parenthesised) detail — where privacy-scan puts caught values,
#   - redact absolute local paths (Unix and Windows),
#   - flatten newlines/runs of whitespace, and cap the length.
ra_sanitize_reason() {
  tr '\n' ' ' \
    | sed -E '
        s/"[^"]*"/…/g;
        s/\x27[^\x27]*\x27/…/g;
        s/\([^)]*\)/…/g;
        s#/(home|Users)/[^[:space:]]*#<path>#g;
        s#[A-Za-z]:[\\/][^[:space:]]*#<path>#g;
        s/[[:space:]]+/ /g;
        s/^ //;
        s/ $//' \
    | cut -c1-180
}

# Pick the single most useful line out of a captured error log and sanitise it. Prefers a line
# that reads like an error message over a bare stack frame or node's trailing "Node.js vNN" banner;
# falls back to the last non-blank line, then to a placeholder. Arg: <error_log_path>.
ra_extract_reason() {
  local log="$1" line=""
  if [[ -s "$log" ]]; then
    line=$(grep -aiE 'error|fail|cannot|refus|invalid|throw' -- "$log" 2>/dev/null \
      | grep -avE '^[[:space:]]*at |^Node\.js v' \
      | tail -n1)
    [[ -z "$line" ]] && line=$(grep -avE '^[[:space:]]*$' -- "$log" 2>/dev/null | tail -n1)
  fi
  [[ -z "$line" ]] && line="no error detail captured (see journalctl)"
  printf '%s\n' "$line" | ra_sanitize_reason
}

# The one-line failure alert. Args: <streak> <step> <reason>.
ra_failure_line() {
  printf 'the metrics refresh has failed %s runs in a row at step %s — last error: %s' "$1" "$2" "$3"
}

# The one-line recovery notice. Args: <recovered-from streak> <step where success landed>.
ra_recovery_line() {
  printf 'the metrics refresh recovered after %s failed runs — metrics.json is publishing again' "$1"
}
