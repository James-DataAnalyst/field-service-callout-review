import type { ImportKind, ImportReport, ImportRow } from "./imports";

export type SourceUpload = {
  kind: ImportKind;
  filename: string;
  received: number;
  inserted: number;
  duplicates: number;
  uploadedAt: string;
  from: string;
  to: string;
};

export type ReviewWorkspace = {
  version: 1;
  id: string;
  lastUserId: string | null;
  organizationId: string | null;
  uploads: Partial<Record<ImportKind, SourceUpload>>;
};

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const isDate = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export function emptyReview(lastUserId: string | null = null, id = crypto.randomUUID()): ReviewWorkspace {
  return { version: 1, id, lastUserId, organizationId: null, uploads: {} };
}

const invalidReview = () => emptyReview(null, "00000000-0000-4000-8000-000000000000");

// This cookie describes a working view. Supabase remains the authority for access and saved records.
export function parseReview(value: string | undefined): ReviewWorkspace {
  if (!value || value.length > 3000) return invalidReview();
  try {
    const review: ReviewWorkspace = JSON.parse(value);
    if (review.version !== 1 || !uuid.test(review.id) || !review.uploads || Array.isArray(review.uploads)
      || (review.lastUserId !== null && !uuid.test(review.lastUserId))
      || (review.organizationId !== null && !uuid.test(review.organizationId))) return invalidReview();
    for (const kind of Object.keys(review.uploads)) {
      if (kind !== "callouts" && kind !== "shifts") return invalidReview();
      const upload = review.uploads[kind];
      if (!upload || upload.kind !== kind || typeof upload.filename !== "string" || upload.filename.length > 160
        || !Number.isInteger(upload.received) || upload.received < 1 || upload.received > 250
        || !Number.isInteger(upload.inserted) || upload.inserted < 0
        || !Number.isInteger(upload.duplicates) || upload.duplicates < 0
        || upload.received !== upload.inserted + upload.duplicates
        || !isDate(upload.uploadedAt) || !isDate(upload.from) || !isDate(upload.to)
        || upload.from >= upload.to || !review.organizationId) return invalidReview();
    }
    return review;
  } catch {
    return invalidReview();
  }
}

export function reviewForLogin(review: ReviewWorkspace, userId: string) {
  return { ...review, lastUserId: userId };
}

export function sourceUpload(kind: ImportKind, filename: string, rows: ImportRow[], report: ImportReport, now = new Date()): SourceUpload {
  if (report.status !== "completed" || report.received !== rows.length
    || report.received !== report.inserted + report.duplicates) throw new Error("Only a completed upload can open a review.");
  const times = rows.flatMap(row => kind === "callouts" ? [row.occurred_at] : [row.starts_at, row.ends_at]).map(Date.parse);
  if (!times.length || times.some(time => !Number.isFinite(time))) throw new Error("The upload needs valid UTC dates.");
  const from = new Date(Math.min(...times));
  from.setUTCHours(0, 0, 0, 0);
  const to = new Date(Math.max(...times));
  to.setUTCHours(0, 0, 0, 0);
  to.setUTCDate(to.getUTCDate() + 1);
  return {
    kind, filename: filename.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 160),
    received: report.received, inserted: report.inserted, duplicates: report.duplicates,
    uploadedAt: now.toISOString(), from: from.toISOString(), to: to.toISOString(),
  };
}

export function loadSource(review: ReviewWorkspace, userId: string, organizationId: string, upload: SourceUpload): ReviewWorkspace {
  return {
    version: 1, id: review.id, lastUserId: userId, organizationId,
    uploads: { ...(review.organizationId === organizationId ? review.uploads : {}), [upload.kind]: upload },
  };
}

export function reviewReady(review: ReviewWorkspace) {
  const { callouts, shifts } = review.uploads;
  return Boolean(review.organizationId && callouts && shifts && callouts.from < shifts.to && shifts.from < callouts.to);
}

export function inReview(review: ReviewWorkspace, organizationId: string, occurredAt: string) {
  const period = review.uploads.callouts;
  const time = Date.parse(occurredAt);
  return Boolean(period && organizationId === review.organizationId
    && time >= Date.parse(period.from) && time < Date.parse(period.to));
}

export function reviewPeriod(review: ReviewWorkspace) {
  const period = review.uploads.callouts ?? review.uploads.shifts;
  if (!period) return "";
  const first = new Date(period.from);
  const last = new Date(Date.parse(period.to) - 1);
  if (first.getUTCFullYear() === last.getUTCFullYear() && first.getUTCMonth() === last.getUTCMonth()) {
    return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(first);
  }
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${date.format(first)} to ${date.format(last)}`;
}
