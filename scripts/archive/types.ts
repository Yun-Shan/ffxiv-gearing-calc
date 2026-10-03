export type Row = Record<string, any> & {
  rowId: number;
  fields: Record<string, any>;
};

export type { ComparableInfo, EquipInfo, FoodInfo, FoodParam, ParamInfo } from "../../src/domain/search/types.ts";

export type PendingRequest = {
  method: string;
  params: Record<string, unknown>;
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
};

export type StreamState = {
  chunks: Buffer[];
  totalLen: number;
};

export type EquipmentMateriaCombinerConfig = {
  getMateriaAttributeTypes: (jobType: number) => number[];
  getMateriaValue: (attrId: number, materiaLevel: number) => number;
  getAttributeLimit: (itemId: number, attrId: number) => number;
};

export type Materia = {
  id: number;
  baseParam: number;
  items: number[];
  values: number[];
  minAllowItemLevel: number[];
};
