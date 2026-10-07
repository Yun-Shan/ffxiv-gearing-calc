import type { ReactNode } from "react";
import styles from "./SingleWorkbenchLayout.module.css";

const penpotLayoutUtilities = [
  "box-border mx-auto flex min-h-0 h-[calc(100vh-72px)] w-full max-w-[1920px] items-stretch gap-[clamp(41px,_calc(29.8vw_-_388px),_184px)] overflow-hidden pl-[clamp(41px,_calc(29.8vw_-_388px),_184px)]",
  "max-[1439px]:grid max-[1439px]:h-[calc(100vh-72px)] max-[1439px]:max-w-[1520px] max-[1439px]:grid-cols-[minmax(0,1fr)_306px] max-[1439px]:gap-[17px] max-[1439px]:px-[22px]",
  "max-[1199px]:flex max-[1199px]:h-auto max-[1199px]:min-h-[calc(100vh-60px)] max-[1199px]:flex-col max-[1199px]:gap-[18px] max-[1199px]:overflow-visible",
  "max-[760px]:gap-[16px] max-[760px]:px-[16px] max-[760px]:pt-[18px] max-[760px]:pb-0",
].join(" ");

export function SingleWorkbenchLayout({
  main,
  sidebar,
}: {
  main: ReactNode;
  sidebar: ReactNode;
}) {
  return <div className={`${styles.layout} single-workbench-layout ${penpotLayoutUtilities}`}>{main}{sidebar}</div>;
}

export function SingleWorkbenchFlow({ children, workbench = false }: { children: ReactNode; workbench?: boolean }) {
  return <main className={workbench ? styles.flow : "single-flow"}>{children}</main>;
}
