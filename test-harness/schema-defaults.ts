export function extractSchemaDefaults(
  schema: unknown,
): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return {};
  const s = schema as Record<string, unknown>;
  if (s.type !== "object" || !s.properties) return {};

  const result: Record<string, unknown> = {};
  const props = s.properties as Record<string, Record<string, unknown>>;

  for (const [key, prop] of Object.entries(props)) {
    if (prop.type === "object" && prop.properties) {
      const nested = extractSchemaDefaults(prop);
      if (Object.keys(nested).length > 0) result[key] = nested;
    } else if ("default" in prop) {
      result[key] = prop.default;
    }
  }

  return result;
}
