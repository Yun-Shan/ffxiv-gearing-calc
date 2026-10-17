import type { ReactNode } from "react";
import styles from "./SidePanel.module.scss";
function Root({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <aside className={`${styles.root} ${className ?? ""}`}>{children}</aside>
  );
}
function Header({
  children,
  title,
  subtitle,
}: {
  children?: ReactNode;
  title?: string;
  subtitle?: string;
}) {
  return (
    <header className={styles.header}>
      {subtitle && <span className={styles.eyebrow}>{subtitle}</span>}
      {title && <strong className={styles.title}>{title}</strong>}
      {children}
    </header>
  );
}
function Content({ children }: { children: ReactNode }) {
  return <div className={styles.content}>{children}</div>;
}
function Section({ children }: { children: ReactNode }) {
  return <section className={styles.section}>{children}</section>;
}
function Rows({ children }: { children: ReactNode }) {
  return <div className={styles.rows}>{children}</div>;
}
function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <span>{label}</span>
      <span>{children}</span>
    </div>
  );
}
function Status({
  children,
  status,
}: {
  children: ReactNode;
  status?: string;
}) {
  return (
    <p className={styles.status} data-status={status} role="status">
      {children}
    </p>
  );
}
function Actions({ children }: { children: ReactNode }) {
  return <div className={styles.actions}>{children}</div>;
}
function Footer({ children }: { children?: ReactNode }) {
  return (
    <footer className={styles.footer}>
      <div>{children}</div>
      <span>纯前端计算 · 可离线运行</span>
    </footer>
  );
}
export const SidePanel = Object.assign(Root, {
  Header,
  Content,
  Section,
  Rows,
  Row,
  Status,
  Actions,
  Footer,
});
