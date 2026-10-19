import { Fragment } from "react";
import { Breadcrumbs } from "@/ui/components/breadcrumbs/Breadcrumbs";
import styles from "./AboutPage.module.scss";

interface ProjectLink {
  name: string;
  href: string;
}

interface CommunityProject {
  links: readonly ProjectLink[];
  description: string;
}

const communityProjects: readonly CommunityProject[] = [
  {
    links: [
      {
        name: "Asvel / ffxiv-gearing",
        href: "https://github.com/Asvel/ffxiv-gearing",
      },
    ],
    description:
      "FFXIV 配装器，本项目的主要参考项目。MCP 缺少必需资料时以它的导出作为回退与核对来源；职业 schema、职业公式、同步品级分组与食物利用率公式也参考该项目。",
  },
  {
    links: [
      {
        name: "thewakingsands/xivapi-v2",
        href: "https://github.com/thewakingsands/xivapi-v2",
      },
    ],
    description:
      "社区维护的 FFXIV 数据 API。本项目通过其 CDN（xivapi-v2.xivcdn.com）按数字 ID 加载装备与职业图标，是游戏内图标资源的来源。",
  },
  {
    links: [
      { name: "Lumina", href: "https://github.com/NotAdam/Lumina" },
      { name: "EXDSchema", href: "https://github.com/xivdev/EXDSchema" },
    ],
    description:
      "社区解包项目，本项目通过 Lumina 读取 FFXIV 游戏内容数据（装备、职业、副本等 Sheet），数据表字段定义与核对使用 EXDSchema。",
  },
];

function ProjectCard({ project }: { project: CommunityProject }) {
  return (
    <li className={styles.card}>
      <div className={styles.cardHeading}>
        <div className={styles.projectLinks}>
          {project.links.map((link, index) => (
            <Fragment key={link.href}>
              {index > 0 ? (
                <span className={styles.separator} aria-hidden="true">
                  、
                </span>
              ) : null}
              <a href={link.href} target="_blank" rel="noreferrer">
                {link.name}
              </a>
            </Fragment>
          ))}
        </div>
      </div>
      <p>{project.description}</p>
    </li>
  );
}

export function AboutPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Breadcrumbs items={["关于"]} />
        <h1>关于自动配装器</h1>
      </header>

      <section className={styles.section} aria-labelledby="about-community">
        <h2 id="about-community">本项目依赖的社区项目</h2>
        <ul className={styles.cards}>
          {communityProjects.map((project) => (
            <ProjectCard key={project.links[0]!.href} project={project} />
          ))}
        </ul>
      </section>
    </main>
  );
}
