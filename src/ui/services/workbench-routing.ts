/** Controller transitions are explicit; route entry never starts computation. */
export type WorkbenchMode = "single" | "joint";
export type WorkbenchPhase = "selection" | "conditions" | "progress" | "result";
export type WorkbenchTransitionIntent =
  "push" | "replace" | "return" | "update";

export interface WorkbenchRouteControls<State> {
  /** Apply a route-owned state without publishing a second navigation. */
  enter(state: State, reset?: boolean): void;
  /** Revoke asynchronous intents and abort the active run without navigating. */
  leave(): void;
}

export interface WorkbenchRouting<State> {
  readonly initialState: State;
  attach(controls: WorkbenchRouteControls<State>): () => void;
  publish(state: State, intent: WorkbenchTransitionIntent): void;
}
