import { describe, expect, it } from "vitest";
import { kindOf, onOpened, openFiles, takeOpened } from "./opened";

const file = (name: string) => new File(["x"], name);

describe("files opened in the app", () => {
  it("sorts by extension: rule files, backups and exports, and everything else as a statement", () => {
    expect(["us-2027.yaml", "IE-2027.YML", "cuntas-2026-10-27.cuntas", "cuntas-2026-10-27.json", "chase.csv", "export.QFX", "camt.xml", "statement"].map(kindOf)).toEqual([
      "rules", "rules", "backup", "backup", "statement", "statement", "statement", "statement",
    ]);
  });

  it("queues each kind for its page, which takes them once", () => {
    let calls = 0;
    const off = onOpened(() => calls++);
    expect(openFiles([file("amex.csv"), file("us-2027.yaml"), file("chase.csv")])).toBe("/import");
    expect(openFiles([])).toBeNull();
    off();
    expect(openFiles([file("backup.cuntas")])).toBe("/settings");
    expect(calls).toBe(1);
    expect(takeOpened("statement").map((f) => f.name)).toEqual(["amex.csv", "chase.csv"]);
    expect(takeOpened("statement")).toEqual([]);
    expect(takeOpened("rules").map((f) => f.name)).toEqual(["us-2027.yaml"]);
    expect(takeOpened("backup").map((f) => f.name)).toEqual(["backup.cuntas"]);
  });
});
