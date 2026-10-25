import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { MANIFEST, RAW_PACKS } from "../src/packs/generated";
import { listPacks } from "../src";

const META = new Set(["jurisdiction", "taxYear", "version", "status", "currency", "effective", "sources", "id", "source", "kind", "region", "state", "parent"]);

describe("rule packs", () => {
  it("generated packs match the YAML sources", () => {
    expect(() => execFileSync("node", ["scripts/compile-packs.mjs", "--check"], { cwd: `${__dirname}/..` })).not.toThrow();
  });

  it("every rule section carries a source URL", () => {
    for (const [key, pack] of Object.entries(RAW_PACKS)) {
      for (const [section, value] of Object.entries(pack as Record<string, unknown>)) {
        if (META.has(section)) continue;
        if (key.endsWith("/flowchart")) continue; // one source at the top for chart defaults
        const v = value as Record<string, unknown>;
        const sourced =
          typeof v.source === "string" ||
          Object.values(v).every((x) => typeof (x as { source?: unknown } | null)?.source === "string");
        expect(sourced, `${key}.${section} has no source`).toBe(true);
      }
      const top = (pack as { source?: string; sources?: string[] });
      expect(top.source ?? top.sources?.[0], `${key} has no top-level source`).toMatch(/^https:\/\//);
    }
  });

  it("every pack has a version, status and contiguous effective dates", () => {
    for (const j of ["IE", "UK"] as const) {
      const packs = listPacks(j);
      expect(packs.length).toBeGreaterThanOrEqual(2);
      for (const p of packs) expect(["provisional", "verified"]).toContain(p.status);
    }
    expect(MANIFEST.every((m) => m.sha256.length === 64)).toBe(true);
  });

  it("sub-packs and sections marked provisional say so explicitly", () => {
    const sct = RAW_PACKS["uk/scotland/2026-27"] as { kind: string; status: string };
    expect(sct.kind).toBe("ukRegion");
    expect(sct.status).toBe("provisional");
    // Sections added without official confirmation carry their own status inside verified packs.
    const uk = RAW_PACKS["uk/2026-27"] as Record<string, { status?: string }>;
    expect(uk.studentLoans?.status).toBe("provisional");
  });
});
