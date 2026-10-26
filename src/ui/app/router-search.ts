/** These URLs carry strings, including opaque share tokens; do not JSON-coerce them. */
export type RouterSearch = Record<string, string | string[] | undefined>;

export function parseRouterSearch(search: string): RouterSearch {
  const result: RouterSearch = Object.create(null);
  for (const [key, value] of new URLSearchParams(search)) {
    const previous = result[key];
    result[key] =
      previous === undefined
        ? value
        : Array.isArray(previous)
          ? [...previous, value]
          : [previous, value];
  }
  return result;
}

export function stringifyRouterSearch(search: Record<string, unknown>): string {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined) continue;
    for (const entry of Array.isArray(value) ? value : [value])
      result.append(key, String(entry));
  }
  const value = result.toString();
  return value ? `?${value}` : "";
}

export function shareToken(
  search: Record<string, unknown>,
): string | undefined {
  if (!Object.hasOwn(search, "s")) return undefined;
  const value = Array.isArray(search.s) ? search.s[0] : search.s;
  return value === undefined ? "" : String(value);
}
