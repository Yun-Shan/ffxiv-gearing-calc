import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const snapshotUrl = new URL(
  "../src/data/mcp-lumina.snapshot.json",
  import.meta.url,
);
const outputUrl = new URL(
  "../src/ui/services/generated/gear-icons.json",
  import.meta.url,
);

/** UI metadata only; the domain binary and game rules are unchanged. */
export async function generateUiGearIcons(snapshot, itemIds) {
  snapshot ??= JSON.parse(await readFile(snapshotUrl, "utf8"));
  itemIds ??= snapshot.queryPlan.gearItemIds;
  const rows = new Map(snapshot.rows.Item.map((row) => [row.rowId, row]));
  const icons = {};
  for (const id of [...new Set(itemIds)].sort((a, b) => a - b)) {
    const row = rows.get(id);
    if (
      row?.gameVersion !== snapshot.gameVersion ||
      !Number.isSafeInteger(row?.fields.Icon) ||
      row.fields.Icon <= 0
    )
      throw new Error(`Missing same-version Item.Icon for equipment ${id}`);
    icons[id] = row.fields.Icon;
  }
  await mkdir(new URL("./", outputUrl), { recursive: true });
  await writeFile(
    outputUrl,
    JSON.stringify({
      generatedBy: "scripts/generate-ui-gear-icons.mjs",
      source: "src/data/mcp-lumina.snapshot.json",
      sheet: "Item",
      field: "Icon",
      gameVersion: snapshot.gameVersion,
      queriedAt: snapshot.queriedAt,
      icons,
    }) + "\n",
  );
  return Object.keys(icons).length;
}
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  console.log(
    `Generated UI icons for ${await generateUiGearIcons()} equipment items.`,
  );
}
