import generated from "./generated/gear-icons.json";
export const equipmentIconDataVersion = generated.gameVersion;
const icons: Readonly<Record<string, number>> = generated.icons;
export function equipmentIconId(
  itemId: number | undefined,
): number | undefined {
  return itemId === undefined ? undefined : icons[String(itemId)];
}
