import { useRef, useState } from "react";
import { Share2 } from "lucide-react";
import { useFeedback } from "@/ui/components/feedback/FeedbackProvider";
import { copyResultImage } from "@/ui/services/share-result";
import type { ResultShareData } from "../../../result-share-layout/types";

export function ShareResultButton({
  data,
  className,
}: {
  data: ResultShareData;
  className: string;
}) {
  const { notify } = useFeedback();
  const [copying, setCopying] = useState(false);
  const pending = useRef(false);

  async function share() {
    if (pending.current) return;
    pending.current = true;
    setCopying(true);
    try {
      await copyResultImage(data);
      notify("结果图片已复制到剪贴板", "success");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "请检查浏览器的剪贴板权限后重试";
      notify(`分享结果失败：${message}`, "error");
    } finally {
      pending.current = false;
      setCopying(false);
    }
  }

  return (
    <button
      type="button"
      className={className}
      onClick={() => void share()}
      disabled={copying}
      aria-busy={copying}
    >
      <Share2 size="1em" aria-hidden="true" />
      {copying ? "正在复制…" : "复制图片分享"}
    </button>
  );
}
