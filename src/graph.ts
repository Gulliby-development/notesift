import { compareCodePoints } from "./index-file";
import { asciiLower } from "./text";
import { CliError, type Graph, type Note, type Resolution } from "./types";

function matchingIds(notes: Note[], matches: (note: Note) => boolean): string[] {
  return [...new Set(notes.filter(matches).map((note) => note.id))].sort(compareCodePoints);
}

export function resolve(notes: Note[], target: string): Resolution {
  const exactId = matchingIds(notes, (note) => note.id === target);
  if (exactId.length > 0) {
    return exactId.length === 1
      ? { kind: "ok", id: exactId[0] }
      : { kind: "ambiguous", ids: exactId };
  }

  const loweredTarget = asciiLower(target);
  const matchers = [
    (note: Note) => note.aliases.some((alias) => asciiLower(alias) === loweredTarget),
    (note: Note) => asciiLower(note.title) === loweredTarget,
    (note: Note) => asciiLower(note.id.split("/").at(-1) ?? "") === loweredTarget,
  ];

  for (const matches of matchers) {
    const ids = matchingIds(notes, matches);
    if (ids.length === 1) return { kind: "ok", id: ids[0] };
    if (ids.length > 1) return { kind: "ambiguous", ids };
  }

  return { kind: "broken" };
}

export function resolveNote(notes: Note[], arg: string): string {
  const result = resolve(notes, arg);
  if (result.kind === "ok") return result.id;
  if (result.kind === "broken") throw new CliError(`unknown note "${arg}"`);
  throw new CliError(`ambiguous note "${arg}" (${result.ids.join(" or ")})`);
}

interface OrderedLink {
  line: number;
  order: number;
  target: string;
}

export function buildGraph(notes: Note[]): Graph {
  const orderedNotes = [...notes].sort((left, right) => compareCodePoints(left.id, right.id));
  const outSets = new Map<string, Set<string>>();
  const inSets = new Map<string, Set<string>>();

  for (const note of orderedNotes) {
    if (!outSets.has(note.id)) outSets.set(note.id, new Set());
    if (!inSets.has(note.id)) inSets.set(note.id, new Set());
  }

  const broken: Graph["broken"] = [];
  const ambiguous: Graph["ambiguous"] = [];

  for (const note of orderedNotes) {
    const links: OrderedLink[] = note.links
      .map((link, order) => ({ line: link.line, order, target: link.target }))
      .sort((left, right) => left.line - right.line || left.order - right.order);

    for (const link of links) {
      const resolution = resolve(orderedNotes, link.target);
      if (resolution.kind === "broken") {
        broken.push({ id: note.id, line: link.line, target: link.target });
        continue;
      }
      if (resolution.kind === "ambiguous") {
        ambiguous.push({
          id: note.id,
          line: link.line,
          target: link.target,
          ids: resolution.ids,
        });
        continue;
      }
      if (resolution.id === note.id) continue;

      outSets.get(note.id)?.add(resolution.id);
      inSets.get(resolution.id)?.add(note.id);
    }
  }

  const sortedAdjacency = (sets: Map<string, Set<string>>): Map<string, string[]> =>
    new Map(
      [...sets.entries()].map(([id, neighbors]) => [id, [...neighbors].sort(compareCodePoints)]),
    );

  return {
    out: sortedAdjacency(outSets),
    inn: sortedAdjacency(inSets),
    broken,
    ambiguous,
  };
}

export function shortestPath(graph: Graph, from: string, to: string): string[] | null {
  if (!graph.out.has(from) || !graph.out.has(to)) return null;
  if (from === to) return [from];

  const queue = [from];
  const previous = new Map<string, string | null>([[from, null]]);

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    const neighbors = [...(graph.out.get(current) ?? [])].sort(compareCodePoints);
    for (const neighbor of neighbors) {
      if (previous.has(neighbor)) continue;
      previous.set(neighbor, current);
      if (neighbor === to) {
        const path: string[] = [];
        let step: string | null = to;
        while (step !== null) {
          path.push(step);
          step = previous.get(step) ?? null;
        }
        return path.reverse();
      }
      queue.push(neighbor);
    }
  }

  return null;
}

export function countComponents(graph: Graph): number {
  const nodes = new Set([...graph.out.keys(), ...graph.inn.keys()]);
  const visited = new Set<string>();
  let components = 0;

  for (const start of [...nodes].sort(compareCodePoints)) {
    if (visited.has(start)) continue;
    components += 1;
    visited.add(start);
    const pending = [start];

    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined) continue;
      const neighbors = [...(graph.out.get(current) ?? []), ...(graph.inn.get(current) ?? [])];
      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        pending.push(neighbor);
      }
    }
  }

  return components;
}
