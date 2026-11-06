import type { ReviewWorkspace } from "./review-workspace";

export const importFormats = {
  callouts: ["dispatch_reference", "site_code", "technician_code", "occurred_at"],
  shifts: ["shift_reference", "site_code", "technician_code", "starts_at", "ends_at"],
} as const;

export type ImportKind = keyof typeof importFormats;
export type ImportRow = Record<string, string>;

export const importLabels: Record<ImportKind, string> = {
  callouts: "Dispatch callouts",
  shifts: "Shift roster",
};

export const maxImportRows = 250;
export const maxCsvKilobytes = 128;

export type ImportReport = {
  run_id: string;
  status: "completed" | "rejected";
  received: number;
  inserted: number;
  duplicates: number;
  issue_count: number;
  issues: { row: number; message: string }[];
};

export type ImportState = {
  status: "idle" | "completed" | "rejected" | "error";
  message: string;
  workspace?: ReviewWorkspace;
  report?: Omit<ImportReport, "issues"> & { issues: { line: number; message: string }[] };
};
