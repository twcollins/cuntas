import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { openFiles } from "../lib/opened";
import { platform } from "../lib/platform";

// Files dropped anywhere in the app, or opened in it from elsewhere, go to the page that reads them
// (statements to Import, rule files to Tax rules, backups to Settings) through the queue in lib/opened.

const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");

export function DropImportHost() {
  const navigate = useNavigate();
  const [over, setOver] = useState(false);
  // dragenter and dragleave fire for every child element; count them to know when the drag leaves the window.
  const depth = useRef(0);
  useEffect(() => {
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    };
    const dragover = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      const to = openFiles([...(e.dataTransfer?.files ?? [])]);
      if (to) void navigate({ to });
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", dragover);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", dragover);
      window.removeEventListener("drop", drop);
    };
  }, [navigate]);
  useEffect(
    () =>
      platform().files.onOpen((files) => {
        const to = openFiles(files);
        if (to) void navigate({ to });
      }),
    [navigate],
  );
  if (!over) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-brand-600/10 p-6 backdrop-blur-sm">
      <div className="rounded-2xl border-2 border-dashed border-brand-600 bg-white px-10 py-8 text-center shadow-lg dark:bg-stone-900">
        <p className="text-lg font-semibold">Drop bank files to import</p>
        <p className="mt-1 text-sm text-stone-500">CSV, OFX, QFX or CAMT.053, several at once; a rule file or backup opens where it belongs</p>
      </div>
    </div>
  );
}
