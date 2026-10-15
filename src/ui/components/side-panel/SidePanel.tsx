import type { ReactNode } from "react";
import { Button } from '@base-ui/react/button';

import styles from "./SidePanel.module.scss";

export function SidePanel(
  {
    className,
    title,
    subtitle,
    showStatus,
    status,
    statusText,
    showActionBtn,
    actionBtnDisable,
    actionBtnText,
    onAction,
    children,
  }: {
    className?: string,
    title?: string,
    subtitle?: string,
    showStatus?: boolean,
    status?: "ready" | "pending" | "error",
    statusText?: string,
    showActionBtn?: boolean,
    actionBtnDisable?: boolean,
    actionBtnText?: string,
    onAction?: () => void,
    children: ReactNode,
  }) {
  return (
    <div
      className={className ? `${styles.root} ${className}` : styles.root}
    >
      <header className={styles.header}>
        <span className={styles.eyebrow}>{subtitle}</span>
        <span className={styles.title}>{title}</span>
      </header>
      <div className={styles.content}>{children}</div>
      {
        showStatus
       ? <span className={styles.status} data-status={status}>{statusText}</span>
       : null
      }
      {
        showActionBtn
          ? <Button
              className={styles.actionBtn}
              disabled={actionBtnDisable}
              onClick={onAction}
            >
              {actionBtnText}
            </Button>
          : null
      }
      <div className={styles.footer}>
        <span>纯前端计算 · 可离线运行</span>
        {/*<button*/}
        {/*  type="button"*/}
        {/*  className={styles.advancedToggle}*/}
        {/*  disabled={!panel.advancedSettingsEnabled}*/}
        {/*  aria-expanded={advancedOpen && panel.advancedSettingsEnabled}*/}
        {/*  onClick={() => setAdvancedOpen((open) => !open)}*/}
        {/*>*/}
        {/*  高级设置*/}
        {/*</button>*/}
      </div>
    </div>
  );
}
