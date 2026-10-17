import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const snapshotUrl = new URL(
  "../src/data/mcp-lumina.snapshot.json",
  import.meta.url,
);
const outputUrl = new URL(
  "../src/ui/services/generated/job-icons.json",
  import.meta.url,
);

export async function generateUiJobIcons(snapshot) {
  snapshot ??= JSON.parse(await readFile(snapshotUrl, "utf8"));
  const rows = new Map(snapshot.rows.ClassJob.map((row) => [row.rowId, row]));
  const icons = {};
  for (const [job, id] of Object.entries(snapshot.queryPlan.classJobIds)) {
    const row = rows.get(id);
    if (
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      id >= 100 ||
      row?.gameVersion !== snapshot.gameVersion
    )
      throw new Error(`Missing same-version ClassJob row for ${job}`);
    icons[job] = 62100 + id;
  }
  await mkdir(new URL("./", outputUrl), { recursive: true });
  await writeFile(
    outputUrl,
    JSON.stringify({
      generatedBy: "scripts/generate-ui-job-icons.mjs",
      source: "src/data/mcp-lumina.snapshot.json",
      sheet: "ClassJob",
      gameVersion: snapshot.gameVersion,
      queriedAt: snapshot.queriedAt,
      icons,
    }) + "\n",
  );
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  await generateUiJobIcons();
