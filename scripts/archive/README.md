# 算法探索归档

本目录保留已经结束的算法探索源码、对照测试、日志和报告，供查阅历史决策与结果。它不是当前测试或验收入口，不参与构建类型检查；生产算法、候选构造和游戏公式以 `src/domain` 为准。

当前 Node 测试与验收包装位于 `scripts/node-tests`，常用命令在仓库根目录的 `package.json` 中。归档内容不由这些入口、生产代码或 npm 脚本调用。

## 手动复现

没有统一的归档运行命令。需要检查某项历史探索时，先阅读对应源码和报告，确认其依赖的数据版本、参考仓库和 MCP 环境，再从仓库根目录手动执行所需文件。例如单独运行一个历史 Node 测试文件：

```powershell
node --experimental-strip-types --test scripts/archive/<相对路径>.test.ts
```

运行单个历史 TypeScript 实验时，可以按其依赖使用 Node 的类型剥离入口：

```powershell
node --experimental-strip-types scripts/archive/<相对路径>.ts
```

占位路径需要替换为具体文件。归档脚本可能依赖旧版 MCP 可执行文件、本地 `reference/ffxiv-gearing` 检出或已经移除的运行参数；这些历史运行不代表当前项目验收结果。正式算法验收请使用 `npm run data:test:v3`。
