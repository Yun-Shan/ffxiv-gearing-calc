# Recovering a Penpot MCP heartbeat timeout

Read this only after a Penpot MCP call reports a heartbeat timeout, a suspended plugin page, or a similar missing-response error. The request may already have executed. Do not immediately resend a design-changing call.

Before using any browser-console or unsafe-code capability, inspect the current Playwright tools and documentation. The tool identifier and page APIs in older workflows may have changed; use only a currently exposed tool whose documented interface supports the needed operations. If it does not, inspect the design state through available read-only methods before deciding whether to retry.

If the first timeout happened without a recorded pre-call console count, inspect the design state first; historical console matches cannot establish this call result. When preparing a later call or an authorized retry, use the following capture procedure:

1. Preserve its exact task name and full parameters. For code execution, preserve the complete code string.
2. In the same connected Penpot Playwright page, record the current console message count before the MCP request. Use the current documented way to read the page's console messages.
3. After a heartbeat error, inspect only messages added after that count. Match the incoming MCP request by exact task and parameters, then match its response by request ID.
4. Treat data as the call result only if the matching response reports success. A matching error is an error. A missing match is not evidence of success or failure.
5. If no successful matching response is available, read the current Penpot design state before retrying. Retry a mutating call only after determining whether its effect already landed; otherwise a repeated write may duplicate the change.

The following parser is a reference for environments where the current Playwright page API still provides `consoleMessages()`, `ConsoleMessage.args()`, and argument `jsonValue()`. Verify all three against current tool documentation before running it. Replace `beforeCount` and `expectedParams` with the exact values from the affected call.

```js
async (page) => {
  const beforeCount = 123;
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
      requestIndex = index;
    }
  }

  if (!request) {
    return { matched: false, reason: "No new MCP request matched the exact task and parameters." };
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
      // Ignore unrelated console messages whose arguments cannot be read.
    }
  }

  if (!response) {
    return {
      matched: true,
      requestId: request.id,
      responseReceived: false,
      reason: "The matching request was found, but no response with its request ID was found.",
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
