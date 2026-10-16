import { compareCodePoints, parseIndex } from "./index-file";
import { parseNote } from "./note";
import { decodeStrict, fnv1a } from "./text";
import { CliError, type Io, type Note } from "./types";

export function cleanDir(dir: string): string {
  const normalized = dir.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.length === 0 ? "." : normalized;
}

export function indexPath(dir: string): string {
  return `${cleanDir(dir)}/.notesift/index.txt`;
}

export function noteIds(files: string[]): string[] {
  return files
    .filter(
      (file) => file.endsWith(".md") && !file.split("/").some((segment) => segment.startsWith(".")),
    )
    .map((file) => file.slice(0, -3))
    .sort(compareCodePoints);
}

function notePath(dir: string, id: string): string {
  return `${dir}/${id}.md`;
}

export function refresh(
  io: Io,
  dir: string,
  previous: Note[] | null,
): { notes: Note[]; added: number; changed: number; removed: number; unchanged: number } {
  const normalizedDir = cleanDir(dir);
  let files: string[];

  try {
    files = io.files(normalizedDir);
  } catch {
    throw new CliError(`${normalizedDir}: cannot read the directory`);
  }

  const ids = noteIds(files);
  const previousById = new Map((previous ?? []).map((note) => [note.id, note]));
  const notes: Note[] = [];
  let added = 0;
  let changed = 0;
  let unchanged = 0;

  for (const id of ids) {
    const path = notePath(normalizedDir, id);
    let bytes: Uint8Array;

    try {
      bytes = io.read(path);
    } catch {
      throw new CliError(`${path}: cannot read the file`);
    }

    const oldNote = previousById.get(id);
    if (oldNote !== undefined && oldNote.hash === fnv1a(bytes)) {
      notes.push(oldNote);
      unchanged += 1;
    } else {
      notes.push(parseNote(id, bytes));
      if (oldNote === undefined) added += 1;
      else changed += 1;
    }
  }

  const currentIds = new Set(ids);
  let removed = 0;
  for (const id of previousById.keys()) {
    if (!currentIds.has(id)) removed += 1;
  }

  return { notes, added, changed, removed, unchanged };
}

export function loadIndex(io: Io, dir: string): Note[] {
  const path = indexPath(dir);
  let bytes: Uint8Array;

  try {
    bytes = io.read(path);
  } catch {
    throw new CliError(`${path}: no index (run "notesift index" first)`);
  }

  const text = decodeStrict(bytes);
  const notes = text === null ? null : parseIndex(text);
  if (notes === null) {
    throw new CliError(`${path}: damaged index (run "notesift index" again)`);
  }
  return notes;
}
