import { Breadcrumbs } from "@/ui/components/breadcrumbs/Breadcrumbs";
import { FaqItem } from "./components/faq-item/FaqItem";
import { faqEntries } from "./faq-content";
import styles from "./FaqPage.module.scss";
export function FaqPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Breadcrumbs items={["常见问题"]} />
        <h1>常见问题</h1>
      </header>
      <section className={styles.list} aria-label="常见问题列表">
        {faqEntries.map((entry) => (
          <FaqItem
            key={entry.question}
            question={entry.question}
            answer={entry.answer}
          />
        ))}
      </section>
    </main>
  );
}
