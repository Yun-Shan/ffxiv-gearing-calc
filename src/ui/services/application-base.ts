/** Normalize only the explicit HTML base, without inferring a deep route path. */
export function applicationBase(): string {
  if (typeof document === "undefined") return "/";
  const href = document.querySelector("base[href]")?.getAttribute("href");
  return href === undefined || href === null
    ? "/"
    : new URL(href, document.baseURI).pathname;
}
