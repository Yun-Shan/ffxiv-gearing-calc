import { Link } from "lucide-react";
import { useFeedback } from "@/ui/components/feedback/FeedbackProvider";
import type { ShareInput } from "@/share/types";
import { useResultShare } from "@/ui/services/use-result-share";

export function ShareLinkButton({
  data,
  className,
  onCopied,
}: {
  data: ShareInput;
  className?: string;
  onCopied?(): void;
}) {
  const { notify } = useFeedback();
  const { copying, copyLink } = useResultShare();
  async function copy() {
    try {
      if (!(await copyLink(data))) return;
      notify("分享链接已复制到剪贴板", "success");
      onCopied?.();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "分享链接生成失败",
        "error",
      );
    }
  }
  return (
    <button
      type="button"
      className={className}
      onClick={() => void copy()}
      disabled={copying}
      aria-busy={copying}
    >
      <Link size="1em" aria-hidden="true" />
      {copying ? "正在复制…" : "复制链接"}
    </button>
  );
}
