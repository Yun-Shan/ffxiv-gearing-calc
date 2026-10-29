import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { parsers } from "prettier/plugins/yaml";

const root = fileURLToPath(new URL("../../", import.meta.url));
const identityPath = "scripts/data-update/share-identities.json";
const changedMessage = "share-identities.json 修改后必须由人工手动构建";
const unbuiltMessage = "share-identities.json 的修改还未经人工手动构建";
const ast = parsers.yaml.parse(await readFile(join(root, ".github/workflows/deploy-pages.yml"), "utf8"));
const workflow = ast.children[0].children.find((node) => node.type === "documentBody").children[0];

function property(mapping, key) {
  assert.equal(mapping.type, "mapping");
  const item = mapping.children.find((node) => node.children[0].children[0].value === key);
  assert.ok(item, `Missing YAML property: ${key}`);
  return item.children[1].children[0];
}

const build = property(property(workflow, "jobs"), "build");
const steps = property(build, "steps").children.map((node) => node.children[0]);
const guard = steps.find((node) => node.children.some((item) =>
  item.children[0].children[0].value === "uses" && item.children[1].children[0].value === "actions/github-script@v9"));
assert.ok(guard, "The deployment guard must use actions/github-script@v9");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const script = property(property(guard, "with"), "script").value;
const check = new AsyncFunction("github", "context", "core", "exec", script);

let directory;
let initial;
let identities;
let code1;
let code2;

function git(...args) {
  const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function commit(files, message = "fixture") {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), content);
  }
  git("add", "-A");
  git("commit", "-m", message);
  return git("rev-parse", "HEAD");
}

before(async () => {
  const scratch = join(root, ".tmp", "deploy-pages-tests");
  await mkdir(scratch, { recursive: true });
  directory = await mkdtemp(join(scratch, "repo-"));
  git("init", "--initial-branch=main");
  git("config", "user.name", "Deployment test");
  git("config", "user.email", "deployment-test@example.invalid");
  git("config", "commit.gpgsign", "false");
  initial = await commit({ [identityPath]: "0", "src/app.js": "0" });
  identities = await commit({ [identityPath]: "1" }, "update identities");
  code1 = await commit({ "src/app.js": "1" });
  code2 = await commit({ "src/app.js": "2" });
});

after(async () => {
  if (directory) {
    assert.ok(directory.startsWith(join(root, ".tmp", "deploy-pages-tests", "repo-")));
    await rm(directory, { recursive: true, force: true });
  }
});

function run(id, sha, overrides = {}) {
  return {
    id, head_sha: sha, head_branch: "main", event: "workflow_dispatch", conclusion: "success",
    created_at: "2099-01-01T00:00:00Z",
    html_url: `https://github.com/example/project/actions/runs/${id}`, ...overrides,
  };
}

async function inspect({ history = [], beforeSha = code1, sha = code2, apiError, gitOutput } = {}) {
  const failures = [];
  const messages = [];
  const calls = { requests: [], git: [] };
  const actions = {
    listWorkflowRuns: async (parameters) => {
      calls.requests.push(parameters);
      assert.deepEqual(parameters, {
        owner: "example", repo: "project", workflow_id: "deploy-pages.yml", branch: "main",
        event: "workflow_dispatch", status: "success", created: parameters.created, per_page: 1,
      });
      assert.ok(parameters.created.startsWith(">="));
      const createdAfter = Date.parse(parameters.created.slice(2));
      assert.ok(Number.isFinite(createdAfter));
      if (apiError) throw apiError;
      const matches = history.filter((record) =>
        record.head_branch === parameters.branch && record.event === parameters.event &&
        record.conclusion === parameters.status && Date.parse(record.created_at) >= createdAfter,
      ).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
      // A direct REST call returns workflow_runs in an object, rather than a normalized pagination array.
      return { data: { total_count: matches.length, workflow_runs: matches.slice(0, parameters.per_page) } };
    },
  };
  await check(
    { rest: { actions } },
    { eventName: "push", sha, ref: "refs/heads/main", runId: 9999, repo: { owner: "example", repo: "project" }, payload: { before: beforeSha } },
    { setFailed: (message) => failures.push(message), info: (message) => messages.push(message) },
    { getExecOutput: async (command, args, options) => {
      assert.equal(command, "git");
      calls.git.push(args);
      const mocked = gitOutput?.(args);
      if (mocked) {
        if (mocked.exitCode !== 0 && !options.ignoreReturnCode) throw new Error(mocked.stderr);
        return mocked;
      }
      const result = spawnSync(command, args, { cwd: directory, encoding: "utf8" });
      if (result.error) throw result.error;
      if (result.status !== 0 && !options.ignoreReturnCode) throw new Error(result.stderr);
      return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
    } },
  );
  return { failures, messages, calls };
}

test("workflow permits manual runs and checks identities before building", () => {
  const events = property(workflow, "on");
  property(events, "workflow_dispatch");
  const paths = property(property(events, "push"), "paths").children.map((node) => node.children[0].value);
  assert.ok(!paths.includes(identityPath));
  assert.ok(paths.includes("scripts/vite-*.ts"));
  assert.equal(property(property(workflow, "permissions"), "actions").value, "read");
  assert.equal(property(property(steps[0], "with"), "fetch-depth").value,
    "${{ github.event_name == 'workflow_dispatch' && 1 || 0 }}");
  assert.equal(property(property(steps[0], "with"), "filter").value, "blob:none");
  assert.equal(steps.indexOf(guard), 1);
  assert.equal(property(property(property(workflow, "jobs"), "deploy"), "needs").value, "build");
});

test("manual runs skip the check step through the workflow condition", () => {
  assert.equal(property(guard, "if").value, "github.event_name != 'workflow_dispatch'");
  assert.doesNotMatch(script, /context\.eventName/);
});

test("a multi-commit push containing identity edits fails even when its head only changes code", async () => {
  const result = await inspect({ beforeSha: initial });
  assert.deepEqual(result.failures, [changedMessage]);
  assert.deepEqual(result.calls.requests, []);
});

test("initial branch creation containing identities requires a manual build", async () => {
  const result = await inspect({ beforeSha: "0".repeat(40) });
  assert.deepEqual(result.failures, [changedMessage]);
});

test("identity edits reverted in the same push pass the net diff and reach history validation", async () => {
  git("checkout", "-b", "revert", code2);
  await commit({ [identityPath]: "2" });
  const reverted = await commit({ [identityPath]: "1" });
  const result = await inspect({ beforeSha: code2, sha: reverted });
  assert.deepEqual(result.failures, [unbuiltMessage]);
  const built = await inspect({ beforeSha: code2, sha: reverted, history: [run(1, reverted)] });
  assert.deepEqual(built.failures, []);
  assert.equal(built.calls.requests.length, 1);
});

test("renaming the identities file is an identity update", async () => {
  git("checkout", "-b", "rename", code2);
  git("mv", identityPath, "scripts/data-update/identities-renamed.json");
  const renamed = await commit({ "src/app.js": "rename" });
  assert.deepEqual((await inspect({ beforeSha: code2, sha: renamed })).failures, [changedMessage]);
});

test("merging reverted feature edits preserves an already-built main identity", async () => {
  git("checkout", "-b", "identity-feature", code2);
  await commit({ [identityPath]: "3" });
  await commit({ [identityPath]: "1" });
  git("checkout", "-b", "identity-merge", code2);
  git("merge", "--no-ff", "identity-feature", "-m", "merge reverted identity edits");
  const result = await inspect({ beforeSha: code2, sha: git("rev-parse", "HEAD"), history: [run(1, code2)] });
  assert.deepEqual(result.failures, []);
});

test("code-only merges do not create false identity changes", async () => {
  git("checkout", "-b", "code-feature", code2);
  await commit({ "src/feature.js": "feature" });
  git("checkout", "-b", "code-merge", code2);
  git("merge", "--no-ff", "code-feature", "-m", "merge code only");
  const result = await inspect({ beforeSha: code2, sha: git("rev-parse", "HEAD"), history: [run(1, code2)] });
  assert.deepEqual(result.failures, []);
});

test("merging a feature that synced an already-built identity update does not block deployment", async () => {
  git("checkout", "-b", "synced-feature", initial);
  await commit({ "src/synced-feature.js": "feature" });
  git("merge", "--no-ff", code1, "-m", "sync already-built main into feature");
  git("checkout", "-b", "synced-feature-main", code1);
  git("merge", "--no-ff", "synced-feature", "-m", "merge synced feature into main");
  const merged = git("rev-parse", "HEAD");
  const history = [run(1, code1)];
  assert.deepEqual((await inspect({ beforeSha: code1, sha: merged, history })).failures, []);
  const head = await commit({ "src/app.js": "after synced feature merge" });
  assert.deepEqual((await inspect({ beforeSha: merged, sha: head, history })).failures, []);
});

test("fast-forwarding to a synced feature accepts a baseline on the merge's second-parent chain", async () => {
  git("checkout", "-b", "fast-forward-feature", initial);
  await commit({ "src/fast-forward-feature.js": "feature" });
  git("merge", "--no-ff", code1, "-m", "sync already-built main into feature");
  git("checkout", "-b", "fast-forward-main", code1);
  git("merge", "--ff-only", "fast-forward-feature");
  const merged = git("rev-parse", "HEAD");
  const history = [run(1, code1)];
  assert.deepEqual((await inspect({ beforeSha: code1, sha: merged, history })).failures, []);
  const head = await commit({ "src/app.js": "after synced feature fast-forward" });
  assert.deepEqual((await inspect({ beforeSha: merged, sha: head, history })).failures, []);
});

test("a reverted merge edit has no net diff but its latest file commit still needs a successful build", async () => {
  git("checkout", "-b", "novel-merge-feature", code2);
  await commit({ "src/novel-merge-feature.js": "feature" });
  git("checkout", "-b", "novel-merge-main", code2);
  git("merge", "--no-ff", "--no-commit", "novel-merge-feature");
  await commit({ [identityPath]: "merge-only identity" }, "resolve merge with new identity");
  const reverted = await commit({ [identityPath]: "1" });
  const history = [run(1, code2)];
  assert.deepEqual((await inspect({ beforeSha: code2, sha: reverted, history })).failures, [unbuiltMessage]);
  const head = await commit({ "src/app.js": "after merge identity revert" });
  assert.deepEqual((await inspect({ beforeSha: reverted, sha: head, history })).failures, [unbuiltMessage]);
  assert.deepEqual((await inspect({ beforeSha: reverted, sha: head, history: [run(2, reverted)] })).failures, []);
});

test("merges restoring a parent's built identity have no net change", async () => {
  git("checkout", "-b", "old-identity-feature", initial);
  await commit({ "src/old-identity-feature.js": "feature" });
  git("checkout", "-b", "old-identity-main", code2);
  git("merge", "--no-ff", "--no-commit", "old-identity-feature");
  await commit({ [identityPath]: "0" }, "select the old identity from the second parent");
  const oldIdentity = git("rev-parse", "HEAD");
  git("checkout", "-b", "restore-identity-feature", code2);
  await commit({ "src/restore-identity-feature.js": "feature" });
  git("checkout", "old-identity-main");
  git("merge", "--no-ff", "--no-commit", "restore-identity-feature");
  const restored = await commit({ [identityPath]: "1" }, "restore the identity from the second parent");
  const history = [run(1, code2)];
  assert.deepEqual((await inspect({ beforeSha: code2, sha: restored, history })).failures, []);
  assert.deepEqual((await inspect({ beforeSha: oldIdentity, sha: restored, history })).failures, [changedMessage]);
  const head = await commit({ "src/app.js": "after merge-only identity changes" });
  assert.deepEqual((await inspect({ beforeSha: restored, sha: head, history })).failures, []);
  assert.deepEqual((await inspect({ beforeSha: restored, sha: head, history: [run(2, restored)] })).failures, []);
});

test("the server filters branch, manual event, and whole-workflow success in one request", async () => {
  const history = [
    run(4, identities, { head_branch: "other" }),
    run(3, identities, { event: "push" }),
    run(2, identities, { conclusion: "failure" }),
    run(1, identities),
  ];
  const result = await inspect({ history });
  assert.deepEqual(result.failures, []);
  assert.equal(result.calls.requests.length, 1);
  const committedAt = git("show", "-s", "--format=%cI", identities);
  assert.equal(result.calls.requests[0].created, `>=${committedAt}`);
  assert.match(result.messages[0], /actions\/runs\/1/);
  assert.deepEqual(result.calls.git.map((args) => args[0]), ["diff", "log"]);
});

test("a later valid build uses only diff, combined metadata log, and one ancestry-range query", async () => {
  const result = await inspect({ history: [run(1, code1)] });
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.calls.git.map((args) => args[0]), ["diff", "log", "rev-list"]);
});

test("a merged side-branch commit that predates the identity change is outside the ancestry range", async () => {
  git("checkout", "-b", "pre-identity-side", initial);
  const side = await commit({ "src/pre-identity-side.js": "feature" });
  git("checkout", "-b", "main-with-pre-identity-side", code2);
  git("merge", "--no-ff", "pre-identity-side", "-m", "merge side branch without identity edits");
  const result = await inspect({ beforeSha: code2, sha: git("rev-parse", "HEAD"), history: [run(1, side)] });
  assert.deepEqual(result.failures, [unbuiltMessage]);
});

test("the creation-time lower bound excludes older runs and includes an exact timestamp match", async () => {
  const committedAt = git("show", "-s", "--format=%cI", identities);
  const old = run(1, identities, { created_at: "1970-01-01T00:00:00Z" });
  assert.deepEqual((await inspect({ history: [old] })).failures, [unbuiltMessage]);
  const result = await inspect({ history: [old, run(2, identities, { created_at: committedAt })] });
  assert.deepEqual(result.failures, []);
  assert.equal(result.calls.requests.length, 1);
});

test("a recently created success on an old commit still fails the ancestry check", async () => {
  const result = await inspect({ history: [run(1, initial)] });
  assert.deepEqual(result.failures, [unbuiltMessage]);
  assert.equal(result.calls.requests.length, 1);
});

test("a reverted historical identity edit still invalidates earlier successes", async () => {
  git("checkout", "-b", "historical-revert", code2);
  await commit({ [identityPath]: "4" });
  const reverted = await commit({ [identityPath]: "1" });
  const head = await commit({ "src/app.js": "after revert" });
  const result = await inspect({ beforeSha: reverted, sha: head, history: [run(1, code2)] });
  assert.deepEqual(result.failures, [unbuiltMessage]);
});

test("one matching run is enough even when many successful records exist", async () => {
  const history = Array.from({ length: 1001 }, (_, index) => run(index + 1, identities));
  const result = await inspect({ history });
  assert.deepEqual(result.failures, []);
  assert.equal(result.calls.requests.length, 1);
  assert.match(result.messages[0], /actions\/runs\/1001/);
});

test("descendant and unavailable run commits cannot supply evidence", async () => {
  for (const sha of [code2, "f".repeat(40)]) {
    const result = await inspect({ sha: code1, beforeSha: identities, history: [run(1, sha)] });
    assert.deepEqual(result.failures, [unbuiltMessage]);
    assert.equal(result.calls.requests.length, 1);
  }
});

test("an empty run SHA cannot match an empty ancestry range", async () => {
  const result = await inspect({ beforeSha: identities, sha: identities, history: [run(1, "")] });
  assert.deepEqual(result.failures, [unbuiltMessage]);
});

test("a build on a divergent commit cannot supply evidence even when it contains the latest identity", async () => {
  git("checkout", "-b", "divergent-build", identities);
  const divergent = await commit({ "src/divergent.js": "feature" });
  const result = await inspect({ history: [run(2, divergent), run(1, identities)] });
  assert.deepEqual(result.failures, [unbuiltMessage]);
  assert.equal(result.calls.requests.length, 1);
});

test("an invalid latest success fails without checking an older valid success", async () => {
  const history = [run(2, initial), run(1, identities)];
  const result = await inspect({ history });
  assert.deepEqual(result.failures, [unbuiltMessage]);
  assert.equal(result.calls.requests.length, 1);
});

test("failed workflows do not replace the latest successful manual workflow", async () => {
  const history = [run(2, identities, { conclusion: "failure" }), run(1, identities)];
  const result = await inspect({ history });
  assert.deepEqual(result.failures, []);
  assert.equal(result.calls.requests.length, 1);
});

test("a successful build inside a failed workflow does not meet status success", async () => {
  const record = run(1, identities, { conclusion: "failure", jobs: [{ name: "build", conclusion: "success" }] });
  const result = await inspect({ history: [record] });
  assert.deepEqual(result.failures, [unbuiltMessage]);
  assert.equal(result.calls.requests.length, 1);
});

test("missing successful build history fails with the required reason", async () => {
  const result = await inspect();
  assert.deepEqual(result.failures, [unbuiltMessage]);
  assert.equal(result.calls.requests.length, 1);
});

test("API failures propagate so github-script fails instead of deploying", async () => {
  await assert.rejects(inspect({ apiError: new Error("history unavailable") }), /history unavailable/);
});

test("force-pushing back across an identity change is detected by the tree diff", async () => {
  assert.deepEqual((await inspect({ beforeSha: identities, sha: initial })).failures, [changedMessage]);
});

test("a missing previous head is fetched before checking the push", async () => {
  let attempted = false;
  let fetched = false;
  const result = await inspect({
    beforeSha: initial,
    gitOutput: (args) => {
      if (args[0] === "diff" && !fetched) {
        attempted = true;
        return { exitCode: 128, stdout: "", stderr: "missing commit" };
      }
      // Fetch is an external operation; later history checks still use real Git commits.
      if (args[0] === "fetch") {
        assert.ok(attempted, "Try the comparison before fetching");
        assert.deepEqual(args, ["fetch", "--no-tags", "--filter=blob:none", "origin", initial]);
        fetched = true;
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      assert.ok(fetched, "Fetch must complete before reading the previous head");
    },
  });
  assert.ok(fetched);
  assert.deepEqual(result.failures, [changedMessage]);
});

test("a failed comparison retry propagates instead of allowing deployment", async () => {
  await assert.rejects(inspect({
    gitOutput: (args) => {
      if (args[0] === "diff") return { exitCode: 128, stdout: "", stderr: "comparison unavailable" };
      if (args[0] === "fetch") return { exitCode: 0, stdout: "", stderr: "" };
    },
  }), /comparison unavailable/);
});
