import styles from "./AppHeader.module.scss";
import { routeHref } from "@/ui/services/navigation";
import { FeedbackEntryButton } from "@/ui/components/feedback/components/feedback-entry-button/FeedbackEntryButton";

export type AppPage =
  | "single"
  | "lab"
  | "joint"
  | "gear-comparison"
  | "faq"
  | "about";

interface NavItem {
  page: AppPage;
  href: string;
  label: string;
}

const primaryNavItems: readonly NavItem[] = [
  { page: "single", href: "/single", label: "单职业搜索" },
  { page: "lab", href: "/lab", label: "实验室" },
];

const secondaryNavItems: readonly NavItem[] = [
  { page: "faq", href: "/faq", label: "常见问题" },
  { page: "about", href: "/about", label: "关于" },
];

function NavLinks({
  items,
  page,
}: {
  items: readonly NavItem[];
  page: AppPage;
}) {
  return items.map((item) => (
    <a
      key={item.page}
      href={routeHref(item.href)}
      className={`${styles.navLink} ${page === item.page ? styles.active : ""}`}
      aria-current={page === item.page ? "page" : undefined}
    >
      {item.label}
    </a>
  ));
}

export function AppHeader({ page }: { page: AppPage }) {
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <img className={styles.mark} src={`${import.meta.env.BASE_URL}icons/logo-128.png`} alt="" />
        <div className={styles.name}>
          <span>最终幻想14</span>
          <span>自动配装器</span>
        </div>
      </div>
      <nav className={styles.nav} aria-label="主导航">
        <NavLinks items={primaryNavItems} page={page} />
        <span className={styles.spacer} aria-hidden="true" />
        <NavLinks items={secondaryNavItems} page={page} />
        <FeedbackEntryButton className={`${styles.navLink} ${styles.feedbackButton}`}>支持与反馈</FeedbackEntryButton>
      </nav>
    </header>
  );
}
