import { Popover } from "@base-ui/react/popover";
import { ExternalLink } from "lucide-react";
import { useRef, useState } from "react";
import styles from "./ItemName.module.scss";

export function ItemName({
  name,
  itemId,
  className,
}: {
  name: string;
  itemId?: number;
  className: string;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [fontSize, setFontSize] = useState<string>();
  if (itemId === undefined || !Number.isSafeInteger(itemId) || itemId <= 0) {
    return <strong className={className}>{name}</strong>;
  }
  return (
    <Popover.Root
      onOpenChange={(open) => {
        if (open && triggerRef.current) {
          setFontSize(getComputedStyle(triggerRef.current).fontSize);
        }
      }}
    >
      <Popover.Trigger ref={triggerRef} className={`${className} ${styles.trigger}`}>
        {name}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className={styles.positioner}
          align="start"
          sideOffset={5}
        >
          <Popover.Popup
            className={styles.popup}
            style={{ fontSize }}
            aria-label={`${name}的物品资料`}
          >
            <a
              href={`https://ff14.huijiwiki.com/wiki/物品:${encodeURIComponent(name)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              在 最终幻想XIV中文维基 中查看
              <ExternalLink aria-hidden="true" />
            </a>
            <a
              href={`https://garlandtools.cn/db/#item/${itemId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              在 Garland 数据 中查看
              <ExternalLink aria-hidden="true" />
            </a>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
