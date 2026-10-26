/** Custom entry actions must respect the anchor's native new-tab behavior. */
export function isPlainNavigation(
  event: Pick<
    MouseEvent,
    | "button"
    | "defaultPrevented"
    | "ctrlKey"
    | "metaKey"
    | "shiftKey"
    | "altKey"
  >,
  target = "",
): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.altKey &&
    (!target || target === "_self")
  );
}
