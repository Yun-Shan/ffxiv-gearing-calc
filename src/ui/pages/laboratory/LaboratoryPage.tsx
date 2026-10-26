import { Dialog } from '@base-ui/react/dialog';
import { type MouseEvent, useState } from 'react';
import { Breadcrumbs } from '@/ui/components/breadcrumbs/Breadcrumbs';
import { Link, useNavigate } from '@tanstack/react-router';
import { isPlainNavigation } from '@/ui/services/navigation';
import styles from './LaboratoryPage.module.scss';

type LabNoticeType = 'warning' | 'info';

interface LabNotice {
  type: LabNoticeType;
  message: string;
}

interface LabTool {
  href: '/joint' | '/gear-comparison';
  title: string;
  summary: string;
  details: string;
  notices: readonly LabNotice[];
}

const labTools: readonly LabTool[] = [
  {
    href: '/joint',
    title: '联合搜索',
    summary: '为多个职业共同搜索配装',
    details: '在共享装备与各职业条件下寻找联合方案。',
    notices: [],
  },
  {
    href: '/gear-comparison',
    title: '装备对比',
    summary: '比较同职业的多套配装',
    details: '从历史结果添加方案，查看核心指标与装备差异。',
    notices: [],
  },
];

function Card({
  href,
  title,
  summary,
  details,
  onOpen,
}: {
  href: '/joint' | '/gear-comparison';
  title: string;
  summary: string;
  details: string;
  onOpen(event: MouseEvent<HTMLAnchorElement>): void;
}) {
  return (
    <Link to={href} search={{}} className={styles.card} onClick={onOpen}>
      <strong className={styles.cardTitle}>{title}</strong>
      <span className={styles.cardSummary}>{summary}</span>
      <span className={styles.cardDetails}>{details}</span>
    </Link>
  );
}

export function LaboratoryPage() {
  const navigate = useNavigate();
  const [pendingTool, setPendingTool] = useState<LabTool>();

  function confirmNavigation() {
    if (!pendingTool) return;
    const href = pendingTool.href;
    setPendingTool(undefined);
    void navigate({ to: href, search: {} });
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Breadcrumbs items={['实验室']}/>
        <h1>选择实验性工具</h1>
      </header>
      <p className={`${styles.notice} ${styles.warning}`}>
        这里是一些尚不稳定，或仍存在已知问题，但可以作为预览使用的工具
      </p>
      <nav className={styles.cards} aria-label="实验室工具">
        {labTools.map((tool) => (
          <Card
            key={tool.href}
            href={tool.href}
            title={tool.title}
            summary={tool.summary}
            details={tool.details}
            onOpen={(event) => {
              if (tool.notices.length > 0 && isPlainNavigation(event, event.currentTarget.target)) {
                event.preventDefault();
                setPendingTool(tool);
              }
            }}
          />
        ))}
      </nav>
      <Dialog.Root
        open={pendingTool !== undefined}
        onOpenChange={(open) => {
          if (!open) setPendingTool(undefined);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className={styles.backdrop}/>
          <Dialog.Popup className={styles.dialog}>
            <Dialog.Title className={styles.dialogTitle}>
              {pendingTool ? `进入「${pendingTool.title}」` : '进入实验性工具'}
            </Dialog.Title>
            <ul className={styles.notices}>
              {pendingTool?.notices.map((notice) => (
                <li
                  key={notice.message}
                  className={`${styles.notice} ${styles[notice.type]}`}
                >
                  {notice.message}
                </li>
              ))}
            </ul>
            <div className={styles.actions}>
              <Dialog.Close className={styles.cancel}>取消</Dialog.Close>
              <button
                type="button"
                className={styles.confirm}
                onClick={confirmNavigation}
              >
                继续前往
              </button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </main>
  );
}
