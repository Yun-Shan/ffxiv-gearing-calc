import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compile } from "sass";
import type { Plugin } from "vite";
import { installAppShell } from "../src/ui/app/app-shell/app-shell.ts";

/** 启动外壳随 HTML 交付，开发和正式构建共用同一份标记、样式和控制逻辑。 */
export function appShellPlugin(projectRoot: string): Plugin {
  const shellDirectory = resolve(projectRoot, "src/ui/app/app-shell");
  return {
    name: "app-shell",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const markup = readFileSync(
          resolve(shellDirectory, "AppShell.html"),
          "utf8",
        );
        const css = compile(resolve(shellDirectory, "AppShell.module.scss"), {
          style: "compressed",
        }).css;
        // 外部应用样式不能阻塞内联外壳首屏；加载完成后由控制器启用。
        const deferredStyles = html.replace(/<link\b[^>]*>/g, (tag) => {
          if (
            !/\brel="stylesheet"/.test(tag) ||
            /\bdata-app-optional\b/.test(tag)
          )
            return tag;
          return tag
            .replace(/\s+media="[^"]*"/, "")
            .replace(/\s*\/?>$/, ' data-app-style="pending" media="print">');
        });
        // 字符编码声明必须仍在文件开头，不能被内联资源挤出前 1024 字节。
        const bootstrap = `<style id="app-shell-styles">${css}</style>\n<script>(${installAppShell.toString()})();</script>`;
        return deferredStyles
          .replace(
            /<meta charset="UTF-8"\s*\/?>/i,
            (charset) => `${charset}\n${bootstrap}`,
          )
          .replace("<body>", `<body>\n${markup}`);
      },
    },
  };
}
