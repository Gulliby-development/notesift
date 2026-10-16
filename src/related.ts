import { compareCodePoints } from "./index-file";
import { plural, scaled, score3 } from "./text";
import type { Note } from "./types";

interface Candidate {
  id: string;
  title: string;
  score: number;
}

export function renderRelated(notes: Note[], id: string, limit: number): string {
  const documentFrequency = new Map<string, number>();

  for (const note of notes) {
    for (const [word] of note.terms) {
      documentFrequency.set(word, (documentFrequency.get(word) ?? 0) + 1);
    }
  }

  const words = [...documentFrequency.keys()].sort(compareCodePoints);
  const vectors = new Map<string, Map<string, number>>();

  for (const note of notes) {
    const vector = new Map<string, number>();
    for (const [word, termFrequency] of note.terms) {
      const frequency = documentFrequency.get(word);
      if (frequency !== undefined) {
        vector.set(word, termFrequency * ((notes.length + 1) / frequency));
      }
    }
    vectors.set(note.id, vector);
  }

  const squaredNorms = new Map<string, number>();
  for (const note of notes) {
    const vector = vectors.get(note.id);
    let squaredNorm = 0;
    for (const word of words) {
      const weight = vector?.get(word) ?? 0;
      squaredNorm += weight * weight;
    }
    squaredNorms.set(note.id, squaredNorm);
  }

  const sourceVector = vectors.get(id);
  const sourceNorm = Math.sqrt(squaredNorms.get(id) ?? 0);
  const sourceWords =
    sourceVector === undefined ? [] : [...sourceVector.keys()].sort(compareCodePoints);
  const candidates: Candidate[] = [];

  if (sourceVector !== undefined) {
    for (const note of notes) {
      if (note.id === id) continue;

      const candidateVector = vectors.get(note.id);
      const candidateNorm = Math.sqrt(squaredNorms.get(note.id) ?? 0);
      let dotProduct = 0;
      if (candidateVector !== undefined) {
        for (const word of sourceWords) {
          const sourceWeight = sourceVector.get(word) ?? 0;
          const candidateWeight = candidateVector.get(word) ?? 0;
          dotProduct += sourceWeight * candidateWeight;
        }
      }

      const similarity =
        sourceNorm === 0 || candidateNorm === 0 ? 0 : dotProduct / (sourceNorm * candidateNorm);
      const score = scaled(similarity);
      if (score > 0) candidates.push({ id: note.id, title: note.title, score });
    }
  }

  candidates.sort(
    (left, right) => right.score - left.score || compareCodePoints(left.id, right.id),
  );

  const rows = candidates
    .slice(0, limit)
    .map((candidate) => `${score3(candidate.score)}  ${candidate.id}  ${candidate.title}`);
  rows.push(plural(candidates.length, "related note", "related notes"));
  return `${rows.join("\n")}\n`;
}
