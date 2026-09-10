import { createHash } from "node:crypto";

/** Metadata continuity, not a signature or a claim about tool implementation. */
export function toolFingerprint(definition: {
  name: string;
  description?: string;
  parameters?: unknown;
  output?: { schema?: unknown };
}): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]));
    }
    return value;
  };
  return createHash("sha256").update(JSON.stringify(canonical({
    name: definition.name,
    description: definition.description ?? "",
    parameters: definition.parameters ?? {},
    output: definition.output?.schema ?? null,
  }))).digest("hex");
}

export type IdentityStatus = "first-seen" | "unchanged" | "changed" | "capacity-exceeded";

/** Never evict a pin silently: a full table requires operator review. */
export class ToolIdentityTracker {
  private readonly pins = new Map<string, string>();
  constructor(private readonly limit = 512) {}

  check(name: string, digest: string): IdentityStatus {
    const pinned = this.pins.get(name);
    if (pinned) return pinned === digest ? "unchanged" : "changed";
    if (this.pins.size >= this.limit) return "capacity-exceeded";
    this.pins.set(name, digest);
    return "first-seen";
  }
}
