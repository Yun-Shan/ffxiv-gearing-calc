import { foods, gameData, getGearById, type JobId } from "@/domain";

const foodIcons = new Map(foods.map((food) => [food.id, food.icon]));

export function itemIconId(itemId: number | undefined): number | undefined {
  if (itemId === undefined) return undefined;
  return getGearById(itemId)?.icon ?? foodIcons.get(itemId);
}

export function jobIconUrl(jobId: JobId): string {
  return iconUrl(gameData.jobs[jobId].id + 62100);
}

export function iconUrl(iconId: number): string {
  if (!Number.isSafeInteger(iconId) || iconId <= 0)
    throw new Error("Invalid icon ID");
  const file = String(iconId).padStart(6, "0");
  const folder = String(Math.floor(iconId / 1000) * 1000).padStart(6, "0");
  return `https://xivapi-v2.xivcdn.com/api/asset?path=ui/icon/${folder}/${file}.tex&format=png`;
}
