import { buildGraph, shortestPath } from "./graph";
import { plural } from "./text";
import type { Note, Result } from "./types";

export function renderLinks(notes: Note[], id: string, dir: "out" | "in"): string {
  const graph = buildGraph(notes);
  const neighbors = (dir === "out" ? graph.out : graph.inn).get(id) ?? [];
  const notesById = new Map(notes.map((note) => [note.id, note] as const));
  const lines = neighbors.map((neighbor) => {
    const note = notesById.get(neighbor);
    return `${neighbor}  ${note?.title ?? ""}`;
  });
  const summary =
    dir === "out"
      ? plural(neighbors.length, "outgoing link", "outgoing links")
      : plural(neighbors.length, "backlink", "backlinks");

  return `${lines.length > 0 ? `${lines.join("\n")}\n` : ""}${summary}\n`;
}

export function renderPath(notes: Note[], from: string, to: string): Result {
  const path = shortestPath(buildGraph(notes), from, to);
  if (path === null) {
    return { text: `no path from ${from} to ${to}\n`, code: 1 };
  }

  const hops = path.length - 1;
  return { text: `${path.join(" -> ")}\n${plural(hops, "hop", "hops")}\n`, code: 0 };
}
