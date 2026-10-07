import type { ReactNode } from "react";

export function SinglePageSidePanel({
  ariaLabel,
  className,
  children,
}: {
  ariaLabel: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <aside
      className={className ? `single-page-side-panel ${className}` : "single-page-side-panel"}
      aria-label={ariaLabel}
    >
      {children}
    </aside>
  );
}
