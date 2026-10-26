import { MAX_LINK_CHARS } from "./types.ts";

export function sharePrefix(href: string): string {
  const url = new URL(href);
  url.search = "";
  url.hash = "";
  return url.href + "?s=";
}
export function buildShareUrl(token: string, href: string): string {
  const url = sharePrefix(href) + token;
  if (url.length > MAX_LINK_CHARS) throw new Error("分享链接超出容量限制");
  return url;
}
