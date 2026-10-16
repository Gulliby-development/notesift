import { escapeField, fnv1a, unescapeField } from "./text";
import type { Link, Note } from "./types";

const encoder = new TextEncoder();
const HASH_PATTERN = /^[0-9a-f]{8}$/;
const DIGITS_PATTERN = /^\d+$/;

export function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0) ?? 0);
  const length = Math.min(leftPoints.length, rightPoints.length);

  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

function readCanonicalField(value: string): string | null {
  const decoded = unescapeField(value);
  return decoded !== null && escapeField(decoded) === value ? decoded : null;
}

function appendNoteRecords(note: Note, lines: string[]): void {
  lines.push(
    ["N", escapeField(note.id), note.hash, String(note.words), escapeField(note.title)].join("\t"),
  );

  for (const tag of note.tags) lines.push(`T\t${tag}`);
  for (const alias of note.aliases) lines.push(`A\t${escapeField(alias)}`);
  for (const link of note.links) {
    lines.push(`L\t${String(link.line)}\t${escapeField(link.target)}`);
  }
  for (const [word, weight] of note.terms) lines.push(`W\t${word}\t${String(weight)}`);
}

export function formatIndex(notes: Note[]): string {
  const lines = ["notesift-index 1"];
  const orderedNotes = [...notes].sort((left, right) => compareCodePoints(left.id, right.id));

  for (const note of orderedNotes) appendNoteRecords(note, lines);

  const prefix = `${lines.join("\n")}\n`;
  return `${prefix}end\t${fnv1a(encoder.encode(prefix))}\n`;
}

function parseDigits(value: string): number | null {
  return DIGITS_PATTERN.test(value) ? Number(value) : null;
}

function parseNoteRecord(fields: string[]): Note | null {
  if (fields.length !== 5 || fields[0] !== "N") return null;
  const id = readCanonicalField(fields[1]);
  const title = readCanonicalField(fields[4]);
  const words = parseDigits(fields[3]);

  if (id === null || title === null || words === null || !HASH_PATTERN.test(fields[2])) {
    return null;
  }

  return {
    id,
    hash: fields[2],
    words,
    title,
    tags: [],
    aliases: [],
    links: [],
    terms: [],
  };
}

function appendChildRecord(note: Note, fields: string[]): boolean {
  if (fields[0] === "T") {
    if (fields.length !== 2) return false;
    note.tags.push(fields[1]);
    return true;
  }

  if (fields[0] === "A") {
    if (fields.length !== 2) return false;
    const alias = readCanonicalField(fields[1]);
    if (alias === null) return false;
    note.aliases.push(alias);
    return true;
  }

  if (fields[0] === "L") {
    if (fields.length !== 3) return false;
    const line = parseDigits(fields[1]);
    const target = readCanonicalField(fields[2]);
    if (line === null || target === null) return false;
    const link: Link = { line, target };
    note.links.push(link);
    return true;
  }

  if (fields[0] === "W") {
    if (fields.length !== 3) return false;
    const weight = parseDigits(fields[2]);
    if (weight === null) return false;
    note.terms.push([fields[1], weight]);
    return true;
  }

  return false;
}

export function parseIndex(text: string): Note[] | null {
  if (!text.endsWith("\n")) return null;

  const lines = text.split("\n");
  if (lines[0] !== "notesift-index 1" || lines.length < 3 || lines.at(-1) !== "") {
    return null;
  }

  const endFields = lines[lines.length - 2].split("\t");
  if (endFields.length !== 2 || endFields[0] !== "end" || !HASH_PATTERN.test(endFields[1])) {
    return null;
  }

  const prefix = `${lines.slice(0, -2).join("\n")}\n`;
  if (fnv1a(encoder.encode(prefix)) !== endFields[1]) return null;

  const notes: Note[] = [];
  let current: Note | null = null;
  let previousId: string | null = null;

  for (let index = 1; index < lines.length - 2; index += 1) {
    const fields = lines[index].split("\t");
    if (fields[0] === "N") {
      const note = parseNoteRecord(fields);
      if (note === null) return null;
      if (previousId !== null && compareCodePoints(previousId, note.id) >= 0) return null;
      notes.push(note);
      current = note;
      previousId = note.id;
      continue;
    }

    if (current === null || !appendChildRecord(current, fields)) return null;
  }

  return notes;
}
