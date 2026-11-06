import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import * as review from "../lib/review-workspace.ts";

// Load the server helpers with an isolated cookie jar and database client, never a hosted connection.
function helpers() {
  const jar = new Map();
  let options;
  const store = { get: name => jar.has(name) ? { value: jar.get(name) } : undefined,
    set: (name, value, settings) => { jar.set(name, value); options = settings; } };
  const compiled = ts.transpileModule(fs.readFileSync(new URL("../lib/review-session.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const require = name => {
    if (name === "server-only") return {};
    if (name === "next/headers") return { cookies: async () => store };
    if (name === "./review-workspace") return review;
    throw new Error("Unexpected server-helper dependency: " + name);
  };
  new Function("require", "module", "exports", compiled)(require, module, module.exports);
  return { ...module.exports, jar, options: () => options };
}

const user = "00000000-0000-4000-9000-000000000101";
const company = "00000000-0000-4000-9000-000000000201";
function activeReview() {
  const base = review.emptyReview(user);
  return { ...base, organizationId: company, uploads: { callouts: {
    kind: "callouts", filename: "Dispatch.csv", received: 2, inserted: 0, duplicates: 2,
    uploadedAt: "2026-11-06T10:30:00.000Z", from: "2025-10-01T00:00:00.000Z", to: "2025-11-01T00:00:00.000Z",
  } } };
}

test("working-view cookies round-trip international filenames and use protected cookie settings", async () => {
  const api = helpers();
  const active = activeReview();
  active.uploads.callouts.filename = "設備 Dispatch octobre 2025.csv";
  await api.saveReview(active);
  assert.deepEqual(await api.readReview(), active);
  assert.match(api.jar.get("callout-review"), /^[A-Za-z0-9_-]+$/);
  assert.ok(api.jar.get("callout-review").length < 4000);
  assert.equal(api.options().httpOnly, true);
  assert.equal(api.options().sameSite, "lax");
  assert.equal(api.options().path, "/");
  assert.equal(api.options().maxAge, 60 * 60 * 24 * 30);
});

test("malformed or oversized working-view cookies do not restore data", async () => {
  const api = helpers();
  for (const value of ["invalid", "x".repeat(4001), Buffer.from("null").toString("base64url")]) {
    api.jar.set("callout-review", value);
    assert.equal((await api.readReview()).organizationId, null);
  }
});

test("active review metadata is shown only after Supabase confirms company access", async () => {
  const api = helpers();
  await api.saveReview(activeReview());
  const clauses = [];
  let permitted = false;
  const client = { from(table) {
    assert.equal(table, "organizations");
    return { select() { return this; }, eq(field, value) { clauses.push([field, value]); return this; },
      maybeSingle: async () => ({ data: permitted ? { id: company } : null, error: null }) };
  } };
  assert.equal((await api.authorizedReview(client, user)).organizationId, null);
  assert.equal((await api.readReview()).organizationId, company);
  permitted = true;
  assert.equal((await api.authorizedReview(client, user)).organizationId, company);
  assert.deepEqual(clauses, [["id", company], ["id", company]]);
});

test("approval totals include every page even when the API row cap is below 1000", async () => {
  const api = helpers();
  const active = activeReview();
  const rows = Array.from({ length: 1500 }, (_, index) => ({ amount_minor: index % 2 ? 3500 : 2500, currency: index % 2 ? "USD" : "GBP" }));
  const offsets = [];
  const client = { from(table) {
    assert.equal(table, "callout_approvals");
    return {
      select(columns, options) { assert.equal(options.count, "exact"); return this; },
      eq(field, value) { assert.equal(field, "organization_id"); assert.equal(value, company); return this; },
      gte(field, value) { assert.equal(field, "occurred_at"); assert.equal(value, active.uploads.callouts.from); return this; },
      lt(field, value) { assert.equal(field, "occurred_at"); assert.equal(value, active.uploads.callouts.to); return this; },
      order() { return this; },
      range: async offset => { offsets.push(offset); return { data: rows.slice(offset, offset + 500), count: rows.length, error: null }; },
    };
  } };
  const result = await api.reviewApprovalTotals(client, active);
  assert.equal(result.error, null);
  assert.deepEqual(offsets, [0, 500, 1000]);
  assert.deepEqual(result.data, [
    { currency: "GBP", approved_count: 750, total_minor: 1875000 },
    { currency: "USD", approved_count: 750, total_minor: 2625000 },
  ]);
});

test("an empty review never queries approvals, and query errors never become partial totals", async () => {
  const api = helpers();
  assert.deepEqual(await api.reviewApprovalTotals({ from() { throw new Error("Unexpected query"); } }, review.emptyReview()), { data: [], error: null });
  const failure = { message: "Temporary database error" };
  const query = { select() { return this; }, eq() { return this; }, gte() { return this; }, lt() { return this; }, order() { return this; },
    range: async () => ({ data: null, error: failure, count: null }) };
  assert.deepEqual(await api.reviewApprovalTotals({ from: () => query }, activeReview()), { data: [], error: failure });
});
