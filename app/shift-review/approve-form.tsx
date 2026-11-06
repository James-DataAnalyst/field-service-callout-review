"use client";

import { useActionState } from "react";
import type { ApprovalState } from "../../lib/approvals";
import { approveCallout } from "./approval-action";

const initialState: ApprovalState = { status: "idle", message: "" };

export function ApproveForm({ calloutId, shiftId, dispatch }: {
  calloutId: string;
  shiftId: string;
  dispatch: string;
}) {
  const [state, action, pending] = useActionState(approveCallout, initialState);

  return (
    <form action={action} aria-busy={pending}>
      <input type="hidden" name="callout_id" value={calloutId} />
      <input type="hidden" name="shift_id" value={shiftId} />
      {state.status !== "success" && (
        <button type="submit" className="approve-button" disabled={pending} aria-label={`Approve ${dispatch}`}>
          {pending ? "Approving…" : "Approve"}
        </button>
      )}
      {state.status !== "idle" && (
        <p className={state.status === "error" ? "review-detail approval-error" : "review-detail"} role="status">
          {state.message}
        </p>
      )}
    </form>
  );
}
