import { useState } from "react";
import { createPortal } from "react-dom";
import { Image, Share2 } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { useFeedback } from "@/ui/components/feedback/FeedbackProvider";
import { useResultShare } from "@/ui/services/use-result-share";
import type { ResultShareData } from "../../../result-share-layout/types";
import type { ShareInput } from "@/share/types";
import { ShareLinkButton } from "../share-link-button/ShareLinkButton";
import styles from "./ShareResultButton.module.scss";

interface ShareResultButtonProps {
  data?: ResultShareData;
  linkData?: ShareInput;
  images?: readonly { label: string; data: ResultShareData }[];
  className?: string;
  floating?: boolean;
}

export function ShareResultButton(props: ShareResultButtonProps) {
  // Changing the trigger's host resets the menu, while the shared copy lock survives.
  return <ShareResultMenu key={props.floating ? "floating" : "inline"} {...props} />;
}

function ShareResultMenu({
  data,
  linkData,
  images,
  className,
  floating = false,
}: ShareResultButtonProps) {
  const { notify } = useFeedback();
  const { copying, copyImage } = useResultShare();
  const [open, setOpen] = useState(false);
  const [choosingImage, setChoosingImage] = useState(false);

  async function share(image: ResultShareData) {
    try {
      if (!(await copyImage(image))) return;
      notify("结果图片已复制到剪贴板", "success");
      setOpen(false);
      setChoosingImage(false);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "请检查浏览器的剪贴板权限后重试";
      notify(`分享结果失败：${message}`, "error");
    }
  }

  const imageOptions = images ?? (data ? [{ label: "当前配装", data }] : []);
  const trigger = (
    <Popover.Trigger
      className={`${className ?? ""} ${styles.trigger} ${floating ? styles.floatingTrigger : ""}`}
      disabled={copying}
      aria-label={floating ? "分享配装结果" : undefined}
    >
      <Share2 size={floating ? 22 : "1em"} aria-hidden="true" />
      {!floating && "分享配装结果"}
    </Popover.Trigger>
  );
  return (
    <Popover.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) setChoosingImage(false);
      }}
    >
      {floating ? createPortal(trigger, document.body) : trigger}
      <Popover.Portal>
        <Popover.Positioner
          align="start"
          sideOffset={8}
          className={styles.positioner}
        >
          <Popover.Popup
            className={styles.popup}
            aria-label={choosingImage ? undefined : "复制配装结果"}
          >
            {choosingImage && (
              <Popover.Title className={styles.title}>
                选择图片职业
              </Popover.Title>
            )}
            {choosingImage ? (
              <>
                {imageOptions.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    className={styles.option}
                    disabled={copying}
                    aria-busy={copying}
                    onClick={() => void share(option.data)}
                  >
                    复制{option.label}图片
                  </button>
                ))}
                <button
                  className={styles.option}
                  type="button"
                  disabled={copying}
                  onClick={() => setChoosingImage(false)}
                >
                  返回
                </button>
              </>
            ) : (
              <>
                {linkData && (
                  <ShareLinkButton
                    data={linkData}
                    className={styles.option}
                    onCopied={() => setOpen(false)}
                  />
                )}
                {imageOptions.length > 0 && (
                  <button
                    type="button"
                    className={styles.option}
                    disabled={copying}
                    aria-busy={copying}
                    onClick={() =>
                      imageOptions.length > 1
                        ? setChoosingImage(true)
                        : void share(imageOptions[0].data)
                    }
                  >
                    <Image size="1em" aria-hidden="true" />
                    {copying ? "正在复制…" : "复制图片"}
                  </button>
                )}
              </>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
