import { gameData } from "./data";
import type { JobId } from "./types";

export const jobSchemas = gameData.jobSchemas;
export const jobLevelModifiers = gameData.jobLevelModifiers;
export const jobIds = Object.keys(jobSchemas) as JobId[];
export const currentLevel = Math.max(
  ...Object.keys(jobLevelModifiers).map(Number),
);
