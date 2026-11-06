import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyReview, parseReview, reviewForLogin, sourceUpload, loadSource, reviewReady, inReview, reviewPeriod,
} from "../lib/review-workspace.ts";

const ops = "00000000-0000-4000-9000-000000000101";
const manager = "00000000-0000-4000-9000-000000000102";
const company = "00000000-0000-4000-9000-000000000201";
const otherCompany = "00000000-0000-4000-9000-000000000202";
const now = new Date("2026-11-06T10:30:00.000Z");
const callouts = [
  { dispatch_reference: "NL-202510-0001", occurred_at: "2025-10-04T08:24:00Z" },
  { dispatch_reference: "NL-202510-0172", occurred_at: "2025-10-31T21:24:00Z" },
];
const shifts = [
  { shift_reference: "NL-RS-20251031-CEN-NGT", starts_at: "2025-10-31T22:00:00Z", ends_at: "2025-11-01T06:00:00Z" },
];
const report = (received, inserted = received) => ({
  run_id: "00000000-0000-4000-9000-000000000501", status: "completed",
  received, inserted, duplicates: received - inserted, issue_count: 0, issues: [],
});

function preparedReview() {
  let review = loadSource(emptyReview(ops), ops, company, sourceUpload("shifts", "Roster.csv", shifts, report(1), now));
  return loadSource(review, ops, company, sourceUpload("callouts", "Dispatch.csv", callouts, report(2), now));
}

test("a fresh review has no loaded data or pre-filled counts", () => {
  const review = emptyReview(ops);
  assert.equal(review.organizationId, null);
  assert.deepEqual(review.uploads, {});
  assert.equal(reviewReady(review), false);
  assert.equal(inReview(review, company, callouts[0].occurred_at), false);
});

test("signing back in with the same account preserves the active review", () => {
  const previous = preparedReview();
  const next = reviewForLogin(previous, ops);
  assert.equal(next.id, previous.id);
  assert.deepEqual(next.uploads, previous.uploads);
  assert.equal(next.organizationId, company);
  assert.equal(previous.uploads.callouts.received, 2);
});

test("switching Operations to manager and back retains the review and row counts", () => {
  const previous = preparedReview();
  const managerReview = reviewForLogin(previous, manager);
  const opsReview = reviewForLogin(managerReview, ops);
  assert.equal(managerReview.lastUserId, manager);
  assert.equal(opsReview.lastUserId, ops);
  assert.equal(opsReview.id, previous.id);
  assert.deepEqual(opsReview.uploads, previous.uploads);
  assert.equal(reviewReady(opsReview), true);
});

test("starting a new review is the explicit way to clear the working view", () => {
  const previous = preparedReview();
  const next = emptyReview(ops);
  assert.notEqual(next.id, previous.id);
  assert.equal(next.organizationId, null);
  assert.deepEqual(next.uploads, {});
  assert.equal(previous.uploads.callouts.received, 2);
});

test("a roster upload retains the real upload time and the November overnight end", () => {
  const upload = sourceUpload("shifts", "Roster.csv", shifts, report(1), now);
  assert.equal(upload.from, "2025-10-31T00:00:00.000Z");
  assert.equal(upload.to, "2025-11-02T00:00:00.000Z");
  assert.equal(upload.uploadedAt, "2026-11-06T10:30:00.000Z");
  assert.equal(shifts[0].ends_at, "2025-11-01T06:00:00Z");
});

test("only successful uploads can populate the review", () => {
  assert.throws(() => sourceUpload("callouts", "Dispatch.csv", callouts, {
    ...report(2, 0), status: "rejected", duplicates: 0, issue_count: 1,
  }, now));
  assert.throws(() => sourceUpload("callouts", "Dispatch.csv", callouts, report(3), now));
});

test("a duplicate upload still loads the file and keeps saved-record counts truthful", () => {
  const previous = preparedReview();
  const upload = sourceUpload("callouts", "Renamed dispatch.csv", callouts, report(2, 0), now);
  const review = loadSource(previous, ops, company, upload);
  assert.equal(review.uploads.callouts.received, 2);
  assert.equal(review.uploads.callouts.inserted, 0);
  assert.equal(review.uploads.callouts.duplicates, 2);
  assert.equal(review.uploads.callouts.filename, "Renamed dispatch.csv");
  assert.deepEqual(review.uploads.shifts, previous.uploads.shifts);
  assert.equal(review.id, previous.id);
});

test("changing company does not reuse another company's loaded source files", () => {
  const review = loadSource(preparedReview(), ops, otherCompany, sourceUpload("callouts", "Other.csv", callouts, report(2), now));
  assert.equal(review.uploads.shifts, undefined);
  assert.equal(reviewReady(review), false);
  assert.equal(inReview(review, company, callouts[0].occurred_at), false);
});

test("register and export scope use company and half-open UTC date boundaries", () => {
  const review = preparedReview();
  assert.equal(inReview(review, company, "2025-10-04T00:00:00Z"), true);
  assert.equal(inReview(review, company, "2025-10-31T23:59:59Z"), true);
  assert.equal(inReview(review, company, "2025-10-03T23:59:59Z"), false);
  assert.equal(inReview(review, company, "2025-11-01T00:00:00Z"), false);
  assert.equal(inReview(review, otherCompany, callouts[0].occurred_at), false);
  assert.equal(inReview(review, company, "invalid"), false);
  assert.equal(reviewPeriod(review), "October 2025");
});

test("both files must cover a common period before matching or approval", () => {
  const review = preparedReview();
  assert.equal(reviewReady(review), true);
  const missing = { ...review, uploads: { callouts: review.uploads.callouts } };
  assert.equal(reviewReady(missing), false);
  const separate = {
    ...review,
    uploads: { ...review.uploads, shifts: { ...review.uploads.shifts, from: "2026-10-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" } },
  };
  assert.equal(reviewReady(separate), false);
});

test("working-view metadata survives reload without storing CSV rows in the cookie", () => {
  const review = preparedReview();
  const serialized = JSON.stringify(review);
  assert.deepEqual(parseReview(serialized), review);
  assert.ok(serialized.length < 3000);
  assert.equal(serialized.includes("NL-202510-0001"), false);
  assert.equal(serialized.includes("TECH-"), false);
});

test("missing, oversized, malformed, or inconsistent cookies open an empty review", () => {
  const valid = preparedReview();
  const invalid = [undefined, "", "not JSON", "null", "[]", "x".repeat(3001),
    JSON.stringify({ ...valid, organizationId: "other-company" }),
    JSON.stringify({ ...valid, uploads: { callouts: { ...valid.uploads.callouts, received: 500 } } }),
    JSON.stringify({ ...valid, uploads: { callouts: { ...valid.uploads.callouts, duplicates: 99 } } }),
    JSON.stringify({ ...valid, uploads: { callouts: { ...valid.uploads.callouts, from: "2025-02-30T00:00:00.000Z" } } }),
  ];
  for (const value of invalid) {
    const parsed = parseReview(value);
    assert.equal(parsed.organizationId, null);
    assert.deepEqual(parsed.uploads, {});
  }
  assert.equal(parseReview(undefined).id, parseReview(undefined).id);
});
