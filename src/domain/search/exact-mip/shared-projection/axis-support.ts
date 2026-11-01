import { ProjectionLimit, type ProjectionSlot } from "./types.ts";

export type SupportAxis = "crt" | "det" | "dht" | "ten";
const AXES: readonly SupportAxis[] = ["crt", "det", "dht", "ten"];
const INDEX: Readonly<Record<SupportAxis, number>> = {
  det: 2,
  ten: 3,
  crt: 4,
  dht: 5,
};

/** A null threshold disables the cell. Duplicate cells use the least enabled threshold. */
export type AxisTerminalCell = {
  speed: number;
  main: number;
  minZ: number | null;
};
export type AxisState = {
  readonly speed: number;
  readonly main: number;
  readonly z: number;
  readonly basis: readonly number[];
  /** Bit n means the requested raw axis has the exact value n. */
  readonly bits: bigint;
};
type MutableState = {
  speed: number;
  main: number;
  z: number;
  basis: readonly number[];
  bits: bigint;
  width: number;
};
type SMZ = { speed: number; main: number; z: number };
type Increment = SMZ & { basis: readonly number[]; axis: number };
type Binding = { readonly name: string; readonly signature: string };

export type AxisLimits = {
  maxStates?: number;
  maxTransitions?: number;
  maxBits?: number;
  maxBitWidth?: number;
  localMs?: number;
};
export type AxisRunOptions = { check?: () => void; limits?: AxisLimits };
export type AxisStatistics = {
  transitions: number;
  peakStates: number;
  peakBits: number;
  elapsedMs: number;
};
/** Only complete, reverse-filtered layers may constrain the next projection. */
export type AxisAllowed = {
  readonly complete: true;
  readonly axis: SupportAxis;
  readonly basisNames: readonly SupportAxis[];
  readonly order: readonly string[];
  readonly bindings: readonly Binding[];
  readonly layers: readonly ReadonlyMap<string, AxisState>[];
};
export type AxisGraph = AxisAllowed & {
  readonly increments: readonly (readonly Increment[])[];
};
export type AxisProjectionOptions = AxisRunOptions & {
  axis?: SupportAxis;
  basis?: readonly SupportAxis[];
  allowed?: AxisAllowed;
};
export type AxisProjection = AxisStatistics & {
  complete: true;
  axis: SupportAxis;
  basisNames: readonly SupportAxis[];
  states: readonly AxisState[];
  graph: AxisGraph;
};
export type AxisBacktrack = AxisAllowed & AxisStatistics;

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new RangeError(`axis support: ${message}`);
}
function safe(value: number, label: string): number {
  requireValue(
    Number.isSafeInteger(value) && value >= 0,
    `${label} must be a nonnegative safe integer`,
  );
  return value === 0 ? 0 : value;
}
function add(a: number, b: number): number {
  requireValue(a <= Number.MAX_SAFE_INTEGER - b, "integer sum overflow");
  return a + b;
}
function sm(speed: number, main: number): string {
  return `${speed},${main}`;
}
function stateKey(
  speed: number,
  main: number,
  z: number,
  basis: readonly number[],
): string {
  return `${speed},${main},${z}|${basis.join(",")}`;
}
function basisCheck(axis: SupportAxis, basis: readonly SupportAxis[]): void {
  requireValue(
    AXES.includes(axis) &&
      basis.length <= 2 &&
      new Set(basis).size === basis.length &&
      basis.every((name) => AXES.includes(name) && name !== axis),
    "distinct axis and at most two distinct basis axes required",
  );
}

function machinery({ check = () => {}, limits = {} }: AxisRunOptions) {
  const bounds = {
    maxStates: 2_000_000,
    maxTransitions: 100_000_000,
    maxBits: 512_000_000,
    maxBitWidth: 1_000_000,
    localMs: 100_000,
    ...limits,
  };
  for (const [name, value] of Object.entries(bounds))
    requireValue(safe(value, name) > 0, `positive ${name} required`);
  requireValue(
    bounds.maxStates <= 5_000_000 &&
      bounds.maxTransitions <= 500_000_000 &&
      bounds.maxBits <= 2_000_000_000 &&
      bounds.maxBitWidth <= 2_000_000 &&
      bounds.localMs <= 180_000,
    "unsupported resource limits",
  );
  const began = performance.now();
  let work = 0,
    transitions = 0,
    states = 0,
    bits = 0,
    peakStates = 0,
    peakBits = 0;
  function guard(): void {
    check();
    if (performance.now() - began >= bounds.localMs)
      throw new ProjectionLimit("axis support: local time budget");
  }
  function tick(): void {
    if ((++work & 1023) === 0) guard();
  }
  function edge(): void {
    if (transitions >= bounds.maxTransitions)
      throw new ProjectionLimit("axis support: transition budget");
    transitions++;
    tick();
  }
  function reserve(width = 0): void {
    if (states >= bounds.maxStates || bits + width > bounds.maxBits)
      throw new ProjectionLimit("axis support: state/bit memory budget");
    states++;
    bits += width;
    peakStates = Math.max(peakStates, states);
    peakBits = Math.max(peakBits, bits);
  }
  function grow(delta: number): void {
    if (bits + delta > bounds.maxBits)
      throw new ProjectionLimit("axis support: bit memory budget");
    bits += delta;
    peakBits = Math.max(peakBits, bits);
  }
  function release<T>(map: Map<string, T>): void {
    states -= map.size;
    map.clear();
  }
  function checkedWidth(width: number): number {
    if (width > bounds.maxBitWidth)
      throw new ProjectionLimit("axis support: bit-width budget");
    return width;
  }
  function width(value: bigint): number {
    return checkedWidth(value === 0n ? 0 : value.toString(2).length);
  }
  function insert(
    map: Map<string, MutableState>,
    speed: number,
    main: number,
    z: number,
    basis: readonly number[],
    value: bigint,
    bitWidth: number,
  ): void {
    if (value === 0n) return;
    const key = stateKey(speed, main, z, basis),
      old = map.get(key);
    if (old) {
      if (bitWidth > old.width) {
        grow(bitWidth - old.width);
        old.width = bitWidth;
      }
      old.bits |= value;
    } else {
      reserve(bitWidth);
      map.set(key, { speed, main, z, basis, bits: value, width: bitWidth });
    }
  }
  const stats = (): AxisStatistics => ({
    transitions,
    peakStates,
    peakBits,
    elapsedMs: performance.now() - began,
  });
  return {
    guard,
    tick,
    edge,
    reserve,
    release,
    checkedWidth,
    width,
    insert,
    stats,
  };
}

/** Exact raw-axis reachability for independent physical slots, conditional on terminal SMZ cells.
 * The caller supplies slots in physical order; only the internal traversal is sorted by coarse size.
 * No dominance deletion, scoring, food approximation, or cross-slot legality inference occurs here.
 */
export function projectAxis(
  slots: readonly ProjectionSlot[],
  cells: readonly AxisTerminalCell[],
  { axis = "crt", basis = [], allowed, ...run }: AxisProjectionOptions = {},
): AxisProjection {
  const m = machinery(run);
  m.guard();
  basisCheck(axis, basis);
  if (slots.length > 64 || cells.length > 500_000)
    throw new ProjectionLimit("axis support: slot/cell input budget");
  const names = new Set<string>(),
    maxima = Array<number>(7).fill(0);
  let inputKeys = 0;
  const order = slots.map((slot, index) => {
    requireValue(
      typeof slot.name === "string" && !names.has(slot.name),
      "unique original slot names required",
    );
    names.add(slot.name);
    const keys = new Set<string>(),
      largest = Array<number>(7).fill(0);
    const coarse = new Map<string, SMZ>(),
      fine = new Map<string, Increment>();
    const snapshot: (readonly [string, readonly number[]])[] = [];
    for (const choice of slot.choices) {
      m.tick();
      if (++inputKeys > 500_000)
        throw new ProjectionLimit("axis support: physical-key input budget");
      requireValue(
        typeof choice.key === "string" && !keys.has(choice.key),
        "unique original physical keys required",
      );
      keys.add(choice.key);
      requireValue(
        choice.values.length === 7,
        "complete seven-axis physical values required",
      );
      for (let a = 0; a < 7; a++) {
        safe(choice.values[a], "physical value");
        largest[a] = Math.max(largest[a], choice.values[a]);
      }
      const speed = choice.values[6],
        main = choice.values[1];
      const z = AXES.reduce(
        (sum, name) => add(sum, choice.values[INDEX[name]]),
        0,
      );
      const values = basis.map((name) => choice.values[INDEX[name]]),
        axisValue = choice.values[INDEX[axis]];
      const coarseKey = stateKey(speed, main, z, []),
        fineKey = `${stateKey(speed, main, z, values)},${axisValue}`;
      if (!coarse.has(coarseKey)) {
        m.reserve();
        coarse.set(coarseKey, { speed, main, z });
      }
      if (!fine.has(fineKey)) {
        m.reserve();
        fine.set(fineKey, { speed, main, z, basis: values, axis: axisValue });
      }
      // Preserve physical identity, key order, and all upstream values, including unused weapon values.
      snapshot.push([choice.key, [...choice.values]]);
    }
    for (let a = 0; a < 7; a++) maxima[a] = add(maxima[a], largest[a]);
    return {
      name: slot.name,
      index,
      binding: JSON.stringify(snapshot),
      coarse: [...coarse.values()],
      increments: [...fine.values()],
    };
  });
  // Validate the aggregate Z bound before using unchecked nonnegative additions in the hot loops.
  AXES.reduce((sum, name) => add(sum, maxima[INDEX[name]]), 0);
  order.sort((a, b) => a.coarse.length - b.coarse.length || a.index - b.index);
  const terminal = new Map<string, AxisTerminalCell>();
  let capSpeed = 0,
    capMain = 0;
  for (const cell of cells) {
    m.tick();
    safe(cell.speed, "cell speed");
    safe(cell.main, "cell main");
    if (cell.minZ !== null) safe(cell.minZ, "cell threshold");
    const key = sm(cell.speed, cell.main),
      old = terminal.get(key);
    if (
      !old ||
      (cell.minZ !== null && (old.minZ === null || cell.minZ < old.minZ))
    )
      terminal.set(key, cell);
    if (cell.minZ !== null) {
      capSpeed = Math.max(capSpeed, cell.speed);
      capMain = Math.max(capMain, cell.main);
    }
  }
  if (allowed) {
    requireValue(
      allowed.complete === true && allowed.layers.length === slots.length + 1,
      "complete allowed layers required",
    );
    basisCheck(allowed.axis, allowed.basisNames);
    const retained = [...allowed.basisNames, allowed.axis];
    requireValue(
      retained.length === basis.length &&
        basis.every((name) => retained.includes(name)),
      "allowed axes must equal current basis",
    );
    const byName = new Map(order.map((block) => [block.name, block]));
    const bindings = new Map(
      allowed.bindings.map((binding) => [binding.name, binding.signature]),
    );
    requireValue(
      allowed.order.length === order.length &&
        new Set(allowed.order).size === order.length &&
        allowed.order.every((name) => byName.has(name)) &&
        bindings.size === order.length &&
        order.every((block) => bindings.get(block.name) === block.binding),
      "allowed physical source/order drift",
    );
    order.splice(
      0,
      order.length,
      ...allowed.order.map((name) => byName.get(name)!),
    );
  }
  function permitted(
    layer: number,
    speed: number,
    main: number,
    z: number,
    values: readonly number[],
  ): boolean {
    if (!allowed) return true;
    const previousBasis = allowed.basisNames.map(
      (name) => values[basis.indexOf(name)],
    );
    const held = values[basis.indexOf(allowed.axis)];
    const state = allowed.layers[layer].get(
      stateKey(speed, main, z, previousBasis),
    );
    // Membership uses a right shift: a held axis is not constrained by this run's new-axis width limit.
    return state !== undefined && ((state.bits >> BigInt(held)) & 1n) !== 0n;
  }
  type Prefix = { speed: number; main: number; maxZ: number };
  type Backward = { speed: number; main: number; threshold: number };
  const prefix: Map<string, Prefix>[] = [],
    backward: Map<string, Backward>[] = [];
  const origin = new Map<string, Prefix>();
  m.reserve();
  origin.set(sm(0, 0), { speed: 0, main: 0, maxZ: 0 });
  prefix.push(origin);
  for (let i = 0; i < order.length; i++) {
    const next = new Map<string, Prefix>();
    for (const parent of prefix[i].values())
      for (const inc of order[i].coarse) {
        m.edge();
        if (
          inc.speed > capSpeed - parent.speed ||
          inc.main > capMain - parent.main
        )
          continue;
        const speed = parent.speed + inc.speed,
          main = parent.main + inc.main,
          z = parent.maxZ + inc.z;
        const key = sm(speed, main),
          old = next.get(key);
        if (old) old.maxZ = Math.max(old.maxZ, z);
        else {
          m.reserve();
          next.set(key, { speed, main, maxZ: z });
        }
      }
    prefix.push(next);
  }
  const last = new Map<string, Backward>();
  for (const cell of terminal.values()) {
    m.tick();
    const key = sm(cell.speed, cell.main),
      state = prefix[order.length].get(key);
    if (cell.minZ !== null && state && state.maxZ >= cell.minZ) {
      m.reserve();
      last.set(key, {
        speed: cell.speed,
        main: cell.main,
        threshold: cell.minZ,
      });
    }
  }
  backward[order.length] = last;
  for (let i = order.length - 1; i >= 0; i--) {
    const next = new Map<string, Backward>();
    for (const child of backward[i + 1].values())
      for (const inc of order[i].coarse) {
        m.edge();
        if (inc.speed > child.speed || inc.main > child.main) continue;
        const speed = child.speed - inc.speed,
          main = child.main - inc.main;
        const threshold = Math.max(0, child.threshold - inc.z),
          key = sm(speed, main),
          parent = prefix[i].get(key);
        if (!parent || parent.maxZ < threshold) continue;
        const old = next.get(key);
        if (old) old.threshold = Math.min(old.threshold, threshold);
        else {
          m.reserve();
          next.set(key, { speed, main, threshold });
        }
      }
    backward[i] = next;
    m.release(prefix[i + 1]);
  }
  m.release(prefix[0]);
  const layers: Map<string, MutableState>[] = [],
    first = new Map<string, MutableState>();
  const zeroBasis = basis.map(() => 0);
  if (backward[0].has(sm(0, 0)) && permitted(0, 0, 0, 0, zeroBasis))
    m.insert(first, 0, 0, 0, zeroBasis, 1n, 1);
  layers.push(first);
  for (let i = 0; i < order.length; i++) {
    const next = new Map<string, MutableState>();
    for (const parent of layers[i].values())
      for (const inc of order[i].increments) {
        m.edge();
        const speed = parent.speed + inc.speed,
          main = parent.main + inc.main,
          z = parent.z + inc.z;
        const required = backward[i + 1].get(sm(speed, main));
        if (!required || z < required.threshold) continue;
        const values = parent.basis.map((value, a) => value + inc.basis[a]);
        if (!permitted(i + 1, speed, main, z, values)) continue;
        const width = m.checkedWidth(parent.width + inc.axis);
        m.insert(
          next,
          speed,
          main,
          z,
          values,
          parent.bits << BigInt(inc.axis),
          width,
        );
      }
    layers.push(next);
    m.release(backward[i]);
  }
  m.release(backward[order.length]);
  m.guard();
  const basisNames = [...basis];
  const graph: AxisGraph = {
    complete: true,
    axis,
    basisNames,
    order: order.map((block) => block.name),
    bindings: order.map((block) => ({
      name: block.name,
      signature: block.binding,
    })),
    layers,
    increments: order.map((block) => block.increments),
  };
  return {
    complete: true,
    axis,
    basisNames,
    states: [...layers[order.length].values()],
    graph,
    ...m.stats(),
  };
}

/** Reverse real graph edges, retaining every path that can extend to one of the supplied terminal bits.
 * Repeated calls may independently filter the same complete graph. No graph/input mutation occurs.
 */
export function backtrackAxis(
  graph: AxisGraph,
  filteredStates: readonly AxisState[],
  run: AxisRunOptions = {},
): AxisBacktrack {
  const m = machinery(run);
  m.guard();
  basisCheck(graph.axis, graph.basisNames);
  requireValue(
    graph.complete === true &&
      graph.layers.length === graph.increments.length + 1 &&
      graph.order.length === graph.increments.length &&
      graph.bindings.length === graph.order.length,
    "complete forward graph required",
  );
  const layers: Map<string, MutableState>[] = [],
    last = new Map<string, MutableState>();
  const terminal = graph.layers[graph.layers.length - 1];
  for (const state of filteredStates) {
    m.tick();
    safe(state.speed, "filtered speed");
    safe(state.main, "filtered main");
    safe(state.z, "filtered Z");
    requireValue(
      state.basis.length === graph.basisNames.length,
      "filtered basis coverage",
    );
    state.basis.forEach((value) => safe(value, "filtered basis"));
    const original = terminal.get(
      stateKey(state.speed, state.main, state.z, state.basis),
    );
    requireValue(
      original &&
        typeof state.bits === "bigint" &&
        state.bits >= 0n &&
        (state.bits & ~original.bits) === 0n,
      "filtered bits outside real terminal reachability",
    );
    if (state.bits !== 0n)
      m.insert(
        last,
        state.speed,
        state.main,
        state.z,
        [...state.basis],
        state.bits,
        m.width(state.bits),
      );
  }
  layers[graph.increments.length] = last;
  for (let i = graph.increments.length - 1; i >= 0; i--) {
    const next = new Map<string, MutableState>();
    for (const parent of graph.layers[i].values())
      for (const inc of graph.increments[i]) {
        m.edge();
        const values = parent.basis.map((value, a) => value + inc.basis[a]);
        const child = layers[i + 1].get(
          stateKey(
            parent.speed + inc.speed,
            parent.main + inc.main,
            parent.z + inc.z,
            values,
          ),
        );
        if (!child) continue;
        const bits = parent.bits & (child.bits >> BigInt(inc.axis));
        if (bits !== 0n)
          m.insert(
            next,
            parent.speed,
            parent.main,
            parent.z,
            [...parent.basis],
            bits,
            m.width(bits),
          );
      }
    layers[i] = next;
  }
  m.guard();
  return {
    complete: true,
    axis: graph.axis,
    basisNames: [...graph.basisNames],
    order: [...graph.order],
    bindings: graph.bindings.map((binding) => ({ ...binding })),
    layers,
    ...m.stats(),
  };
}
