import generated from "./generated/item-icons.json";
export const itemIconDataVersion = generated.gameVersion;
const icons: Readonly<Record<string, number>> = generated.icons;
export function itemIconId(itemId: number | undefined): number | undefined {
  return itemId === undefined ? undefined : icons[String(itemId)];
}
