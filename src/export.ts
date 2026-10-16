import { buildGraph } from "./graph";
import { compareCodePoints } from "./index-file";
import type { Note } from "./types";

export type ExportFormat = "json" | "dot" | "csv" | "md";

function escapeDot(value: string): string {
  return value.replace(/[\\"]/g, "\\$&");
}

function escapeCsv(value: string): string {
  if (!/[,"\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function renderExport(notes: Note[], format: ExportFormat): string {
  const orderedNotes = [...notes].sort((left, right) => compareCodePoints(left.id, right.id));
  const graph = buildGraph(orderedNotes);

  if (format === "json") {
    const records = orderedNotes.map((note) => ({
      id: note.id,
      title: note.title,
      tags: note.tags,
      aliases: note.aliases,
      words: note.words,
      links: graph.out.get(note.id) ?? [],
      backlinks: graph.inn.get(note.id) ?? [],
    }));
    return `${JSON.stringify(records, null, 2)}\n`;
  }

  if (format === "dot") {
    const lines = ["digraph notes {"];

    for (const note of orderedNotes) {
      lines.push(`  "${escapeDot(note.id)}" [label="${escapeDot(note.title)}"];`);
    }
    for (const note of orderedNotes) {
      for (const target of graph.out.get(note.id) ?? []) {
        lines.push(`  "${escapeDot(note.id)}" -> "${escapeDot(target)}";`);
      }
    }

    lines.push("}");
    return `${lines.join("\n")}\n`;
  }

  if (format === "csv") {
    const lines = ["id,title,words,tags,inbound,outbound"];

    for (const note of orderedNotes) {
      const fields = [
        note.id,
        note.title,
        String(note.words),
        note.tags.join(";"),
        String(graph.inn.get(note.id)?.length ?? 0),
        String(graph.out.get(note.id)?.length ?? 0),
      ];
      lines.push(fields.map(escapeCsv).join(","));
    }

    return `${lines.join("\n")}\n`;
  }

  const lines = ["# Notes", ""];

  for (const note of orderedNotes) {
    const tagSuffix = note.tags.length > 0 ? ` (tags: ${note.tags.join(", ")})` : "";
    lines.push(`- [[${note.id}]] ${note.title}${tagSuffix}`);
  }

  return `${lines.join("\n")}\n`;
}
