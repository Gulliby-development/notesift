export interface Link {
  line: number;
  target: string;
}

export interface Note {
  id: string;
  hash: string;
  words: number;
  title: string;
  tags: string[];
  aliases: string[];
  links: Link[];
  terms: [string, number][];
}

export type Resolution =
  | { kind: "ok"; id: string }
  | { kind: "broken" }
  | { kind: "ambiguous"; ids: string[] };

export interface Graph {
  out: Map<string, string[]>;
  inn: Map<string, string[]>;
  broken: { id: string; line: number; target: string }[];
  ambiguous: { id: string; line: number; target: string; ids: string[] }[];
}

export interface Result {
  text: string;
  code: number;
}

export interface Io {
  files(dir: string): string[];
  read(path: string): Uint8Array;
  write(path: string, data: Uint8Array): void;
  readStdin(): Uint8Array;
  out(text: string): void;
  err(text: string): void;
}

export class CliError extends Error {}
