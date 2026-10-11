import { gameData } from "./data.ts";
import type { JobId } from "./types.ts";

export const jobSchemas = gameData.jobSchemas;
export const jobLevelModifiers = gameData.jobLevelModifiers;
export const jobIds = Object.keys(jobSchemas) as JobId[];
export const currentLevel = Math.max(
  ...Object.keys(jobLevelModifiers).map(Number),
);
