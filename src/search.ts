import { compareCodePoints } from "./index-file";
import { normalizeTag } from "./note";
import { plural, scaled, score3 } from "./text";
import { words } from "./tokens";
import { CliError, type Note } from "./types";

interface SearchFilters {
  ordinaryWords: string[];
  titleWords: string[];
  excludedWords: string[];
  tags: string[];
  folders: string[];
}

interface ScoredNote {
  note: Note;
  score: number;
}

function parseQuery(operands: string[]): SearchFilters {
  const ordinaryWords: string[] = [];
  const ordinarySeen = new Set<string>();
  const titleWords: string[] = [];
  const titleSeen = new Set<string>();
  const excludedWords: string[] = [];
  const excludedSeen = new Set<string>();
  const tags: string[] = [];
  const folders: string[] = [];

  for (const item of operands
    .join(" ")
    .split(/\s+/)
    .filter((value) => value.length > 0)) {
    if (item.startsWith("tag:")) {
      const tag = normalizeTag(item.slice(4));
      if (tag === null) throw new CliError(`invalid query item "${item}"`);
      tags.push(tag);
      continue;
    }

    if (item.startsWith("in:")) {
      const folder = item.slice(3).replace(/\/$/, "");
      if (folder.length === 0) throw new CliError(`invalid query item "${item}"`);
      folders.push(folder);
      continue;
    }

    if (item.startsWith("title:")) {
      const value = item.slice(6);
      if (value.length === 0) throw new CliError(`invalid query item "${item}"`);
      for (const word of words(value)) {
        if (titleSeen.has(word)) continue;
        titleSeen.add(word);
        titleWords.push(word);
      }
      continue;
    }

    if (item.startsWith("not:")) {
      const value = item.slice(4);
      if (value.length === 0) throw new CliError(`invalid query item "${item}"`);
      for (const word of words(value)) {
        if (excludedSeen.has(word)) continue;
        excludedSeen.add(word);
        excludedWords.push(word);
      }
      continue;
    }

    for (const word of words(item)) {
      if (ordinarySeen.has(word)) continue;
      ordinarySeen.add(word);
      ordinaryWords.push(word);
    }
  }

  if (
    ordinaryWords.length === 0 &&
    titleWords.length === 0 &&
    tags.length === 0 &&
    folders.length === 0
  ) {
    throw new CliError("empty query");
  }

  return { ordinaryWords, titleWords, excludedWords, tags, folders };
}

function hasTerms(note: Note, required: string[]): boolean {
  if (required.length === 0) return true;
  const available = new Set(note.terms.map(([word]) => word));
  return required.every((word) => available.has(word));
}

function hasTitleWords(note: Note, required: string[]): boolean {
  if (required.length === 0) return true;
  const available = new Set(words(note.title));
  return required.every((word) => available.has(word));
}

function hasTags(note: Note, required: string[]): boolean {
  return required.every((tag) =>
    note.tags.some((noteTag) => noteTag === tag || noteTag.startsWith(`${tag}/`)),
  );
}

function scoreNote(
  note: Note,
  termCounts: Map<string, number>,
  documentFrequencies: Map<string, number>,
  scoringWords: string[],
  noteCount: number,
  averageLength: number,
): number {
  let score = 0;
  for (const word of scoringWords) {
    const tf = termCounts.get(word);
    const df = documentFrequencies.get(word);
    if (tf === undefined || df === undefined) continue;

    score +=
      ((noteCount + 1) / df) *
      ((tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * note.words) / averageLength)));
  }
  return score;
}

export function renderSearch(notes: Note[], operands: string[], limit: number): string {
  const filters = parseQuery(operands);
  const orderedNotes = [...notes].sort((left, right) => compareCodePoints(left.id, right.id));
  const termCounts = new Map<Note, Map<string, number>>();
  const documentFrequencies = new Map<string, number>();
  let totalWords = 0;

  for (const note of orderedNotes) {
    totalWords += note.words;
    const counts = new Map(note.terms);
    termCounts.set(note, counts);
    for (const word of counts.keys()) {
      documentFrequencies.set(word, (documentFrequencies.get(word) ?? 0) + 1);
    }
  }

  const averageLength = orderedNotes.length === 0 ? 0 : totalWords / orderedNotes.length;
  const matches: ScoredNote[] = [];

  for (const note of orderedNotes) {
    const counts = termCounts.get(note);
    if (counts === undefined) continue;
    if (!hasTerms(note, filters.ordinaryWords)) continue;
    if (!hasTitleWords(note, filters.titleWords)) continue;
    if (!hasTags(note, filters.tags)) continue;
    if (
      filters.folders.length > 0 &&
      !filters.folders.some((folder) => note.id.startsWith(`${folder}/`))
    ) {
      continue;
    }
    if (filters.excludedWords.some((word) => counts.has(word))) continue;

    const score =
      filters.ordinaryWords.length === 0
        ? 0
        : scoreNote(
            note,
            counts,
            documentFrequencies,
            filters.ordinaryWords,
            orderedNotes.length,
            averageLength,
          );
    matches.push({ note, score });
  }

  matches.sort((left, right) => {
    const scoreDifference = scaled(right.score) - scaled(left.score);
    return scoreDifference || compareCodePoints(left.note.id, right.note.id);
  });

  const shown = matches.slice(0, limit);
  const lines = shown.map(
    ({ note, score }) => `${score3(scaled(score))}  ${note.id}  ${note.title}`,
  );
  const summary =
    matches.length > limit
      ? `showing ${shown.length} of ${plural(matches.length, "result", "results")}`
      : plural(matches.length, "result", "results");
  lines.push(summary);
  return `${lines.join("\n")}\n`;
}
