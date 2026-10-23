import type { LinearMipRow } from "../linear-mip.ts";
import type { LinearMipVariable } from "../linear-mip.ts";

export type RowSense = "=" | "<=" | ">=";

export type ModelRow = LinearMipRow;

export type VariableBounds = LinearMipVariable;
