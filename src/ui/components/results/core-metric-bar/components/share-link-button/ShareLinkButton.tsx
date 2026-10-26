import { useRef, useState } from "react";
import { Link } from "lucide-react";
import { useFeedback } from "@/ui/components/feedback/FeedbackProvider";
import type { ShareInput } from "@/share/types";
import { shareUrl } from "@/share/codec";
import { projectShareInput } from "@/share/projection";
import { copyShareUrl } from "@/ui/services/share-link";

export function ShareLinkButton({
  data,
  className,
  onCopied,
  disabled = false,
  onCopyStart,
  onCopyEnd,
}: {
  data: ShareInput;
  className?: string;
  onCopied?(): void;
  disabled?: boolean;
  onCopyStart?(): boolean;
  onCopyEnd?(): void;
}) {
  const { notify } = useFeedback();
  const pending = useRef(false),
    [copying, setCopying] = useState(false);
  async function copy() {
    if (pending.current || disabled || onCopyStart?.() === false) return;
    pending.current = true;
    setCopying(true);
    try {
      // Call the clipboard within the click gesture, before any asynchronous work.
      await copyShareUrl(
        shareUrl(
          projectShareInput(data),
          window.location.href,
        ),
      );
      notify("分享链接已复制到剪贴板", "success");
      onCopied?.();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "分享链接生成失败",
        "error",
      );
    } finally {
      pending.current = false;
      setCopying(false);
      onCopyEnd?.();
    }
  }
  return (
    <button
      type="button"
      className={className}
      onClick={() => void copy()}
      disabled={disabled || copying}
      aria-busy={copying}
    >
      <Link size="1em" aria-hidden="true" />
      {copying ? "正在复制…" : "复制分享链接"}
    </button>
  );
}
