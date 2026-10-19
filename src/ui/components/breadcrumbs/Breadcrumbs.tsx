import styles from "./Breadcrumbs.module.scss";

/**
 * 只展示当前路由所在位置，不提供点击导航；路由层负责按页面提供路径。
 */
export function Breadcrumbs({ items }: { items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <nav className={styles.root} aria-label="面包屑">
      <ol className={styles.list}>
        {items.map((item, index) => (
          <li
            key={item}
            className={styles.item}
            aria-current={index === items.length - 1 ? "page" : undefined}
          >
            {item}
          </li>
        ))}
      </ol>
    </nav>
  );
}
