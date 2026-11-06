export type ApprovalSnapshot = {
  callout_id: string;
  organization_id: string;
  site_id: string;
  shift_id: string;
  organization_name: string;
  site_name: string;
  dispatch_reference: string;
  technician_code: string;
  occurred_at: string;
  shift_reference: string;
  shift_starts_at: string;
  shift_ends_at: string;
  amount_minor: number;
  currency: string;
  approved_by: string | null;
  approver_label: string;
  approved_at: string;
};

export type ApprovalResult = Pick<ApprovalSnapshot, "approved_at" | "amount_minor" | "currency"> & {
  created: boolean;
};

export type ApprovalState = { status: "idle" | "success" | "error"; message: string };

export function formatAllowance(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}
