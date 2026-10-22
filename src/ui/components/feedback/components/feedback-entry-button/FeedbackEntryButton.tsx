import type { ReactNode } from "react";
import { useFeedback } from "../../FeedbackProvider";

export function FeedbackEntryButton({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { openProblemFeedback } = useFeedback();
  return (
    <button
      type="button"
      className={className}
      onClick={openProblemFeedback}
      aria-haspopup="dialog"
    >
      {children}
    </button>
  );
}
