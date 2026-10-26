import { useRef, useState } from "react";
import { Share2 } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { useFeedback } from "@/ui/components/feedback/FeedbackProvider";
import { copyResultImage } from "@/ui/services/share-result";
import type { ResultShareData } from "../../../result-share-layout/types";
import type { ShareInput } from "@/share/types";
import { ShareLinkButton } from "../share-link-button/ShareLinkButton";
import styles from "./ShareResultButton.module.scss";

export function ShareResultButton({
  data,
  linkData,
  images,
  className,
}: {
  data?: ResultShareData;
  linkData?: ShareInput;
  images?: readonly { label: string; data: ResultShareData }[];
  className?: string;
}) {
  const { notify } = useFeedback();
  const [copying, setCopying] = useState(false);
  const pending = useRef(false);
  const [open, setOpen] = useState(false);
  const [choosingImage, setChoosingImage] = useState(false);

  function startCopy(): boolean {
    if (pending.current) return false;
    pending.current = true;
    setCopying(true);
    return true;
  }
  function finishCopy() {
    pending.current = false;
    setCopying(false);
  }
  async function share(image: ResultShareData) {
    if (!startCopy()) return;
    try {
      await copyResultImage(image);
      notify("结果图片已复制到剪贴板", "success");
      setOpen(false);
      setChoosingImage(false);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "请检查浏览器的剪贴板权限后重试";
      notify(`分享结果失败：${message}`, "error");
    } finally {
      finishCopy();
    }
  }

  const imageOptions = images ?? (data ? [{ label: "当前配装", data }] : []);
  return (
    <Popover.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) setChoosingImage(false);
      }}
    >
      <Popover.Trigger className={className} disabled={copying}>
        <Share2 size="1em" aria-hidden="true" />
        分享配装结果
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} className={styles.positioner}>
          <Popover.Popup className={styles.popup}>
            <Popover.Title className={styles.title}>
              {choosingImage ? "选择图片职业" : "分享配装结果"}
            </Popover.Title>
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
                    disabled={copying}
                    onCopyStart={startCopy}
                    onCopyEnd={finishCopy}
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
                    {copying ? "正在复制…" : "复制图片分享"}
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
