import type { ReactNode } from "react";
import type { GearSlot, Stat, Stats } from "@/domain";

export interface GearTableMateria {
  isOvermeld?: boolean;
  stat: Stat;
  value: number;
}

export interface GearTableGearItem {
  itemId?: number;
  kind: "gear";
  key: string;
  slot: GearSlot;
  name: string;
  level: number;
  source?: string;
  stats: Stats;
  melds: readonly GearTableMateria[];
  weaponPerformance?: string;
  cappedStats?: readonly Stat[];
  /** Used by the replacement chooser; selected entries remain visible. */
  replacementSelected?: boolean;
  /** Unique rings that conflict with the other equipped ring stay visible but disabled. */
  replacementDisabled?: boolean;
}

export interface GearTableFoodItem {
  kind: "food";
  key: string;
  name: string;
  level?: number;
  source?: string;
  /** Present on a calculated food; omitted for the empty food placeholder. */
  statsMeaning?: "actual-gain";
  actualStats: Stats;
  utilization: number;
  stats: Stats;
}

export interface GearTableSummaryItem {
  kind: "summary";
  key: string;
  label: string;
  itemLevel?: number;
  stats: Stats;
}

export type GearTableItem =
  GearTableGearItem | GearTableFoodItem | GearTableSummaryItem;

interface GearTableRowBase {
  key: string;
  slotLabel?: string;
  marker?: ReactNode;
  className?: string;
}

export type GearTableRow =
  | (GearTableRowBase & {
      item: GearTableGearItem;
      replacements?: readonly GearTableGearItem[];
      onReplacementSelect?: (item: GearTableGearItem) => void;
    })
  | (GearTableRowBase & { item: GearTableFoodItem | GearTableSummaryItem });
