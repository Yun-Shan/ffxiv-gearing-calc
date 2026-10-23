import type { SyncData } from "../../../../domain/types.ts";
import { wire } from "../../shared/schema.ts";

const syncSchema = wire.struct([
  [
    "levels",
    wire.array(
      wire.struct([
        ["jobLevel", wire.u16],
        ["minItemLevel", wire.u16],
        ["defaultItemLevel", wire.u16],
      ]),
    ),
  ],
  [
    "groups",
    wire.array(
      wire.struct([
        ["name", wire.string],
        [
          "options",
          wire.array(
            wire.struct([
              ["name", wire.string],
              [
                "target",
                wire.struct([
                  ["kind", wire.enum(["jobLevel", "itemLevel"] as const)],
                  ["value", wire.u16],
                ]),
              ],
            ]),
          ),
        ],
      ]),
    ),
  ],
]);

export const syncSectionSchema = wire.struct([["sync", syncSchema]]);
export type { SyncData };
