import { useState } from "react";
import { iconUrl } from "@/ui/services/icon-url";
import styles from "./EquipmentIcon.module.scss";

export function EquipmentIcon({
  iconId,
  className = "",
}: {
  iconId?: number;
  className?: string;
}) {
  const url = iconId === undefined ? undefined : iconUrl(iconId);
  const [failed, setFailed] = useState<string>();
  return url && failed !== url ? (
    <img
      className={`${styles.icon} ${className}`}
      src={url}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      onError={() => setFailed(url)}
    />
  ) : (
    <span
      className={`${styles.icon} ${styles.missing} ${className}`}
      title={url ? "图标加载失败" : "缺少图标资料"}
      aria-hidden="true"
    />
  );
}
