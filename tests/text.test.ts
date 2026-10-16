import { describe, expect, test } from "bun:test";
import { normalizeTag, parseNote } from "../src/note";
import {
  asciiLower,
  decodeLossy,
  decodeStrict,
  escapeField,
  fnv1a,
  plural,
  scaled,
  score3,
  unescapeField,
} from "../src/text";
import { words } from "../src/tokens";
import {
  CliError,
  type Graph,
  type Io,
  type Link,
  type Note,
  type Resolution,
  type Result,
} from "../src/types";

describe("public core declarations and function signatures", () => {
  test("matches the shared types and all helper signatures", () => {
    const decodeLossyContract: (bytes: Uint8Array) => string = decodeLossy;
    const decodeStrictContract: (bytes: Uint8Array) => string | null = decodeStrict;
    const fnv1aContract: (bytes: Uint8Array) => string = fnv1a;
    const escapeFieldContract: (value: string) => string = escapeField;
    const unescapeFieldContract: (value: string) => string | null = unescapeField;
    const asciiLowerContract: (value: string) => string = asciiLower;
    const pluralContract: (count: number, one: string, many: string) => string = plural;
    const scaledContract: (value: number) => number = scaled;
    const score3Contract: (value: number) => string = score3;
    const wordsContract: (value: string) => string[] = words;
    const normalizeTagContract: (value: string) => string | null = normalizeTag;
    const parseNoteContract: (id: string, bytes: Uint8Array) => Note = parseNote;

    const link: Link = { line: 3, target: "destination" };
    const note: Note = {
      id: "source",
      hash: "0123abcd",
      words: 2,
      title: "Source note",
      tags: ["project"],
      aliases: ["origin"],
      links: [link],
      terms: [
        ["source", 3],
        ["note", 1],
      ],
    };
    const resolutions: Resolution[] = [
      { kind: "ok", id: note.id },
      { kind: "broken" },
      { kind: "ambiguous", ids: [note.id, "other"] },
    ];
    const graph: Graph = {
      out: new Map([[note.id, ["destination"]]]),
      inn: new Map([["destination", [note.id]]]),
      broken: [{ id: note.id, line: 4, target: "missing" }],
      ambiguous: [{ id: note.id, line: 5, target: "shared", ids: ["a", "b"] }],
    };
    const result: Result = { text: "ok\n", code: 0 };
    const io: Io = {
      files: (_dir) => ["source.md"],
      read: (_path) => new Uint8Array([1]),
      write: (_path, _data) => undefined,
      readStdin: () => new Uint8Array([2]),
      out: (_text) => undefined,
      err: (_text) => undefined,
    };
    const error: CliError = new CliError("failure");

    expect(decodeLossyContract(new Uint8Array())).toBe("");
    expect(decodeStrictContract(new Uint8Array())).toBe("");
    expect(fnv1aContract(new Uint8Array())).toBe("811c9dc5");
    expect(escapeFieldContract("")).toBe("");
    expect(unescapeFieldContract("")).toBe("");
    expect(asciiLowerContract("AZ")).toBe("az");
    expect(pluralContract(1, "note", "notes")).toBe("1 note");
    expect(scaledContract(0)).toBe(0);
    expect(score3Contract(0)).toBe("0.000");
    expect(wordsContract("Alpha")).toEqual(["alpha"]);
    expect(normalizeTagContract("Plan")).toBe("plan");
    expect(parseNoteContract("x", new Uint8Array()).id).toBe("x");
    expect(note.links).toEqual([link]);
    expect(resolutions.map((resolution) => resolution.kind)).toEqual(["ok", "broken", "ambiguous"]);
    expect(graph.out.get(note.id)).toEqual(["destination"]);
    expect(graph.inn.get("destination")).toEqual([note.id]);
    expect(graph.broken[0].target).toBe("missing");
    expect(graph.ambiguous[0].ids).toEqual(["a", "b"]);
    expect(result).toEqual({ text: "ok\n", code: 0 });
    expect(io.files(".")).toEqual(["source.md"]);
    expect(io.read("source.md")).toEqual(new Uint8Array([1]));
    expect(io.readStdin()).toEqual(new Uint8Array([2]));
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("failure");
  });
});

describe("UTF-8 decoding", () => {
  test("decodes empty, ASCII, and multibyte UTF-8 byte arrays", () => {
    expect(decodeLossy(new Uint8Array([]))).toBe("");
    expect(decodeLossy(new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]))).toBe("hello");
    expect(decodeLossy(new Uint8Array([0xc3, 0xa9, 0xe2, 0x82, 0xac]))).toBe("é€");
    expect(decodeStrict(new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]))).toBe("hello");
    expect(decodeStrict(new Uint8Array([0xc3, 0xa9, 0xe2, 0x82, 0xac]))).toBe("é€");
  });

  test("removes exactly one leading UTF-8 BOM", () => {
    expect(decodeLossy(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe("A");
    expect(decodeStrict(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe("A");
    expect(decodeLossy(new Uint8Array([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x41]))).toBe("\uFEFFA");
    expect(decodeStrict(new Uint8Array([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x41]))).toBe(
      "\uFEFFA",
    );
    expect(decodeLossy(new Uint8Array([0x41, 0xef, 0xbb, 0xbf]))).toBe("A\uFEFF");
  });

  test("replaces malformed UTF-8 and rejects it in strict mode", () => {
    expect(decodeLossy(new Uint8Array([0xff, 0xfe]))).toBe("��");
    expect(decodeStrict(new Uint8Array([0xff, 0xfe]))).toBeNull();

    expect(decodeLossy(new Uint8Array([0xe2, 0x82]))).toBe("�");
    expect(decodeStrict(new Uint8Array([0xe2, 0x82]))).toBeNull();

    expect(decodeLossy(new Uint8Array([0xe2, 0x28, 0xa1]))).toBe("�(�");
    expect(decodeStrict(new Uint8Array([0xe2, 0x28, 0xa1]))).toBeNull();
  });
});

describe("FNV-1a byte hashing", () => {
  test("matches known hashes, including the empty-byte hash", () => {
    expect(fnv1a(new Uint8Array([]))).toBe("811c9dc5");
    expect(fnv1a(new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]))).toBe("4f9f2cab");
  });

  test("hashes the original bytes rather than their normalized text", () => {
    expect(fnv1a(new Uint8Array([0x41]))).toBe("c40bf6cc");
    expect(fnv1a(new Uint8Array([0x61]))).toBe("e40c292c");
    expect(fnv1a(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe("d19b6453");
  });
});

describe("field escaping", () => {
  test("escapes and round-trips backslash, TAB, CR, and LF", () => {
    const original = "slash\\ tab\tcarriage\rline\n";
    const escaped = "slash\\\\ tab\\tcarriage\\rline\\n";
    expect(escapeField(original)).toBe(escaped);
    expect(unescapeField(escaped)).toBe(original);
    expect(escapeField("")).toBe("");
    expect(unescapeField("")).toBe("");
  });

  test("rejects unknown and dangling escapes", () => {
    expect(unescapeField("\\x")).toBeNull();
    expect(unescapeField("dangling\\")).toBeNull();
  });
});

describe("ASCII text helpers", () => {
  test("lowercases only ASCII uppercase letters", () => {
    expect(asciiLower("AZé")).toBe("azé");
    expect(asciiLower("ÄÖẞ")).toBe("ÄÖẞ");
    expect(asciiLower("Already lower 123")).toBe("already lower 123");
  });

  test("pluralizes only the count one", () => {
    expect(plural(1, "note", "notes")).toBe("1 note");
    expect(plural(2, "note", "notes")).toBe("2 notes");
    expect(plural(0, "note", "notes")).toBe("0 notes");
  });

  test("rounds scaled values with the prescribed floor-plus-half rule", () => {
    expect(scaled(3.521)).toBe(3521);
    expect(scaled(1.2345)).toBe(1235);
    expect(scaled(1.2344)).toBe(1234);
    expect(scaled(-1.2345)).toBe(-1234);
    expect(scaled(0)).toBe(0);
  });

  test("formats scaled integers with exactly three decimal places", () => {
    expect(score3(3521)).toBe("3.521");
    expect(score3(5)).toBe("0.005");
    expect(score3(0)).toBe("0.000");
    expect(score3(-3521)).toBe("-3.521");
  });
});
