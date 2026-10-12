export type WizardStep = 1 | 2 | 3 | 4;

export type SingleGcdFeasibility = {
  key: string;
  status: "loading" | "ready" | "error";
  tiers: number[];
  error?: string;
};
