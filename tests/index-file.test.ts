import { describe, expect, test } from "bun:test";
import { formatIndex, parseIndex } from "../src/index-file";
import { loadIndex } from "../src/scan";
import { fnv1a } from "../src/text";
import { CliError, type Io, type Note } from "../src/types";

const encoder = new TextEncoder();

function checksummedIndex(prefix: string): string {
  return `${prefix}end\t${fnv1a(encoder.encode(prefix))}\n`;
}

function expectDamaged(prefix: string): void {
  expect(parseIndex(checksummedIndex(prefix))).toBeNull();
}

function emptyNote(id: string): Note {
  return {
    id,
    hash: "00000000",
    words: 0,
    title: id,
    tags: [],
    aliases: [],
    links: [],
    terms: [],
  };
}

function memoryIndexIo(
  contents: Map<string, Uint8Array>,
  unreadablePaths: Set<string> = new Set(),
): {
  io: Io;
  fileCalls: number;
  readCalls: string[];
  writes: string[];
} {
  let fileCalls = 0;
  const readCalls: string[] = [];
  const writes: string[] = [];
  const io: Io = {
    files() {
      fileCalls += 1;
      return [];
    },
    read(path) {
      readCalls.push(path);
      if (unreadablePaths.has(path)) throw new Error("file unavailable");
      const bytes = contents.get(path);
      if (bytes === undefined) throw new Error("file unavailable");
      return bytes;
    },
    write(path) {
      writes.push(path);
    },
    readStdin() {
      return new Uint8Array();
    },
    out() {},
    err() {},
  };

  return {
    io,
    get fileCalls() {
      return fileCalls;
    },
    readCalls,
    writes,
  };
}

function expectCliError(action: () => unknown, message: string): void {
  let error: unknown;
  try {
    action();
  } catch (caught) {
    error = caught;
  }

  expect(error).toBeInstanceOf(CliError);
  expect(error instanceof Error ? error.message : "").toBe(message);
}

describe("index file signatures", () => {
  test("exports the promised formatter and parser signatures", () => {
    const formatContract: (notes: Note[]) => string = formatIndex;
    const parseContract: (text: string) => Note[] | null = parseIndex;

    expect(formatContract([])).toBe(checksummedIndex("notesift-index 1\n"));
    expect(parseContract(checksummedIndex("notesift-index 1\n"))).toEqual([]);
  });
});

describe("index serialization and round trips", () => {
  test("writes the empty index with a checksummed terminal LF", () => {
    const expectedPrefix = "notesift-index 1\n";
    const formatted = formatIndex([]);

    expect(formatted).toBe(checksummedIndex(expectedPrefix));
    expect(parseIndex(formatted)).toEqual([]);
    expect(formatted.endsWith("\n")).toBe(true);
    expect(formatted.startsWith("\uFEFF")).toBe(false);
    expect(formatted).not.toContain("\r");
  });

  test("writes literal records with exact escaping and preserves canonical child order", () => {
    const escapedNote: Note = {
      id: "z/日本",
      hash: "89abcdef",
      words: 12,
      title: "Title\twith\\slash\r\nline",
      tags: ["plan", "work/active"],
      aliases: ["first\\alias", "second\nalias"],
      links: [
        { line: 7, target: "folder\\target\nend" },
        { line: 2, target: "tab\tvalue" },
      ],
      terms: [
        ["alpha", 4],
        ["βeta", 1],
      ],
    };
    const firstNote: Note = {
      id: "a",
      hash: "0123abcd",
      words: 0,
      title: "A",
      tags: ["plan"],
      aliases: ["Alias"],
      links: [{ line: 0, target: "zero" }],
      terms: [["alpha", 12]],
    };
    const expectedPrefix =
      "notesift-index 1\n" +
      "N\ta\t0123abcd\t0\tA\n" +
      "T\tplan\n" +
      "A\tAlias\n" +
      "L\t0\tzero\n" +
      "W\talpha\t12\n" +
      "N\tz/日本\t89abcdef\t12\tTitle\\twith\\\\slash\\r\\nline\n" +
      "T\tplan\n" +
      "T\twork/active\n" +
      "A\tfirst\\\\alias\n" +
      "A\tsecond\\nalias\n" +
      "L\t7\tfolder\\\\target\\nend\n" +
      "L\t2\ttab\\tvalue\n" +
      "W\talpha\t4\n" +
      "W\tβeta\t1\n";
    const formatted = formatIndex([escapedNote, firstNote]);

    expect(formatted).toBe(checksummedIndex(expectedPrefix));
    expect(formatted).toContain(`end\t${fnv1a(encoder.encode(expectedPrefix))}\n`);
    expect(parseIndex(formatted)).toEqual([firstNote, escapedNote]);
    expect(formatted.startsWith("\uFEFF")).toBe(false);
    expect(formatted).not.toContain("\r");
    expect(formatted.endsWith("\n")).toBe(true);
  });

  test("orders identifiers by Unicode code point rather than UTF-16 code unit", () => {
    const supplementaryNote = emptyNote("\u{10000}");
    const privateUseNote = emptyNote("\uE000");
    const parsed = parseIndex(formatIndex([supplementaryNote, privateUseNote]));

    expect(parsed?.map((note) => note.id)).toEqual(["\uE000", "\u{10000}"]);
  });

  test("round-trips every Note field from a checksummed literal index", () => {
    const prefix =
      "notesift-index 1\n" +
      "N\tnested/é\tabcdef01\t001\tUnicode title\n" +
      "T\tplan\n" +
      "T\twork/active\n" +
      "A\tFirst alias\n" +
      "A\tsecond alias\n" +
      "L\t12\tdestination\n" +
      "W\talpha\t0\n" +
      "W\tplan\t12\n";
    const expected: Note[] = [
      {
        id: "nested/é",
        hash: "abcdef01",
        words: 1,
        title: "Unicode title",
        tags: ["plan", "work/active"],
        aliases: ["First alias", "second alias"],
        links: [{ line: 12, target: "destination" }],
        terms: [
          ["alpha", 0],
          ["plan", 12],
        ],
      },
    ];

    expect(parseIndex(checksummedIndex(prefix))).toEqual(expected);
  });

  test("accepts 0, 12, and zero-padded digit-only numbers", () => {
    const prefix =
      "notesift-index 1\n" +
      "N\talpha\t0123abcd\t001\tAlpha\n" +
      "L\t0\tzero-line\n" +
      "W\talpha\t12\n";

    expect(parseIndex(checksummedIndex(prefix))).toEqual([
      {
        id: "alpha",
        hash: "0123abcd",
        words: 1,
        title: "Alpha",
        tags: [],
        aliases: [],
        links: [{ line: 0, target: "zero-line" }],
        terms: [["alpha", 12]],
      },
    ]);
  });
});

describe("index loading", () => {
  test("loads valid notes by reading only the normalized index path", () => {
    const expected = [emptyNote("alpha")];
    const path = "notes/.notesift/index.txt";
    const harness = memoryIndexIo(new Map([[path, encoder.encode(formatIndex(expected))]]));

    expect(loadIndex(harness.io, "notes\\\\")).toEqual(expected);
    expect(harness.fileCalls).toBe(0);
    expect(harness.readCalls).toEqual([path]);
    expect(harness.writes).toEqual([]);
  });

  test("reports missing and unreadable indexes with the exact no-index error", () => {
    const path = "other/.notesift/index.txt";
    const missing = memoryIndexIo(new Map());
    const message = `${path}: no index (run "notesift index" first)`;

    expectCliError(() => loadIndex(missing.io, "other"), message);
    expect(missing.fileCalls).toBe(0);
    expect(missing.readCalls).toEqual([path]);
    expect(missing.writes).toEqual([]);

    const unreadable = memoryIndexIo(new Map([[path, encoder.encode("index")]]), new Set([path]));
    expectCliError(() => loadIndex(unreadable.io, "other"), message);
    expect(unreadable.fileCalls).toBe(0);
    expect(unreadable.readCalls).toEqual([path]);
    expect(unreadable.writes).toEqual([]);
  });

  test("reports damaged and invalid-UTF-8 indexes with the exact damaged-index error", () => {
    const path = "vault/.notesift/index.txt";
    const message = `${path}: damaged index (run "notesift index" again)`;
    const damaged = memoryIndexIo(new Map([[path, encoder.encode("junk\\n")]]));
    expectCliError(() => loadIndex(damaged.io, "vault"), message);
    expect(damaged.fileCalls).toBe(0);
    expect(damaged.readCalls).toEqual([path]);
    expect(damaged.writes).toEqual([]);

    const invalidUtf8 = memoryIndexIo(new Map([[path, new Uint8Array([0xff, 0xfe])]]));
    expectCliError(() => loadIndex(invalidUtf8.io, "vault"), message);
    expect(invalidUtf8.fileCalls).toBe(0);
    expect(invalidUtf8.readCalls).toEqual([path]);
    expect(invalidUtf8.writes).toEqual([]);
  });
});

describe("index validation", () => {
  test("rejects missing final LF, a wrong header, and a missing end record", () => {
    expect(parseIndex("notesift-index 1\nend\t811c9dc5")).toBeNull();
    expectDamaged("notesift-index 2\n");
    expect(parseIndex("notesift-index 1\n")).toBeNull();
  });

  test("rejects malformed end records and incorrect checksums", () => {
    expect(parseIndex("notesift-index 1\nend\t1234567g\n")).toBeNull();
    expect(parseIndex("notesift-index 1\nend\t811c9dc5\textra\n")).toBeNull();
    expect(parseIndex("notesift-index 1\nend\tffffffff\n")).toBeNull();
  });

  test("rejects unknown and malformed record shapes with valid checksums", () => {
    expectDamaged("notesift-index 1\nX\tunknown\n");
    expectDamaged("notesift-index 1\nN\talpha\t0123abcd\t0\n");
    expectDamaged("notesift-index 1\nN\talpha\t0123abcd\t0\tAlpha\nT\tplan\textra\n");
    expectDamaged("notesift-index 1\nN\talpha\t0123abcd\t0\tAlpha\nA\talias\textra\n");
    expectDamaged("notesift-index 1\nN\talpha\t0123abcd\t0\tAlpha\nL\t3\ttarget\textra\n");
    expectDamaged("notesift-index 1\nN\talpha\t0123abcd\t0\tAlpha\nW\tword\n");
    expectDamaged("notesift-index 1\nT\tbefore-note\n");
  });

  test("rejects invalid escapes in every escaped field kind", () => {
    expectDamaged("notesift-index 1\nN\tbad\\x\t0123abcd\t0\tTitle\n");
    expectDamaged("notesift-index 1\nN\talpha\t0123abcd\t0\tbad\\x\n");
    expectDamaged("notesift-index 1\nN\talpha\t0123abcd\t0\tTitle\nA\tbad\\x\n");
    expectDamaged("notesift-index 1\nN\talpha\t0123abcd\t0\tTitle\nL\t1\tbad\\x\n");
  });

  test("rejects malformed note hashes", () => {
    expectDamaged("notesift-index 1\nN\talpha\tshort\t0\tAlpha\n");
    expectDamaged("notesift-index 1\nN\talpha\t0123ABCD\t0\tAlpha\n");
    expectDamaged("notesift-index 1\nN\talpha\t0123abcg\t0\tAlpha\n");
  });

  test("rejects signs, decimal points, and exponents in every numeric record", () => {
    expectDamaged("notesift-index 1\nN\talpha\t0123abcd\t-1\tAlpha\n");
    expectDamaged("notesift-index 1\nN\talpha\t0123abcd\t+1\tAlpha\n");
    expectDamaged("notesift-index 1\nN\talpha\t0123abcd\t1.0\tAlpha\n");
    expectDamaged("notesift-index 1\nN\talpha\t0123abcd\t1e2\tAlpha\n");
    expectDamaged("notesift-index 1\nN\talpha\t0123abcd\t0\tAlpha\nL\t-1\ttarget\n");
    expectDamaged("notesift-index 1\nN\talpha\t0123abcd\t0\tAlpha\nW\tword\t1.0\n");
  });

  test("rejects duplicate and descending note identifiers", () => {
    expectDamaged("notesift-index 1\nN\ta\t0123abcd\t0\tA\nN\ta\t0123abcd\t0\tA\n");
    expectDamaged("notesift-index 1\nN\tb\t0123abcd\t0\tB\nN\ta\t0123abcd\t0\tA\n");
  });
});
