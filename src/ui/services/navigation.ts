const NAVIGATE_EVENT = "app:navigate";

/** 以应用内路由方式切换页面，供需要先确认再跳转的交互使用。 */
export function navigateTo(path: string): void {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

export function subscribeNavigation(listener: () => void): () => void {
  window.addEventListener(NAVIGATE_EVENT, listener);
  window.addEventListener("popstate", listener);
  window.addEventListener("hashchange", listener);
  return () => {
    window.removeEventListener(NAVIGATE_EVENT, listener);
    window.removeEventListener("popstate", listener);
    window.removeEventListener("hashchange", listener);
  };
}
