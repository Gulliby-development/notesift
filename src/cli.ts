import { type Parsed, parseArgs } from "./args";
import { capture } from "./capture";
import { renderCheck } from "./check";
import { renderExport } from "./export";
import { resolveNote } from "./graph";
import { formatIndex } from "./index-file";
import { renderLinks, renderPath } from "./links";
import { renderRelated } from "./related";
import { indexPath, loadIndex, refresh } from "./scan";
import { renderSearch } from "./search";
import { renderStats } from "./stats";
import { renderTags } from "./tags";
import { plural } from "./text";
import { CliError, type Io, type Note, type Result } from "./types";

const HELP = `usage: notesift index [--dir DIR]
       notesift search [--dir DIR] [--limit N] QUERY...
       notesift links [--dir DIR] NOTE
       notesift backlinks [--dir DIR] NOTE
       notesift check [--dir DIR]
       notesift path [--dir DIR] FROM TO
       notesift related [--dir DIR] [--limit N] NOTE
       notesift tags [--dir DIR] [TAG]
       notesift stats [--dir DIR]
       notesift export [--dir DIR] --format json|dot|csv|md
       notesift capture [--dir DIR] [--title TEXT] [--tag TAG]... NAME
`;

function loadPriorIndex(io: Io, dir: string): Note[] | null {
  const path = indexPath(dir);
  try {
    return loadIndex(io, dir);
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    if (
      error.message === `${path}: no index (run "notesift index" first)` ||
      error.message === `${path}: damaged index (run "notesift index" again)`
    ) {
      return null;
    }
    throw error;
  }
}

function index(io: Io, parsed: Parsed): Result {
  const previous = loadPriorIndex(io, parsed.dir);
  const changes = refresh(io, parsed.dir, previous);
  const mustWrite =
    previous === null || changes.added !== 0 || changes.changed !== 0 || changes.removed !== 0;

  if (mustWrite) {
    io.write(indexPath(parsed.dir), new TextEncoder().encode(formatIndex(changes.notes)));
  }

  const summary = `indexed ${plural(changes.notes.length, "note", "notes")} (${changes.added} new, ${changes.changed} changed, ${changes.removed} removed, ${changes.unchanged} unchanged)\n`;
  return { text: summary, code: 0 };
}

function runCommand(parsed: Parsed, io: Io): Result {
  if (parsed.command === "help") return { text: HELP, code: 0 };
  if (parsed.command === "index") return index(io, parsed);
  if (parsed.command === "capture") {
    return {
      text: capture(io, parsed.dir, parsed.operands[0] ?? "", parsed.title, parsed.tags),
      code: 0,
    };
  }

  const notes = loadIndex(io, parsed.dir);
  switch (parsed.command) {
    case "search":
      return {
        text: renderSearch(notes, parsed.operands, parsed.limit ?? 10),
        code: 0,
      };
    case "links": {
      const id = resolveNote(notes, parsed.operands[0] ?? "");
      return { text: renderLinks(notes, id, "out"), code: 0 };
    }
    case "backlinks": {
      const id = resolveNote(notes, parsed.operands[0] ?? "");
      return { text: renderLinks(notes, id, "in"), code: 0 };
    }
    case "check":
      return renderCheck(notes);
    case "path": {
      const from = resolveNote(notes, parsed.operands[0] ?? "");
      const to = resolveNote(notes, parsed.operands[1] ?? "");
      return renderPath(notes, from, to);
    }
    case "related": {
      const id = resolveNote(notes, parsed.operands[0] ?? "");
      return {
        text: renderRelated(notes, id, parsed.limit ?? 5),
        code: 0,
      };
    }
    case "tags":
      return {
        text: renderTags(notes, parsed.operands[0] ?? null),
        code: 0,
      };
    case "stats":
      return { text: renderStats(notes), code: 0 };
    case "export":
      if (parsed.format === null) throw new CliError("missing --format");
      return { text: renderExport(notes, parsed.format), code: 0 };
  }
}

export function run(args: string[], io: Io): number {
  try {
    const parsed = parseArgs(args);
    const result = runCommand(parsed, io);
    io.out(result.text);
    return result.code;
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    io.err(`notesift: ${error.message}\n`);
    return 2;
  }
}
