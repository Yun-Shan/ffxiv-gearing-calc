export function allowsGenericQueries(health) {
  if (!health?.gameVersion || !health.schemaAvailable) return false;
  if (health.status === "ok") return health.gameVersion === health.validatedVersion;
  return health.status === "degraded" && acceptsVersionWarning(health.warnings);
}

export function acceptsVersionWarning(warnings) {
  return Array.isArray(warnings) && warnings.length > 0 && warnings.every((warning) =>
    warning.code === "GameVersionMismatch" && /Generic tools.*unaffected/i.test(warning.message),
  );
}
