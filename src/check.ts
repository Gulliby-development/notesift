import { buildGraph } from "./graph";
import { compareCodePoints } from "./index-file";
import { asciiLower, plural } from "./text";
import type { Note, Result } from "./types";

type DiagnosticCode = "NS001" | "NS002" | "NS003" | "NS004";

interface Diagnostic {
  id: string;
  line: number | null;
  code: DiagnosticCode;
  message: string;
  order: number;
}

export function renderCheck(notes: Note[]): Result {
  const graph = buildGraph(notes);
  const diagnostics: Diagnostic[] = [];
  let order = 0;

  const addDiagnostic = (
    id: string,
    line: number | null,
    code: DiagnosticCode,
    message: string,
  ): void => {
    diagnostics.push({ id, line, code, message, order });
    order += 1;
  };

  for (const broken of graph.broken) {
    addDiagnostic(
      broken.id,
      broken.line,
      "NS001",
      `${broken.id}:${broken.line}: NS001 broken link "${broken.target}"`,
    );
  }

  for (const ambiguous of graph.ambiguous) {
    addDiagnostic(
      ambiguous.id,
      ambiguous.line,
      "NS002",
      `${ambiguous.id}:${ambiguous.line}: NS002 ambiguous link "${ambiguous.target}" (${ambiguous.ids.join(" or ")})`,
    );
  }

  const aliasOwners = new Map<string, Set<string>>();
  for (const note of notes) {
    for (const alias of note.aliases) {
      const key = asciiLower(alias);
      const owners = aliasOwners.get(key) ?? new Set<string>();
      owners.add(note.id);
      aliasOwners.set(key, owners);
    }
  }

  for (const note of notes) {
    for (const alias of note.aliases) {
      const owners = aliasOwners.get(asciiLower(alias));
      if (!owners || owners.size < 2) continue;

      const otherOwners = [...owners].filter((id) => id !== note.id).sort(compareCodePoints);
      addDiagnostic(
        note.id,
        null,
        "NS003",
        `${note.id}: NS003 alias "${alias}" is also used by ${otherOwners.join(", ")}`,
      );
    }
  }

  for (const note of notes) {
    if (
      (graph.out.get(note.id)?.length ?? 0) === 0 &&
      (graph.inn.get(note.id)?.length ?? 0) === 0
    ) {
      addDiagnostic(note.id, null, "NS004", `${note.id}: NS004 note has no links in or out`);
    }
  }

  diagnostics.sort((left, right) => {
    const byId = compareCodePoints(left.id, right.id);
    if (byId !== 0) return byId;

    if (left.line === null && right.line !== null) return -1;
    if (left.line !== null && right.line === null) return 1;
    if (left.line !== null && right.line !== null && left.line !== right.line) {
      return left.line - right.line;
    }

    const byCode = compareCodePoints(left.code, right.code);
    return byCode !== 0 ? byCode : left.order - right.order;
  });

  const text =
    diagnostics.length === 0
      ? `ok, ${plural(notes.length, "note", "notes")}\n`
      : `${diagnostics.map(({ message }) => message).join("\n")}\n${plural(diagnostics.length, "problem", "problems")} in ${plural(new Set(diagnostics.map(({ id }) => id)).size, "note", "notes")}\n`;

  return { text, code: diagnostics.length === 0 ? 0 : 1 };
}
