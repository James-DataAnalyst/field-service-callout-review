import Link from "next/link";
import { reviewPeriod, type ReviewWorkspace } from "../lib/review-workspace";

export function ReviewContext({ review, canImport }: { review: ReviewWorkspace; canImport: boolean }) {
  const period = reviewPeriod(review);
  return period ? (
    <p className="review-detail">Active review · {period}</p>
  ) : (
    <p className="notice review-empty">
      {canImport ? <>Start a review by uploading the source files. <Link href="/imports">Open imports</Link></>
        : "Operations has not loaded an active review in this browser yet."}
    </p>
  );
}
