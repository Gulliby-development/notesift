import { asciiLower } from "./text";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "with",
]);

export function words(text: string): string[] {
  const result: string[] = [];
  for (const match of text.matchAll(/[A-Za-z0-9]+/g)) {
    const word = asciiLower(match[0]);
    if (!STOP_WORDS.has(word)) result.push(word);
  }
  return result;
}
