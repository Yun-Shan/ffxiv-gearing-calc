import styles from "./AppHeader.module.scss";
import { Link, useRouter } from "@tanstack/react-router";
import { isPlainNavigation } from "@/ui/services/navigation";
import { applicationBase } from "@/ui/services/application-base";
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
  href: "/single" | "/lab" | "/faq" | "/about";
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
  const router = useRouter();
  return items.map((item) => (
    <Link
      key={item.page}
      to={item.href}
      search={{}}
      onClick={event => {
        if (item.page === "single" && isPlainNavigation(event, event.currentTarget.target)) router.options.context.workflow.reset("single");
      }}
      className={`${styles.navLink} ${page === item.page ? styles.active : ""}`}
      aria-current={page === item.page ? "page" : undefined}
    >
      {item.label}
    </Link>
  ));
}

export function AppHeader({ page, mobileResult = false }: { page: AppPage; mobileResult?: boolean }) {
  return (
    <header className={`${styles.header} ${mobileResult ? styles.mobileResult : ""}`}>
      <div className={styles.brand}>
        <img className={styles.mark} src={`${applicationBase()}icons/logo-128.png`} alt="" />
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
