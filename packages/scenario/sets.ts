export function orderedSets(
  body: Record<string, unknown>,
  rules: Record<string, string> = {},
) {
  const result = { ...body };
  for (const [path, key] of Object.entries(rules)) {
    const field = path.slice(2),
      list = result[field];
    if (!Array.isArray(list)) continue;
    const identities = list.map((x) => x?.[key]);
    if (
      identities.some((k) => typeof k !== "string") ||
      new Set(identities).size !== list.length
    )
      throw Error("Ambiguous ordered set identity");
    result[field] = [...list].sort((a, b) =>
      String(a[key]).localeCompare(String(b[key])),
    );
  }
  return result;
}
