#!/usr/bin/env node
/**
 * Durable Objects usage vs. the free-tier daily budgets — the guardrail
 * from docs/plans/2026-08-31-sleeping-tabs-plan.md, so the next quota
 * cliff is visible days out instead of at 500-time.
 *
 *   node tools/do-usage.mjs [--days 7]
 *
 * Needs:
 *   CLOUDFLARE_ACCOUNT_ID   (already set for deploys)
 *   CLOUDFLARE_API_TOKEN    an API token with "Account Analytics: Read"
 *                           (dash.cloudflare.com → My Profile → API Tokens)
 *
 * Reads the GraphQL Analytics API: DO active time (the duration meter that
 * exhausted on 2026-08-31) and request counts, per day, with headroom
 * against the Workers Free limits.
 */

const FREE_DURATION_GBS_PER_DAY = 13_000; // GB-s/day on Workers Free
const FREE_REQUESTS_PER_DAY = 100_000;
const DO_MEMORY_GB = 0.128; // every DO is billed at 128 MB

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const days = Math.max(1, Number(process.argv[process.argv.indexOf("--days") + 1]) || 7);

if (!accountId || !token) {
  console.error(
    "Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Account Analytics: Read).",
  );
  process.exit(1);
}

const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

const query = `{
  viewer {
    accounts(filter: {accountTag: "${accountId}"}) {
      periodic: durableObjectsPeriodicGroups(
        limit: 100
        filter: {date_geq: "${since}"}
        orderBy: [date_ASC]
      ) {
        dimensions { date }
        sum { activeTime }
      }
      invocations: durableObjectsInvocationsAdaptiveGroups(
        limit: 100
        filter: {date_geq: "${since}"}
        orderBy: [date_ASC]
      ) {
        dimensions { date }
        sum { requests }
      }
    }
  }
}`;

const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ query }),
});
const body = await res.json();

if (!res.ok || body.errors?.length) {
  console.error("GraphQL query failed:");
  console.error(JSON.stringify(body.errors ?? body, null, 2));
  process.exit(1);
}

const account = body.data?.viewer?.accounts?.[0];
if (!account) {
  console.error("No account data returned — check the token's account scope.");
  process.exit(1);
}

const requestsByDate = new Map(
  (account.invocations ?? []).map((g) => [g.dimensions.date, g.sum.requests]),
);

console.log(`Durable Objects usage, last ${days} day(s) (free-tier budgets in %):\n`);
console.log("date        active-hours   GB-s      duration%   requests   requests%");

let worst = 0;
for (const g of account.periodic ?? []) {
  const date = g.dimensions.date;
  // activeTime is reported in microseconds of wall-clock DO activity.
  const activeSeconds = (g.sum.activeTime ?? 0) / 1e6;
  const gbs = activeSeconds * DO_MEMORY_GB;
  const durationPct = (gbs / FREE_DURATION_GBS_PER_DAY) * 100;
  const requests = requestsByDate.get(date) ?? 0;
  const requestsPct = (requests / FREE_REQUESTS_PER_DAY) * 100;
  worst = Math.max(worst, durationPct, requestsPct);
  console.log(
    `${date}  ${(activeSeconds / 3600).toFixed(1).padStart(10)}h  ${Math.round(gbs)
      .toString()
      .padStart(7)}  ${durationPct.toFixed(1).padStart(8)}%  ${requests
      .toString()
      .padStart(9)}  ${requestsPct.toFixed(1).padStart(8)}%`,
  );
}

console.log();
if (worst >= 100) {
  console.log("⚠ A daily budget was exceeded — documents 500 until the daily reset (00:00 UTC).");
  process.exitCode = 2;
} else if (worst >= 70) {
  console.log(`⚠ Peak day at ${worst.toFixed(0)}% of a free-tier budget — trending toward the cliff.`);
  process.exitCode = 2;
} else {
  console.log(`OK — peak day at ${worst.toFixed(0)}% of the free-tier budgets.`);
}
