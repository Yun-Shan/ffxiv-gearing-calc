import type { ReactNode } from "react";
import styles from "./FaqItem.module.scss";

export interface FaqItemProps {
  question: string;
  answer: ReactNode;
}

export function FaqItem({ question, answer }: FaqItemProps) {
  return (
    <article className={styles.item}>
      <h2 className={styles.question}>{question}</h2>
      <div className={styles.answer}>
        {typeof answer === "string" ? <p>{answer}</p> : answer}
      </div>
    </article>
  );
}
