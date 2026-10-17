/** Copy at the execution boundary; editor mutations cannot change an active search. */
export function freezeSnapshot<T>(value: T): T {
  const snapshot = structuredClone(value);
  function freeze(part: unknown) {
    if (!part || typeof part !== "object" || Object.isFrozen(part)) return;
    Object.values(part).forEach(freeze);
    Object.freeze(part);
  }
  freeze(snapshot);
  return snapshot;
}
