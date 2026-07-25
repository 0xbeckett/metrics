/*
 * Spend section — sourced from ~/.beckett/spend.jsonl (one row per worker run).
 *
 * Rolls cost into: spend over time, cost per ticket, cost by stage, and cost by model. Each row
 * looks like { ticketId, stage, model, costUsd, ts, ... }; malformed lines are skipped.
 *
 * PUBLIC-SAFE: ticket refs (e.g. "OPS-125") are allowed and used to label the top-cost tickets;
 * nothing else from a row that could carry private text is emitted.
 */
import { join } from "node:path";
import { beckettDir, readJsonlSafe, num, round, dayOf, bump, modelMeta, fillDays } from "./shared.mjs";

const empty = () => ({
  available: false,
  totalSpend: 0,
  runsPriced: 0,
  overTime: [],
  byModel: [],
  byStage: [],
  costPerTicket: { count: 0, mean: 0, p50: 0, max: 0, top: [] },
});

export function harvestSpend(dir = beckettDir()) {
  const rows = readJsonlSafe(join(dir, "spend.jsonl"));
  if (rows.length === 0) return empty();

  const perDay = new Map(); // day -> { cost, runs }
  const perModel = new Map(); // model -> { cost, runs }
  const perStage = new Map(); // stage -> { cost, runs }
  const perTicket = new Map(); // ref -> cost
  let total = 0;
  let priced = 0;

  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const cost = num(r.costUsd) ?? 0;
    total += cost;
    priced += 1;

    const day = dayOf(r.ts);
    if (day) {
      const d = perDay.get(day) ?? { cost: 0, runs: 0 };
      d.cost += cost;
      d.runs += 1;
      perDay.set(day, d);
    }
    const model = typeof r.model === "string" && r.model ? r.model : "unknown";
    const pm = perModel.get(model) ?? { cost: 0, runs: 0 };
    pm.cost += cost;
    pm.runs += 1;
    perModel.set(model, pm);

    const stage = typeof r.stage === "string" && r.stage ? r.stage : "unknown";
    const ps = perStage.get(stage) ?? { cost: 0, runs: 0 };
    ps.cost += cost;
    ps.runs += 1;
    perStage.set(stage, ps);

    const ref = typeof r.ticketId === "string" && r.ticketId ? r.ticketId : null;
    if (ref) bump(perTicket, ref, cost);
  }

  const byModel = [...perModel.entries()]
    .sort((a, b) => b[1].cost - a[1].cost)
    .map(([model, agg], i) => {
      const meta = modelMeta(model, i);
      return { model, label: meta.label, color: meta.color, cost: round(agg.cost, 2), runs: agg.runs };
    });

  const byStage = [...perStage.entries()]
    .sort((a, b) => b[1].cost - a[1].cost)
    .map(([stage, agg]) => ({ stage, cost: round(agg.cost, 2), runs: agg.runs }));

  const ticketCosts = [...perTicket.values()];
  ticketCosts.sort((a, b) => a - b);
  const top = [...perTicket.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([ref, cost]) => ({ ref, cost: round(cost, 2) }));

  const overTime = fillDays(perDay, () => ({ cost: 0, runs: 0 })).map((d) => ({
    date: d.date,
    cost: round(d.cost, 2),
    runs: d.runs,
  }));

  return {
    available: true,
    totalSpend: round(total, 2),
    runsPriced: priced,
    overTime,
    byModel,
    byStage,
    costPerTicket: {
      count: ticketCosts.length,
      mean: ticketCosts.length ? round(total / ticketCosts.length, 2) : 0,
      p50: ticketCosts.length ? round(ticketCosts[Math.floor((ticketCosts.length - 1) / 2)], 2) : 0,
      max: ticketCosts.length ? round(ticketCosts[ticketCosts.length - 1], 2) : 0,
      top,
    },
  };
}
