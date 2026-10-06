export function GearMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" focusable="false" aria-hidden="true">
      <rect x="0.75" y="0.75" width="16.5" height="16.5" rx="5" fill="var(--color-surface-subtle)" stroke="var(--color-illustration-outline)" />
      <path d="M5.1 7.1h7.8l-.85 6.05H5.95z" fill="var(--color-illustration-light)" stroke="var(--color-illustration-sage)" strokeWidth="0.8" />
      <path d="M7 7.1V6c0-1.1046.8954-2 2-2s2 .8954 2 2v1.1" fill="none" stroke="var(--color-illustration-sage)" strokeWidth="0.9" strokeLinecap="round" />
    </svg>
  );
}
