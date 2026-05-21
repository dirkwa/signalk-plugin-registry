"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractSchemaDefaults = extractSchemaDefaults;
function extractSchemaDefaults(schema) {
    if (!schema || typeof schema !== "object")
        return {};
    const s = schema;
    if (s.type !== "object" || !s.properties)
        return {};
    const result = {};
    const props = s.properties;
    for (const [key, prop] of Object.entries(props)) {
        if (prop.type === "object" && prop.properties) {
            const nested = extractSchemaDefaults(prop);
            if (Object.keys(nested).length > 0)
                result[key] = nested;
        }
        else if ("default" in prop) {
            result[key] = prop.default;
        }
    }
    return result;
}
