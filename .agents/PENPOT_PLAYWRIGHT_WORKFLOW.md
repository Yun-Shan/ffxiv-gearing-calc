# Penpot 与 Playwright 工作流

本文规范本项目读取 Penpot 设计、生成 Tailwind HTML、核对实际渲染，以及恢复 Penpot MCP 回传超时的操作流程。项目的宏观视觉方向见 [前端设计总览](../docs/前端设计总览.md)；页面、画板、图层、文字和属性的具体事实以 Penpot 为准。

## 工具和会话约束

- 只能在 Playwright 中打开和操作 Penpot 页面。不要用内置浏览器、CUA 或其他浏览器会话打开同一 Penpot 文件，以免打断 MCP 插件连接。
- 同一时刻只允许一个 agent 控制 Playwright。交接控制权前先结束原控制者的浏览器操作；新控制者在 Playwright 中重新打开指定 Penpot 页面并确认 MCP 插件已连接。
- 开始调用 Penpot MCP 前先阅读其 High-level Overview。工具文档或返回数据是操作依据；不要凭记忆猜测 Penpot API 的成员或结果结构。
- 复用当前已连接的 Penpot Playwright 标签页。读取本地应用时可使用同一 Playwright 会话中的另一标签页，但仍由同一 agent 控制。

## 结构化读取

先定位目标页面和画板，再逐个画板或图层子树读取。不要一次导出整份文件或整页完整对象图；大画板和嵌套组件应拆成多个可复核的查询批次。

先运行最短的查询确认插件连接和返回，再一次只增加一种查询复杂度。观察实际调用时间；接近 15 秒时停止扩展，超过 15 秒后不要继续增加复杂度，应缩小到单个画板、单个子树或更少的属性组。

读取结果必须包含层级以及实现和验收需要的实际属性，不能只保留节点名称。按需读取文字内容、节点类型、画板内几何、可见性、填充、描边、字体和文字样式、圆角、阴影、布局模式、间距、对齐、约束、组件/变体引用、token 和子节点顺序。保留 Penpot 返回的原值；概览统计不能代替原始属性。

递归遍历 Penpot 对象时必须做循环与重复引用检测：

- 用 `WeakSet` 记录已访问的对象引用，遇到同一对象时停止继续递归。
- 同时用节点 ID 记录已输出的图层；遇到已输出 ID 时保留引用信息但不重复展开其子树。
- 记录深度或节点数上限作为第二道保护；达到上限时明确标注截断位置，不把截断结果说成完整结构。
- 只遍历目标画板下的子节点，不递归遍历整个 Penpot 插件对象、父子反向引用或整个文件图。
- 输出时保留子节点顺序和原始属性；不要因去重而丢失合法的共享组件引用。

每批结果都应能对应到 Penpot 页面、画板和图层路径。保留原始结构化结果供实现与验收复核；不要只保存经过人为改写的摘要。

## Tailwind HTML 与渲染核对

使用仓库中的 `.agents/penpot-tailwind-html-once.template.js` 获取目标组件或画板的 Tailwind HTML。先按模板设置目标页面和图层路径，再在已经连接 Penpot 的 Playwright 页面中执行；每次针对明确的局部目标，不把整个文件的大型根节点作为一次性输入。

Tailwind HTML 是实现起点，不是设计事实的替代品。整理类名、拆分 React 组件、提取全局 token 和局部样式时，最终内容、布局和可见效果仍须与 Penpot 结构化属性和渲染一致。

视觉验收时使用 Playwright 在 Penpot 的目标画板视口捕获实现页面，并与对应 Penpot 画板的渲染直接比较。画板外的编辑器工具栏、选中框、缩放比例和滚动位置不能混入参考图；优先使用画板导出，若只能通过编辑器截图取证，则先确认画板完整可见且缩放已知。结构验收还应比较实现 DOM 几何和计算样式，不能仅凭截图判断。

使用 Penpot 中实际存在的画板视口。没有画板的尺寸或状态不作精确匹配声明，也不从桌面稿自行推导移动端设计。

## MCP 心跳超时与结果恢复

### 适用情况

当 `mcp__penpot__execute_code` 报告插件页 suspended、heartbeat timeout 或类似心跳错误时，不要立即重发可能产生修改的命令。插件可能已经收到并执行了命令，只是 MCP 调用端没有拿到回传结果；重发可能造成重复修改。

### 操作步骤（仅在出现过心跳错误后使用；恢复正常后停止 fallback）

1. 保存即将发送的 Penpot MCP 任务类型和完整参数。对 `execute_code`，任务类型为 `executeCode`，参数中的 `code` 必须保留原样，包括空格和标点。
2. 在发起 MCP 调用前，用 Playwright unsafe code 记录当前控制台消息数量，作为日志起点：

   ```js
   async (page) => ({ consoleCount: (await page.consoleMessages()).length })
   ```

3. 发起 Penpot MCP 调用。如果调用报心跳超时，在同一个 Playwright Penpot 页面中运行下方解析模板。把 `beforeCount` 替换为步骤 2 得到的数量，并把 `expectedParams.code` 替换为刚才调用时使用的完整代码。
4. 模板会从起点之后的日志中查找 `Received from MCP server` 记录，严格核对任务类型和参数，再按该记录的 request ID 查找对应的 `Sent response to MCP server` 记录。
5. 只有匹配到相同任务、相同参数、相同 request ID 且 `success: true` 的回传时，才把 `response.data` 当作该次 MCP 调用结果使用。若 `success` 为 `false`，按回传的 `error` 处理。若没有匹配的请求或响应，不要把旧日志当成结果；等待插件完成后重新读取日志，并先核对设计状态再决定是否重发修改命令。

### Playwright unsafe code 模板

将以下函数作为 `mcp__playwright__browser_run_code_unsafe` 的 `code` 参数运行。示例中的 `code` 仅为占位内容，必须替换成发生超时的那次调用的原始参数：

```js
async (page) => {
  const beforeCount = 123; // 替换为发起 MCP 调用前记录的 consoleCount
  const expectedTask = "executeCode";
  const expectedParams = {
    code: "return { tag: 'replace-with-the-exact-code' };",
  };

  const canonical = (value) => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
        .join(",")}}`;
    }
    return JSON.stringify(value);
  };

  const messages = (await page.consoleMessages()).slice(beforeCount);
  let request = null;
  let requestIndex = -1;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message.text().startsWith("Received from MCP server:")) continue;

    const args = message.args();
    if (args.length < 2) continue;

    let candidate;
    try {
      candidate = JSON.parse(await args[1].jsonValue());
    } catch {
      continue;
    }

    if (
      candidate.task === expectedTask &&
      canonical(candidate.params) === canonical(expectedParams)
    ) {
      request = candidate;
      requestIndex = index; // 若有重复参数，使用日志中最新的匹配请求
    }
  }

  if (!request) {
    return { matched: false, reason: "没有找到参数完全匹配的新 MCP 请求" };
  }

  let response = null;
  for (const message of messages.slice(requestIndex + 1)) {
    if (!message.text().startsWith("Sent response to MCP server:")) continue;

    const args = message.args();
    if (args.length < 2) continue;

    try {
      const candidate = await args[1].jsonValue();
      if (candidate.id === request.id) response = candidate;
    } catch {
      // 忽略无法读取参数的无关控制台消息。
    }
  }

  if (!response) {
    return {
      matched: true,
      requestId: request.id,
      responseReceived: false,
      reason: "找到了对应请求，但尚未找到同一 request ID 的回传",
    };
  }

  return {
    matched: true,
    requestId: request.id,
    task: request.task,
    params: request.params,
    success: response.success,
    data: response.data,
    error: response.error,
  };
}
```

### 判定要点

- 使用调用前记录的消息数量，只检查该次调用之后新增的控制台记录，避免误用历史上参数相同的结果。
- 任务类型和参数必须完整匹配；对 `executeCode` 要比较完整 `code` 字符串，不能只凭相同的标题、片段或操作意图判断。
- `ConsoleMessage.text()` 会把对象缩写成 `[Object]`。提取真实请求和响应时应使用 `message.args()`，再对对应参数调用 `jsonValue()`。
- 必须用请求 ID 将 `Received from MCP server` 和 `Sent response to MCP server` 配对。浏览器里出现“执行成功”日志，但没有相同 ID 的成功回传时，不能视作 MCP 调用结果。
- 对修改设计的调用，即使恢复到成功回传，也应再读取相关画板或组件状态，确认修改实际落盘；没有匹配回传时先检查状态，避免重复执行非幂等操作。
