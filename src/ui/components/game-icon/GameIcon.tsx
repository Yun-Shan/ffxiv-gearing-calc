import { useState } from "react";
import { foods, gameData, getGearById, type JobId } from "@/domain";
import styles from "./GameIcon.module.scss";

const foodIcons = new Map(foods.map((food) => [food.id, food.icon]));

type GameIconProps = {
  className?: string;
  loading?: "eager" | "lazy";
} & ({ jobId: JobId; itemId?: never } | { itemId?: number; jobId?: never });

export function GameIcon({
  jobId,
  itemId,
  className = "",
  loading,
}: GameIconProps) {
  const iconId =
    jobId !== undefined
      ? gameData.jobs[jobId].id + 62100
      : itemId === undefined
        ? undefined
        : (getGearById(itemId)?.icon ?? foodIcons.get(itemId));
  const file = iconId?.toString().padStart(6, "0");
  const folder =
    iconId === undefined
      ? undefined
      : String(Math.floor(iconId / 1000) * 1000).padStart(6, "0");
  const url =
    iconId === undefined
      ? undefined
      : `https://xivapi-v2.xivcdn.com/api/asset?path=ui/icon/${folder}/${file}.tex&format=png`;
  const [failed, setFailed] = useState<string>();
  const iconClassName = [
    styles.icon,
    jobId === undefined ? styles.item : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return url && failed !== url ? (
    <img
      className={iconClassName}
      crossOrigin="anonymous"
      src={url}
      alt=""
      aria-hidden="true"
      loading={loading ?? (jobId === undefined ? "lazy" : undefined)}
      decoding="async"
      onError={() => setFailed(url)}
    />
  ) : (
    <span
      className={`${iconClassName} ${styles.missing}`}
      title={url ? "图标加载失败" : "缺少图标资料"}
      aria-hidden="true"
    />
  );
}
