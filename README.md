# Beckett — Proof of Work dashboard

Neo-brutalist, static **marketing** dashboard for Beckett — an autonomous coding agent — told
entirely in numbers and charts. Live at **https://metrics.0xbeckett.me**.

The page and its **back half** live together in this repository. The two vendored harvesters
originated in the Beckett tickets #8 and #26.3, but are deliberately ported here under
`scripts/harvest/`: scheduled refreshes do **not** depend on a hand-run command or checkout in
another repository.

- **Telemetry** (`scripts/harvest/telemetry.ts`) reads `~/.claude`, `~/.pi`, `~/.codex`, and the
  bored tracker to produce per-session model / cost / wall-clock / review-cycle rows.
- **Code stats** (`scripts/harvest/code-stats.ts`) reads `~/Projects/*` git history to produce
  LOC, commits, per-project rollups, authorship display names, and daily velocity. Known author
  identities are canonicalized through `config/author-aliases.json` before contributor buckets
  are aggregated.

This app never recomputes cost, cycle counts, or LOC — it only reads, aggregates (sum/count),
and draws.

## Data flow

```
~/.claude · ~/.pi · ~/.codex · bored tracker        ~/Projects/* git history
        │  (telemetry harvester — #8)                       │  (code-stats harvester — #26.3)
        ▼                                                    ▼
data/telemetry-runs.json  (~1.6k run rows)          data/code-stats.json  (per-repo/author/day)
        └───────────────────┬────────────────────────────────┘
                            │  (scripts/prepare-data.mjs — build-time rollup, sum/count only)
                            ▼
             src/generated/metrics.json   telemetry aggregates + `codeStats` block (committed)
                            │  (initial vite build)
                            ▼
             dist/ + metrics.json           static shell → metrics.0xbeckett.me
                            ▲
                            │  (15-minute refresh atomically replaces only metrics.json)
```

`prepare-data.mjs` reads both datasets, rolls them into the chart shapes plus the headline
totals, and writes `src/generated/metrics.json`. It **does not** re-derive any metric — cost
(`cost_usd`), wall-clock (`wall_clock_seconds`), review bounces (`review_cycles`) and every
code-stats figure come straight from the harvesters' rows and are only summed/counted. It strips
emails and local paths, and refuses to write a public document if either remains. The refresh
also runs `scripts/verify-public-metrics.mjs` against the staged served JSON.

Point it at different datasets with `TELEMETRY_DATASET=/path/to/runs.json` and
`CODE_STATS_DATASET=/path/to/code-stats.json`.

## The page

A marketing piece, not an info panel: giant count-up hero figures (lines shipped, commits,
projects, spend, sessions, compute), a full-width commit-velocity timeline as the hero visual, a
strip of derived cost-per-outcome ratios (first-try rate, $/commit, lines/$, …), then a grid of
charts. Numbers count up on load and charts draw in — fast, and skipped under
`prefers-reduced-motion`. `src/derived.ts` computes the marketing projections; `src/motion.tsx`
holds the count-up hook and reveal wrapper.

## Charts

All views render with [**dither-kit**](https://www.tripwire.sh/dither-kit) (`@dither-kit/*`,
installed into `src/components/dither-kit/`). Each card is monochromatic (one palette colour) to
stay legible:

| View | Source | dither-kit component |
|------|--------|----------------------|
| Commit velocity (daily, hero) | code stats | `AreaChart` |
| Lines per project (top 8) | code stats | `BarChart` |
| Authorship (commits, top 7) | code stats | `BarChart` |
| API cost per model (USD) | telemetry | `BarChart` |
| Runs per day | telemetry | `AreaChart` |
| Wall-clock per model (hours) | telemetry | `BarChart` |
| Review-cycle distribution | telemetry | `BarChart` |
| Hero-stat sparklines | both | `Sparkline` |

## Develop / build

```sh
bun install
bun run refresh        # harvest both sources, roll up, privacy-check, atomically publish JSON
bun run dev            # local dev server
bun run build          # → dist/ + dist/metrics.json (runs prepare-data first)
bun run typecheck
```

`bun run refresh` is the single end-to-end command. It invokes both vendored harvesters,
regenerates `src/generated/metrics.json`, verifies that no email or absolute local path is
public, then atomically renames the result into the served `metrics.json`. The React shell fetches
that file with `cache: "no-store"` on page load, so routine refreshes do not need a Vite rebuild.
The footer's **updated** stamp is the rollup timestamp in that file.

## Deploy

Static build, served on `127.0.0.1:8971` by a durable `systemd --user` unit and exposed through
Beckett's Cloudflare tunnel.

```sh
# 1. Initial shell deployment (the refresh below places its live JSON in this directory).
bun run refresh
bun run build
mkdir -p ~/.local/share/beckett-metrics/dist
cp -a dist/. ~/.local/share/beckett-metrics/dist/

# 2. Durable static server and automatic data refresh.
# The units assume this checkout is /home/beckett/Projects/metrics; edit both paths if moved.
cp deploy/beckett-metrics.service deploy/beckett-metrics-refresh.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now beckett-metrics.service beckett-metrics-refresh.timer
loginctl enable-linger beckett  # keep the user timer running across reboot/login absence

# 3. Tunnel + DNS (creates both) and verify
beckett deploy metrics --port 8971
curl -fsS http://127.0.0.1:8971/metrics.json | node scripts/verify-public-metrics.mjs /dev/stdin
systemctl --user list-timers beckett-metrics-refresh.timer
```

The timer is persistent, so after reboot systemd runs a missed cycle shortly after the user
manager starts, then every 15 minutes. `refresh-metrics.sh` writes a temporary file beside the
served file and `mv`s it into place only after both harvesters, rollup, and privacy checks pass.
A failure is logged to the service journal (`journalctl --user -u beckett-metrics-refresh.service`)
and leaves the last-good site untouched. For a shell/style deployment, run `bun run build` and
stage the new `dist` as above; ordinary data refreshes never restart the static server.

## Known data notes (flagged, not patched — see #8, out of scope here)

- **Opus dominates** both spend (~$871 of ~$1.1k) and wall-clock (~654h). The linear bars make
  the other five models look tiny — that is the honest shape of the data; exact values are on
  hover.
- **Rate estimates:** Claude `*-5`/`4-8` labels have no exact public SKU, so their cost is an
  estimate. The harvester marks these `rate_estimate: true`; the cost card footnotes which
  models are estimated.
- Anything that looks wrong is a harvester concern — flag it there, don't patch it in the UI.
