export type Row = Record<string, any> & {
  rowId: number;
  fields: Record<string, any>;
};

export type ParamInfo = {
  baseParamId: number;
  value: number;
};

export type FoodParam = {
  baseParamId: number;
  multiplier: number;
  maxValue: number;
};

export type PendingRequest = {
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

export type ComparableInfo = {
  itemId: number;
  itemLevel: number;
  key: string;
  baseParams: (ParamInfo | FoodParam)[];
};

// 食物因为存在利用率的问题，不能简单等价于装备
export type FoodInfo = {
  itemId: number;
  itemLevel: number;
  // 属性列表排序用于去重相同属性的食物
  key: string;
  // 属性id和属性百分比(用于乘法的小数表示，例如增加10%就是1.1，因此可以直接乘)和属性上限值
  baseParams: FoodParam[];
};

export type Materia = {
  id: number;
  baseParam: number;
  items: number[];
  values: number[];
  minAllowItemLevel: number[];
};

export type EquipInfo = {
  itemId: number;
  itemLevel: number;
  // 属性列表排序用于去重相同属性的装备
  key: string;
  // 属性id和属性值(加上魔晶石后的)
  baseParams: ParamInfo[];
  PDMG: number;
  MDMG: number;
  DLY: number;
};
