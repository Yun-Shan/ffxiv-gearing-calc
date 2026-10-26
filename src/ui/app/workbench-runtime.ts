import type { RouterHistory } from "@tanstack/react-router";
import {
  singleSessionFromState,
  singleDraftFromConfig,
  singleStateFromResult,
  singleStateFromSession,
  type SingleState,
} from "@/ui/pages/single-workbench/state/useSingleController";
import {
  jointSessionFromState,
  jointStateFromResult,
  jointStateFromSession,
} from "@/ui/pages/joint-workbench/useJointWorkbenchController";
import { jointWorkbenchDraftFromConfig } from "@/ui/pages/joint-workbench/joint-workbench-state";
import type { JointWorkbenchPhase } from "@/ui/pages/joint-workbench/joint-workbench-types";
import {
  clearWorkbenchSession,
  readWorkbenchSession,
  writeWorkbenchSession,
  type WorkbenchSession,
} from "@/ui/services/workbench-session";
import type { WorkbenchResult } from "@/ui/services/workbench-result";
import type {
  WorkbenchMode,
  WorkbenchPhase,
  WorkbenchRouteControls,
  WorkbenchRouting,
  WorkbenchTransitionIntent,
} from "@/ui/services/workbench-routing";
import { shareToken, type RouterSearch } from "./router-search";

type StateByMode = { single: SingleState; joint: JointWorkbenchPhase };
type AnyState = StateByMode[WorkbenchMode];
type Navigate = (options: {
  to: string;
  replace?: boolean;
  search: RouterSearch;
  mask?: { to: "/"; search: RouterSearch; unmaskOnReload: true };
}) => Promise<unknown>;
interface RouteLocation {
  pathname: string;
  search: Record<string, unknown>;
  state?: { __TSR_index?: number };
  maskedLocation?: { pathname: string; search: Record<string, unknown> };
}
interface NavigationHost {
  navigate: Navigate;
  history: RouterHistory;
  location(): RouteLocation;
}
interface Adapter<S> {
  hydrate(session: WorkbenchSession): S;
  serialize(state: S): WorkbenchSession | undefined;
  result(value: WorkbenchResult): S;
  conditionsFromResult(
    state: Extract<AnyState, { phase: "result" }>,
  ): S | undefined;
}

const adapters: { [M in WorkbenchMode]: Adapter<StateByMode[M]> } = {
  single: {
    hydrate: (value) =>
      singleStateFromSession(
        value as Extract<WorkbenchSession, { mode: "single" }>,
      ),
    serialize: singleSessionFromState,
    result: (value) =>
      singleStateFromResult(
        value as Extract<WorkbenchResult, { mode: "single" }>,
      ),
    conditionsFromResult: (value) => {
      if ("config" in value.snapshot) return undefined;
      return singleStateFromSession({
        mode: "single",
        phase: "conditions",
        draft: singleDraftFromConfig(value.snapshot),
      });
    },
  },
  joint: {
    hydrate: (value) =>
      jointStateFromSession(
        value as Extract<WorkbenchSession, { mode: "joint" }>,
      ),
    serialize: jointSessionFromState,
    result: (value) =>
      jointStateFromResult(
        value as Extract<WorkbenchResult, { mode: "joint" }>,
      ),
    conditionsFromResult: (value) => {
      if (!("config" in value.snapshot)) return undefined;
      return jointStateFromSession({
        mode: "joint",
        phase: "conditions",
        draft: jointWorkbenchDraftFromConfig(value.snapshot.config),
      });
    },
  },
};

export function workbenchPath(
  mode: WorkbenchMode,
  phase: WorkbenchPhase,
): string {
  return phase === "selection" ? `/${mode}` : `/${mode}/${phase}`;
}

function routeWorkbench(
  path: string,
): { mode: WorkbenchMode; phase: WorkbenchPhase } | undefined {
  if (path === "/") return { mode: "single", phase: "selection" };
  const match = /^\/(single|joint)(?:\/(conditions|progress|result))?\/?$/.exec(
    path,
  );
  return match
    ? {
        mode: match[1] as WorkbenchMode,
        phase: (match[2] ?? "selection") as WorkbenchPhase,
      }
    : undefined;
}

class WorkbenchPort<M extends WorkbenchMode> implements WorkbenchRouting<
  StateByMode[M]
> {
  state: StateByMode[M] = { phase: "selection" } as StateByMode[M];
  readonly phases = new Map<WorkbenchPhase, StateByMode[M]>([
    ["selection", this.state],
  ]);
  controls?: WorkbenchRouteControls<StateByMode[M]>;
  resultToken?: string;
  returnIndex?: number;
  private needsReentry = false;
  constructor(
    readonly owner: WorkbenchRuntime,
    readonly mode: M,
  ) {}
  get initialState() {
    return this.state;
  }
  attach(controls: WorkbenchRouteControls<StateByMode[M]>) {
    this.controls = controls;
    return () => {
      if (this.controls === controls) this.controls = undefined;
    };
  }
  publish(state: StateByMode[M], intent: WorkbenchTransitionIntent) {
    this.owner.publish(this, state, intent);
  }
  suspend() {
    // Share decoding revokes controller ownership while retaining its state.
    this.needsReentry = true;
    this.controls?.leave();
  }
  enter(state: StateByMode[M], reset = false) {
    if (state === this.state && !reset && !this.needsReentry) return;
    this.needsReentry = false;
    if (this.state.phase === "progress" && state.phase !== "progress")
      this.phases.delete("progress");
    this.state = state;
    this.phases.set(state.phase, state);
    this.controls?.enter(state, reset);
  }
}

/** Only one workbench is active. Route entries reuse its data, never run commands. */
export class WorkbenchRuntime {
  private active?: WorkbenchPort<WorkbenchMode>;
  // Retain bindings, never inactive workflow data: a redirect can keep the same
  // React parent matched even after logically leaving its previous workflow.
  private readonly ports = new Map<
    WorkbenchMode,
    WorkbenchPort<WorkbenchMode>
  >();
  private host?: NavigationHost;
  private boot?: WorkbenchSession;
  private pendingToken?: string;
  private recovery?: {
    mode: WorkbenchMode;
    token: string;
    search: RouterSearch;
  };
  private warnings: string[] = [];
  private readonly warningListeners = new Set<() => void>();
  private storageWarning?: string;
  constructor(
    restore = typeof performance !== "undefined" &&
      (
        performance.getEntriesByType("navigation")[0] as
          PerformanceNavigationTiming | undefined
      )?.type === "reload",
  ) {
    if (restore) {
      const saved = readWorkbenchSession();
      this.boot = saved.session;
      if (saved.warning) this.warn(saved.warning);
    } else clearWorkbenchSession();
  }
  connect(host: NavigationHost) {
    this.host = host;
  }
  takeWarnings(): string[] {
    return this.warnings.splice(0);
  }
  subscribeWarnings(listener: () => void): () => void {
    this.warningListeners.add(listener);
    return () => {
      this.warningListeners.delete(listener);
    };
  }
  private warn(message: string) {
    this.warnings.push(message);
    for (const listener of this.warningListeners) listener();
  }
  private activate<M extends WorkbenchMode>(mode: M): WorkbenchPort<M> {
    if (this.active?.mode !== mode) {
      this.clear();
      this.active =
        this.ports.get(mode) ??
        (new WorkbenchPort(this, mode) as WorkbenchPort<WorkbenchMode>);
      this.ports.set(mode, this.active);
      this.active.enter(this.active.state, true);
    }
    return this.active as WorkbenchPort<M>;
  }
  port<M extends WorkbenchMode>(mode: M): WorkbenchRouting<StateByMode[M]> {
    return this.activate(mode);
  }
  clear() {
    if (this.active) {
      this.active.controls?.leave();
      this.active.state = { phase: "selection" };
      this.active.phases.clear();
      this.active.phases.set("selection", this.active.state);
      this.active.resultToken = undefined;
      this.active.returnIndex = undefined;
    }
    this.active = undefined;
    clearWorkbenchSession();
    this.storageWarning = undefined;
  }
  reset(mode: WorkbenchMode) {
    this.boot = undefined;
    this.pendingToken = undefined;
    this.recovery = undefined;
    const port = this.activate(mode);
    port.phases.clear();
    port.resultToken = undefined;
    port.returnIndex = undefined;
    port.enter({ phase: "selection" } as AnyState, true);
    clearWorkbenchSession();
  }
  /** Return a replacement destination when the requested stage has no data. */
  prepare(
    location: RouteLocation,
  ): { to: string; search: RouterSearch } | undefined {
    const path = location.pathname;
    const visible = location.maskedLocation?.search ?? location.search;
    const token = shareToken(visible);
    if (!location.maskedLocation && token !== undefined) {
      this.boot = undefined;
      if (path !== "/") return { to: "/", search: visible as RouterSearch };
      if (this.pendingToken !== token) {
        this.clear();
        this.pendingToken = token;
      }
      this.recovery = undefined;
      return;
    }
    this.pendingToken = undefined;
    this.recovery = undefined;
    const target = routeWorkbench(path);
    if (!target) {
      this.boot = undefined;
      this.clear();
      return;
    }
    const saved = this.boot;
    this.boot = undefined;
    const port = this.activate(target.mode);
    if (
      saved?.mode === target.mode &&
      (saved.phase === target.phase ||
        (target.phase === "progress" && saved.phase === "conditions"))
    ) {
      port.enter(adapters[target.mode].hydrate(saved));
    }
    if (token !== undefined && location.maskedLocation) {
      const result = port.phases.get("result");
      if (result && port.resultToken === token) port.enter(result);
      else {
        // Decode in the currently matched result route. Redirecting through the
        // root would leave a Joint parent and discard its still-active Draft.
        if (port.state.phase === "progress") {
          port.enter(port.phases.get("conditions") ?? { phase: "selection" });
        } else port.suspend();
        this.pendingToken = token;
        this.recovery = {
          mode: target.mode,
          token,
          search: visible as RouterSearch,
        };
      }
      return;
    }
    let state = port.phases.get(target.phase);
    if (target.phase === "conditions" && !state) {
      const result = port.phases.get("result");
      if (result?.phase === "result") {
        state = adapters[target.mode].conditionsFromResult(result);
      }
    }
    if (target.phase === "progress" && port.state.phase !== "progress") {
      state = port.phases.get("conditions");
      return {
        to: workbenchPath(target.mode, state ? "conditions" : "selection"),
        search: {},
      };
    }
    if (!state)
      return { to: workbenchPath(target.mode, "selection"), search: {} };
    port.enter(state);
    this.save(port);
  }
  pendingShare(mode: WorkbenchMode) {
    return this.recovery?.mode === mode ? this.recovery : undefined;
  }
  acceptShare(
    value: WorkbenchResult,
    token: string,
    visibleSearch: RouterSearch,
  ): void {
    if (this.pendingToken !== token || !this.host) return;
    this.boot = undefined;
    const preserveConditions =
      this.recovery?.mode === value.mode && this.recovery.token === token;
    const port = this.activate(value.mode);
    if (!preserveConditions) {
      port.phases.clear();
      port.phases.set("selection", { phase: "selection" });
    }
    this.recovery = undefined;
    port.resultToken = token;
    port.enter(adapters[value.mode].result(value), true);
    this.save(port);
    void this.host.navigate({
      to: workbenchPath(value.mode, "result"),
      search: {},
      replace: true,
      mask: { to: "/", search: visibleSearch, unmaskOnReload: true },
    });
  }
  publish<M extends WorkbenchMode>(
    port: WorkbenchPort<M>,
    state: StateByMode[M],
    intent: WorkbenchTransitionIntent,
  ): void {
    if (this.active !== port) return;
    const previous = port.state;
    if (previous.phase === "selection" && state.phase === "conditions") {
      port.phases.delete("result");
      port.resultToken = undefined;
    }
    if (state.phase === "progress" && previous.phase !== "progress") {
      port.returnIndex = this.host?.location().state?.__TSR_index;
    }
    if (previous.phase === "progress" && state.phase !== "progress")
      port.phases.delete("progress");
    if (state.phase === "result" && intent !== "update")
      port.resultToken = undefined;
    port.state = state;
    port.phases.set(state.phase, state);
    this.save(port);
    if (intent === "update" || !this.host) return;
    if (
      intent === "return" &&
      port.returnIndex !== undefined &&
      this.host.location().state?.__TSR_index === port.returnIndex + 1
    ) {
      port.returnIndex = undefined;
      this.host.history.back();
      return;
    }
    void this.host.navigate({
      to: workbenchPath(port.mode, state.phase),
      search: {},
      replace: intent === "replace" || intent === "return",
    });
  }
  private save<M extends WorkbenchMode>(port: WorkbenchPort<M>) {
    if (port.state.phase === "selection") {
      clearWorkbenchSession();
      return;
    }
    if (port.state.phase === "progress") return;
    const snapshot = adapters[port.mode].serialize(port.state);
    if (!snapshot) return;
    const warning = writeWorkbenchSession(snapshot);
    if (warning && warning !== this.storageWarning) this.warn(warning);
    this.storageWarning = warning;
  }
}
