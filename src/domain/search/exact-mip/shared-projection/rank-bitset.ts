import { ProjectionLimit } from "./types.ts";

export type RankCell = {
  key: number;
  w: number;
  m: number;
  s: number;
  t: number;
  c: number;
  lo: number;
  hi: number;
  offset: number;
  words: number;
  lastMask: number;
};
export type RankLayer = { cells: RankCell[]; byKey: Map<number, number> };
export type RankMove = { keyDelta: number; delta: number };
export type RankGraph = { layers: RankLayer[]; moves: RankMove[][] };
export type RankBitBudget = { bytes: number; work: number };
export type RankBitLimits = { bytes: number; wordWork: number };
export type RankBits = {
  has(depth: number, key: number, value: number): boolean;
};
type BitLayer = RankLayer & { words: number; bits: Uint32Array };

const maxBytes = 384 * 1024 ** 2;
const maxWordWork = 500_000_000;

function requireThat(condition: boolean, message: string): asserts condition {
  if (!condition) throw new ProjectionLimit(message);
}

/** Exact forward reachability followed by backward support of one coordinate.
 * The byte budget counts every allocated bit buffer, including replacements and
 * both refinements. JS graph metadata is bounded separately by the graph limits.
 */
export function refineRankBits(
  graph: RankGraph,
  terminalFilter: (cell: RankCell) => (value: number) => boolean,
  check: () => void,
  budget: RankBitBudget,
  limits: RankBitLimits = { bytes: maxBytes, wordWork: maxWordWork },
): RankBits {
  check();
  requireThat(
    Number.isSafeInteger(limits.bytes) &&
      limits.bytes >= 0 &&
      limits.bytes <= maxBytes &&
      Number.isSafeInteger(limits.wordWork) &&
      limits.wordWork >= 0 &&
      limits.wordWork <= maxWordWork,
    "Invalid rank bitset limits",
  );
  function tick() {
    if (++budget.work > limits.wordWork)
      throw new ProjectionLimit("Rank bitset word work limit");
    if ((budget.work & 1023) === 0) check();
  }
  const layers: BitLayer[] = graph.layers.map((layer) => {
    check();
    let words = 0;
    for (const cell of layer.cells) {
      tick();
      requireThat(
        Number.isSafeInteger(cell.lo) &&
          Number.isSafeInteger(cell.hi) &&
          cell.lo >= 0 &&
          cell.hi >= cell.lo,
        "Invalid rank coordinate range",
      );
      cell.offset = words;
      cell.words = Math.floor((cell.hi - cell.lo) / 32) + 1;
      const lastBits = ((cell.hi - cell.lo) % 32) + 1;
      cell.lastMask = lastBits === 32 ? 0xffffffff : (2 ** lastBits - 1) >>> 0;
      words += cell.words;
      requireThat(
        Number.isSafeInteger(words) && words <= 0xffffffff,
        "Rank bitset index limit",
      );
    }
    return { ...layer, words, bits: new Uint32Array(0) };
  });
  requireThat(
    layers.length > 0 && graph.moves.length + 1 === layers.length,
    "Invalid rank graph layers",
  );
  const terminal = layers[layers.length - 1];
  const forwardWords = layers.reduce(
    (sum, layer) => sum + BigInt(layer.words),
    0n,
  );
  const reservedBytes = (2n * forwardWords - BigInt(terminal.words)) * 4n;
  requireThat(
    BigInt(budget.bytes) + reservedBytes <= BigInt(limits.bytes),
    "Rank bitset buffer limit",
  );
  function allocate(words: number): Uint32Array {
    check();
    const bytes = words * Uint32Array.BYTES_PER_ELEMENT;
    requireThat(
      budget.bytes + bytes <= limits.bytes,
      "Rank bitset buffer limit",
    );
    let bits: Uint32Array;
    try {
      bits = new Uint32Array(words);
    } catch (error) {
      if (error instanceof RangeError)
        throw new ProjectionLimit("Rank bitset allocation limit");
      throw error;
    }
    budget.bytes += bytes;
    return bits;
  }
  for (const layer of layers) layer.bits = allocate(layer.words);
  const root = layers[0].cells[0];
  requireThat(
    layers[0].cells.length === 1 &&
      root.key === 0 &&
      root.lo === 0 &&
      root.hi === 0,
    "Invalid rank graph root",
  );
  layers[0].bits[root.offset] = 1;

  function target(
    source: RankCell,
    move: RankMove,
    destination: (typeof layers)[number],
  ) {
    const key = source.key + move.keyDelta;
    requireThat(
      Number.isSafeInteger(key) && key >= 0,
      "Rank transition key limit",
    );
    const index = destination.byKey.get(key);
    if (index === undefined) return null;
    const cell = destination.cells[index];
    const low = source.lo + move.delta,
      high = source.hi + move.delta;
    requireThat(
      Number.isSafeInteger(low) &&
        Number.isSafeInteger(high) &&
        low >= cell.lo &&
        high <= cell.hi,
      "Rank transition exceeds coordinate range",
    );
    const shift = low - cell.lo;
    return { cell, whole: Math.floor(shift / 32), part: shift % 32 };
  }
  function maskPadding(layer: (typeof layers)[number]) {
    for (const cell of layer.cells) {
      tick();
      layer.bits[cell.offset + cell.words - 1] &= cell.lastMask;
    }
  }
  for (let i = 0; i < graph.moves.length; i++) {
    const from = layers[i],
      to = layers[i + 1];
    for (const source of from.cells)
      for (const move of graph.moves[i]) {
        tick();
        const shifted = target(source, move, to);
        if (!shifted) continue;
        const { cell: destination, whole, part } = shifted;
        for (let word = 0; word < source.words; word++) {
          tick();
          const value = from.bits[source.offset + word];
          if (value === 0) continue;
          const at = destination.offset + whole + word;
          if (part === 0) to.bits[at] |= value;
          else {
            to.bits[at] |= value << part;
            const spill = value >>> (32 - part);
            if (whole + word + 1 < destination.words) to.bits[at + 1] |= spill;
            else
              requireThat(spill === 0, "Rank bitset shift exceeds destination");
          }
        }
      }
    maskPadding(to);
  }
  for (const cell of terminal.cells) {
    check();
    const allowed = terminalFilter(cell);
    for (let word = 0; word < cell.words; word++) {
      tick();
      let bits = terminal.bits[cell.offset + word],
        kept = 0;
      while (bits !== 0) {
        tick();
        const lowest = bits & -bits;
        const value = cell.lo + word * 32 + 31 - Math.clz32(lowest);
        if (allowed(value)) kept |= lowest;
        bits = (bits & (bits - 1)) >>> 0;
      }
      terminal.bits[cell.offset + word] = kept;
    }
  }
  for (let i = graph.moves.length - 1; i >= 0; i--) {
    const from = layers[i],
      to = layers[i + 1],
      live = allocate(from.words);
    for (const source of from.cells)
      for (const move of graph.moves[i]) {
        tick();
        const shifted = target(source, move, to);
        if (!shifted) continue;
        const { cell: destination, whole, part } = shifted;
        for (let word = 0; word < source.words; word++) {
          tick();
          const reachable = from.bits[source.offset + word];
          if (reachable === 0) continue;
          const at = destination.offset + whole + word;
          let wanted = to.bits[at] >>> part;
          if (part !== 0 && whole + word + 1 < destination.words)
            wanted |= to.bits[at + 1] << (32 - part);
          live[source.offset + word] |= reachable & wanted;
        }
      }
    from.bits = live;
  }
  check();
  return {
    has(depth, key, value) {
      const layer = layers[depth];
      if (
        !layer ||
        !Number.isSafeInteger(key) ||
        key < 0 ||
        !Number.isSafeInteger(value)
      )
        return false;
      const index = layer.byKey.get(key);
      if (index === undefined) return false;
      const cell = layer.cells[index];
      if (value < cell.lo || value > cell.hi) return false;
      const bit = value - cell.lo;
      return (
        (layer.bits[cell.offset + Math.floor(bit / 32)] & (1 << (bit % 32))) !==
        0
      );
    },
  };
}
