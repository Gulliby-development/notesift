import { buildGraph, countComponents } from "./graph";
import type { Note } from "./types";

export function renderStats(notes: Note[]): string {
  const graph = buildGraph(notes);
  const tags = new Set(notes.flatMap((note) => note.tags));
  const links = [...graph.out.values()].reduce((total, neighbors) => total + neighbors.length, 0);
  const orphans = [...graph.out.keys()].filter(
    (id) => (graph.out.get(id)?.length ?? 0) === 0 && (graph.inn.get(id)?.length ?? 0) === 0,
  ).length;
  const words = notes.reduce((total, note) => total + note.words, 0);

  return `notes: ${notes.length}\nwords: ${words}\ntags: ${tags.size}\nlinks: ${links}\nbroken links: ${graph.broken.length}\nambiguous links: ${graph.ambiguous.length}\norphans: ${orphans}\ncomponents: ${countComponents(graph)}\n`;
}
