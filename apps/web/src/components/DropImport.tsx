import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

// Statement files dropped anywhere in the app go to the Import page, which picks them up here.

let pending: File[] = [];
const listeners = new Set<() => void>();

/** Files dropped since the Import page last looked; empties the queue. */
export function takeDroppedFiles(): File[] {
  const out = pending;
  pending = [];
  return out;
}

/** Calls back when files are dropped while the Import page is open. */
export function onDroppedFiles(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

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
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length === 0) return;
      pending = [...pending, ...files];
      for (const l of listeners) l();
      void navigate({ to: "/import" });
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
  if (!over) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-brand-600/10 p-6 backdrop-blur-sm">
      <div className="rounded-2xl border-2 border-dashed border-brand-600 bg-white px-10 py-8 text-center shadow-lg dark:bg-stone-900">
        <p className="text-lg font-semibold">Drop bank files to import</p>
        <p className="mt-1 text-sm text-stone-500">CSV, OFX, QFX or CAMT.053, several at once</p>
      </div>
    </div>
  );
}
