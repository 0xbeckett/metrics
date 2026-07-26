/*
 * Claude Code session-transcript harvester (#2).
 *
 * Every Claude Code session on this host writes a JSONL transcript under
 * ~/.claude/projects/<slugified-cwd>/<session-id>.jsonl (plus subagent transcripts nested under
 * <session-id>/subagents/). These transcripts hold raw prompts, tool arguments, tool output,
 * file contents and absolute paths — the polar opposite of public data. This harvester's entire
 * job is to throw almost all of that away and keep only per-session counts, durations and
 * enum-like fields.
 *
 * PRIVACY CONTRACT (the acceptance bar this file lives or dies on):
 *   - never emit prompt text, assistant text, tool arguments, tool results, or file paths.
 *   - a tool call contributes only its NAME to a count; its arguments/output are never read
 *     beyond a same-pass regex test for the permission-denial phrase (the matched text itself is
 *     discarded — only a boolean increment survives).
 *   - the session id is salted-hashed before it ever reaches the emitted row. The salt lives in
 *     its own file, never inside the dataset this harvester writes.
 *
 * INCREMENTAL BY CURSOR: the corpus only grows (currently ~2,300 files / ~1.3GB) and refreshes
 * run every 60s, so re-reading it all each run is a non-starter. A companion state file persists
 * (path, size, mtime, byte offset) plus each file's running accumulators, keyed by path. A run
 * whose files are unchanged (size+mtime match) never opens them — it only stats. A run against a
 * growing file streams from its last offset, one line at a time (never JSON.parse of a whole
 * file), and only advances the offset past complete lines so a transcript mid-write is safe to
 * resume from later.
 */
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { calculateCost, type ModelRate, type RateTable } from "./telemetry.ts";

export interface TokenUsage {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

export type SessionClassification = "worker" | "concierge" | "quick" | "other";

/** One row per transcript file. No free text, no ids, no paths — counts and enums only. */
export interface ClaudeSessionRow {
  session_hash: string;
  start_hour: string;
  duration_seconds: number;
  turns: number;
  tool_calls: number;
  tool_calls_by_name: Record<string, number>;
  model: string | null;
  tokens: TokenUsage;
  cost_usd: number | null;
  error_count: number;
  permission_denials: number;
  classification: SessionClassification;
}

export interface ClaudeSessionsDataset {
  schema_version: 1;
  generated_at: string;
  sessions: ClaudeSessionRow[];
}

/** Per-file running accumulator, persisted so a later run can resume mid-session. Local-only. */
export interface FileState {
  size: number;
  mtimeMs: number;
  offset: number;
  rawId: string | null;
  sessionHash: string | null;
  classification: SessionClassification;
  firstTs: string | null;
  lastTs: string | null;
  turns: number;
  toolCalls: Record<string, number>;
  tokensByModel: Record<string, TokenUsage>;
  errorCount: number;
  permissionDenials: number;
}

interface HarvestState {
  schema_version: 1;
  files: Record<string, FileState>;
}

export interface ClaudeSessionsHarvestOptions {
  output: string;
  stateFile: string;
  saltFile: string;
  claudeDir: string;
  rates: string;
  home: string;
  note?: (message: string) => void;
}

const ZERO_TOKENS: TokenUsage = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
const asObject = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

/** Mirrors Claude Code's directory naming: every non-alphanumeric char in the cwd becomes "-". */
function slugify(path: string): string {
  return path.replace(/[^A-Za-z0-9]/g, "-");
}

/**
 * Classify a project-dir slug by structural shape only — never by reading transcript content.
 * A path under any project's .beckett/worktrees/ is ticket-implementation worker time; the
 * quick/browser-agent/agent-runs dirs are short single-shot dispatches; the primary concierge
 * checkout (home/beckett) is the front desk. Everything else (manual sessions in arbitrary
 * project repos) is "other" — still counted, just not attributable to the worker system.
 */
export function classifySlug(slug: string, home: string): SessionClassification {
  if (/-worktrees-/.test(slug)) return "worker";
  if (/-(quick|browser-agent|agent-runs)-/.test(slug)) return "quick";
  if (slug === slugify(join(home, "beckett"))) return "concierge";
  return "other";
}

/** Salted, truncated session-id hash. Stable across runs (same salt+id), never reversible. */
export function hashSessionId(id: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${id}`).digest("hex").slice(0, 16);
}

async function loadOrCreateSalt(path: string): Promise<string> {
  try {
    const existing = (await readFile(path, "utf8")).trim();
    if (existing) return existing;
  } catch {
    /* fall through and create one */
  }
  const salt = randomBytes(32).toString("hex");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${salt}\n`, { mode: 0o600 });
  return salt;
}

async function loadState(path: string): Promise<HarvestState> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as HarvestState;
    if (parsed && typeof parsed === "object" && parsed.files && typeof parsed.files === "object") return parsed;
  } catch {
    /* absent/unreadable/malformed — start fresh */
  }
  return { schema_version: 1, files: {} };
}

async function saveState(path: string, state: HarvestState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(state));
  await rename(temporary, path);
}

async function filesUnder(root: string, note: (message: string) => void): Promise<string[]> {
  const result: string[] = [];
  const todo = [root];
  while (todo.length) {
    const dir = todo.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      note(`source absent/unreadable: ${dir} (${(error as Error).message})`);
      continue;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) todo.push(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) result.push(path);
    }
  }
  return result.sort();
}

/**
 * Stream complete lines from `path` starting at byte `start`. Reads in stream chunks (never the
 * whole file into memory) and only reports a line — and its post-line byte offset — once its
 * trailing newline has actually arrived, so a transcript being written mid-line is left for the
 * next run rather than parsed as a truncated JSON fragment. Splitting on the raw newline byte
 * before decoding keeps this correct across multi-byte UTF-8 sequences.
 */
async function* streamLinesFrom(path: string, start: number): AsyncGenerator<{ line: string; consumedTo: number }> {
  let pos = start;
  let carry = Buffer.alloc(0);
  const stream = createReadStream(path, { start });
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    carry = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    let nl: number;
    while ((nl = carry.indexOf(0x0a)) !== -1) {
      const lineBuf = carry.subarray(0, nl);
      carry = carry.subarray(nl + 1);
      pos += lineBuf.length + 1;
      yield { line: lineBuf.toString("utf8"), consumedTo: pos };
    }
  }
}

function addTokens(into: TokenUsage, usage: unknown): void {
  const value = asObject(usage);
  if (!value) return;
  into.input += num(value.input_tokens) || num(value.input);
  into.output += num(value.output_tokens) || num(value.output);
  into.cache_read += num(value.cache_read_input_tokens) || num(value.cached_input_tokens) || num(value.cache_read);
  into.cache_write += num(value.cache_creation_input_tokens) || num(value.cache_write);
}

// The canonical phrases Claude Code inserts into an is_error tool_result when a tool call was
// blocked by the permission system — either an interactive rejection or a policy denial. Text is
// only ever tested against this pattern and immediately discarded; it is never stored or emitted.
const DENIAL_RE = /doesn't want to proceed with this tool use|tool use was rejected|permission[^.]{0,80}has been denied|permission denied/i;

function blockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === "object" && typeof (c as Record<string, unknown>).text === "string" ? (c as Record<string, unknown>).text as string : ""))
      .join(" ");
  }
  return "";
}

function isUserPrompt(content: unknown): boolean {
  if (typeof content === "string") return true;
  if (!Array.isArray(content)) return false;
  return !content.some((c) => asObject(c)?.type === "tool_result");
}

function applyEntry(state: FileState, entry: Record<string, unknown>): void {
  if (!state.rawId) state.rawId = text(entry.agentId) ?? text(entry.sessionId);

  const at = text(entry.timestamp);
  const iso = at && Number.isFinite(Date.parse(at)) ? new Date(at).toISOString() : null;
  if (iso) {
    if (!state.firstTs || iso < state.firstTs) state.firstTs = iso;
    if (!state.lastTs || iso > state.lastTs) state.lastTs = iso;
  }

  if (entry.type === "system" && entry.subtype === "api_error") {
    state.errorCount += 1;
    return;
  }

  const message = asObject(entry.message);
  if (!message) return;
  const content = message.content;

  if (entry.type === "user" && message.role === "user") {
    if (isUserPrompt(content)) {
      state.turns += 1;
    } else if (Array.isArray(content)) {
      for (const block of content) {
        const b = asObject(block);
        if (!b || b.type !== "tool_result") continue;
        if (b.is_error === true) {
          state.errorCount += 1;
          if (DENIAL_RE.test(blockText(b.content))) state.permissionDenials += 1;
        }
      }
    }
    return;
  }

  if (entry.type === "assistant" && message.role === "assistant") {
    if (Array.isArray(content)) {
      for (const block of content) {
        const b = asObject(block);
        const name = b && b.type === "tool_use" ? text(b.name) : null;
        if (name) state.toolCalls[name] = (state.toolCalls[name] ?? 0) + 1;
      }
    }
    const model = text(message.model);
    const usage = asObject(message.usage);
    if (model && usage) {
      const bucket = state.tokensByModel[model] ?? { ...ZERO_TOKENS };
      addTokens(bucket, usage);
      state.tokensByModel[model] = bucket;
    }
  }
}

function freshFileState(classification: SessionClassification): FileState {
  return {
    size: 0,
    mtimeMs: 0,
    offset: 0,
    rawId: null,
    sessionHash: null,
    classification,
    firstTs: null,
    lastTs: null,
    turns: 0,
    toolCalls: {},
    tokensByModel: {},
    errorCount: 0,
    permissionDenials: 0,
  };
}

function rateForModel(model: string, rates: RateTable): ModelRate | null {
  const normalized = model.toLowerCase();
  return rates.models[normalized] ?? rates.models[normalized.replace(/-\d{8}$/, "")] ?? null;
}

function floorToHour(iso: string): string {
  const d = new Date(iso);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

function toRow(f: FileState, salt: string, fallbackId: string, rates: RateTable | null): ClaudeSessionRow {
  const modelEntries = Object.entries(f.tokensByModel);
  const totalFor = (t: TokenUsage) => t.input + t.output + t.cache_read + t.cache_write;
  modelEntries.sort((a, b) => totalFor(b[1]) - totalFor(a[1]));
  const primaryModel = modelEntries[0]?.[0] ?? null;
  const tokens = modelEntries.reduce<TokenUsage>(
    (acc, [, t]) => ({
      input: acc.input + t.input,
      output: acc.output + t.output,
      cache_read: acc.cache_read + t.cache_read,
      cache_write: acc.cache_write + t.cache_write,
    }),
    { ...ZERO_TOKENS },
  );

  let cost: number | null = null;
  if (rates) {
    let sum = 0;
    let any = false;
    for (const [model, t] of modelEntries) {
      const rate = rateForModel(model, rates);
      if (rate) {
        sum += calculateCost(t, rate);
        any = true;
      }
    }
    if (any) cost = Number(sum.toFixed(6));
  }

  const toolCallTotal = Object.values(f.toolCalls).reduce((a, b) => a + b, 0);
  const startHour = f.firstTs ? floorToHour(f.firstTs) : floorToHour(new Date(0).toISOString());
  const duration = f.firstTs && f.lastTs ? Math.max(0, (Date.parse(f.lastTs) - Date.parse(f.firstTs)) / 1000) : 0;

  return {
    session_hash: f.sessionHash ?? hashSessionId(f.rawId ?? fallbackId, salt),
    start_hour: startHour,
    duration_seconds: Number(duration.toFixed(3)),
    turns: f.turns,
    tool_calls: toolCallTotal,
    tool_calls_by_name: { ...f.toolCalls },
    model: primaryModel,
    tokens,
    cost_usd: cost,
    error_count: f.errorCount,
    permission_denials: f.permissionDenials,
    classification: f.classification,
  };
}

export async function harvestClaudeSessions(options: ClaudeSessionsHarvestOptions): Promise<ClaudeSessionsDataset> {
  const note = options.note ?? ((message: string) => console.error(`[claude-sessions] ${message}`));
  const salt = await loadOrCreateSalt(options.saltFile);
  const state = await loadState(options.stateFile);

  let rates: RateTable | null = null;
  try {
    rates = JSON.parse(await readFile(options.rates, "utf8")) as RateTable;
  } catch (error) {
    note(`no rate table at ${options.rates}: ${(error as Error).message}; sessions will publish without cost`);
  }

  const files = await filesUnder(options.claudeDir, note);
  const seen = new Set<string>();
  let changed = 0;
  let unchanged = 0;

  for (const path of files) {
    seen.add(path);
    let stats;
    try {
      stats = await stat(path);
    } catch (error) {
      note(`could not stat ${path}: ${(error as Error).message}`);
      continue;
    }

    const prior = state.files[path];
    if (prior && prior.size === stats.size && prior.mtimeMs === stats.mtimeMs) {
      unchanged += 1;
      continue;
    }

    const slug = relative(options.claudeDir, path).split(sep)[0] ?? "";
    const truncated = prior !== undefined && stats.size < prior.offset;
    const entry = prior && !truncated ? prior : freshFileState(classifySlug(slug, options.home));
    const startOffset = truncated ? 0 : (prior?.offset ?? 0);

    let consumedTo = startOffset;
    for await (const { line, consumedTo: pos } of streamLinesFrom(path, startOffset)) {
      consumedTo = pos;
      if (!line.trim()) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        note(`invalid JSON line skipped in ${path}`);
        continue;
      }
      applyEntry(entry, parsed);
    }

    if (entry.rawId && !entry.sessionHash) entry.sessionHash = hashSessionId(entry.rawId, salt);
    entry.size = stats.size;
    entry.mtimeMs = stats.mtimeMs;
    entry.offset = consumedTo;
    state.files[path] = entry;
    changed += 1;
  }

  // Drop cursor entries for transcripts that no longer exist (rotated away, host cleanup, etc).
  for (const path of Object.keys(state.files)) {
    if (!seen.has(path)) delete state.files[path];
  }

  await saveState(options.stateFile, state);

  const sessions = Object.entries(state.files)
    .filter(([, f]) => f.firstTs && f.lastTs)
    .map(([path, f]) => toRow(f, salt, path, rates))
    .sort((a, b) => a.start_hour.localeCompare(b.start_hour) || a.session_hash.localeCompare(b.session_hash));

  const dataset: ClaudeSessionsDataset = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    sessions,
  };

  await mkdir(dirname(options.output), { recursive: true });
  const temporaryOutput = `${options.output}.${process.pid}.tmp`;
  await writeFile(temporaryOutput, `${JSON.stringify(dataset, null, 2)}\n`);
  await rename(temporaryOutput, options.output);
  note(`${changed} changed / ${unchanged} unchanged of ${files.length} transcripts → ${sessions.length} sessions → ${options.output}`);
  return dataset;
}

export function defaultClaudeSessionsOptions(cwd = process.cwd(), env = process.env): ClaudeSessionsHarvestOptions {
  const home = env.HOME ?? ".";
  return {
    output: resolve(cwd, "data/claude-sessions.json"),
    stateFile: resolve(cwd, "data/claude-sessions-state.json"),
    saltFile: resolve(cwd, "data/.claude-sessions-salt"),
    claudeDir: join(home, ".claude/projects"),
    rates: resolve(cwd, "config/model-rates.json"),
    home,
  };
}
