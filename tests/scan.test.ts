import { describe, expect, test } from "bun:test";
import { formatIndex } from "../src/index-file";
import { parseNote } from "../src/note";
import { cleanDir, indexPath, loadIndex, noteIds, refresh } from "../src/scan";
import { CliError, type Io, type Note } from "../src/types";

const encoder = new TextEncoder();

interface IoHarness {
  io: Io;
  fileCalls: string[];
  readCalls: string[];
  writes: { path: string; data: Uint8Array }[];
}

function memoryIo(
  files: string[],
  contents: Map<string, Uint8Array>,
  options: { failFiles?: boolean; failReads?: Set<string> } = {},
): IoHarness {
  const fileCalls: string[] = [];
  const readCalls: string[] = [];
  const writes: { path: string; data: Uint8Array }[] = [];

  return {
    fileCalls,
    readCalls,
    writes,
    io: {
      files(dir) {
        fileCalls.push(dir);
        if (options.failFiles) throw new Error("directory unavailable");
        return files;
      },
      read(path) {
        readCalls.push(path);
        if (options.failReads?.has(path)) throw new Error("file unavailable");
        const bytes = contents.get(path);
        if (bytes === undefined) throw new Error("file unavailable");
        return bytes;
      },
      write(path, data) {
        writes.push({ path, data });
      },
      readStdin() {
        return new Uint8Array();
      },
      out() {},
      err() {},
    },
  };
}

function caughtError(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}

function expectCliError(action: () => unknown, message: string): void {
  const error = caughtError(action);
  expect(error).toBeInstanceOf(CliError);
  expect(error instanceof Error ? error.message : "").toBe(message);
}

function note(id: string, text: string): Note {
  return parseNote(id, encoder.encode(text));
}

describe("scan path and file helpers", () => {
  test("normalizes Windows separators, trailing separators, and empty directories", () => {
    expect(cleanDir("C:\\notes\\")).toBe("C:/notes");
    expect(cleanDir("folder///")).toBe("folder");
    expect(cleanDir("")).toBe(".");
    expect(cleanDir("\\\\")).toBe(".");
    expect(indexPath("C:\\notes\\")).toBe("C:/notes/.notesift/index.txt");
    expect(indexPath("")).toBe("./.notesift/index.txt");
  });

  test("selects visible exact-case Markdown files and sorts ids", () => {
    expect(
      noteIds([
        "z.md",
        "projects/alpha.md",
        ".hidden/a.md",
        "a/.hidden.md",
        "a.MD",
        "nested/visible.md",
        "notes/.private/secret.md",
        "a.md",
      ]),
    ).toEqual(["a", "nested/visible", "projects/alpha", "z"]);
  });
});

describe("incremental refresh through Io", () => {
  test("reads every visible note in id order and returns a canonical initial scan", () => {
    const a = encoder.encode("# Alpha\n");
    const nested = encoder.encode("---\ntitle: Nested beta\n---\n");
    const z = encoder.encode("# Zulu\n");
    const harness = memoryIo(
      ["z.md", "folder/b.md", "a.MD", ".hidden/skip.md", "folder/.private/skip.md", "a.md"],
      new Map([
        ["vault/a.md", a],
        ["vault/folder/b.md", nested],
        ["vault/z.md", z],
      ]),
    );

    const result = refresh(harness.io, "vault\\", null);

    expect(result).toEqual({
      notes: [parseNote("a", a), parseNote("folder/b", nested), parseNote("z", z)],
      added: 3,
      changed: 0,
      removed: 0,
      unchanged: 0,
    });
    expect(result.notes.map((item) => item.id)).toEqual(["a", "folder/b", "z"]);
    expect(result.notes.map((item) => item.title)).toEqual(["Alpha", "Nested beta", "Zulu"]);
    expect(harness.fileCalls).toEqual(["vault"]);
    expect(harness.readCalls).toEqual(["vault/a.md", "vault/folder/b.md", "vault/z.md"]);
    expect(harness.writes).toEqual([]);
  });

  test("reuses unchanged objects and counts changed, added, and removed notes", () => {
    const stableBytes = encoder.encode("# Stable\n");
    const oldChangedBytes = encoder.encode("# Old title\n");
    const changedBytes = encoder.encode("# New title\n");
    const addedBytes = encoder.encode("# Added\n");
    const stable = parseNote("a", stableBytes);
    const removed = note("gone", "# Gone\n");
    const changed = parseNote("b", oldChangedBytes);
    const harness = memoryIo(
      ["c.md", "b.md", "a.md"],
      new Map([
        ["notes/a.md", stableBytes],
        ["notes/b.md", changedBytes],
        ["notes/c.md", addedBytes],
      ]),
    );

    const result = refresh(harness.io, "notes", [removed, changed, stable]);

    expect(result).toEqual({
      notes: [stable, parseNote("b", changedBytes), parseNote("c", addedBytes)],
      added: 1,
      changed: 1,
      removed: 1,
      unchanged: 1,
    });
    expect(result.notes[0]).toBe(stable);
    expect(result.notes[1].title).toBe("New title");
    expect(harness.fileCalls).toEqual(["notes"]);
    expect(harness.readCalls).toEqual(["notes/a.md", "notes/b.md", "notes/c.md"]);
    expect(harness.writes).toEqual([]);
  });

  test("handles empty directories with both an empty prior index and removed prior notes", () => {
    const noPrevious = memoryIo([], new Map());
    expect(refresh(noPrevious.io, "", null)).toEqual({
      notes: [],
      added: 0,
      changed: 0,
      removed: 0,
      unchanged: 0,
    });
    expect(noPrevious.fileCalls).toEqual(["."]);
    expect(noPrevious.readCalls).toEqual([]);
    expect(noPrevious.writes).toEqual([]);

    const previous = note("old", "# Old\n");
    const removed = memoryIo([], new Map());
    expect(refresh(removed.io, "notes", [previous])).toEqual({
      notes: [],
      added: 0,
      changed: 0,
      removed: 1,
      unchanged: 0,
    });
    expect(removed.fileCalls).toEqual(["notes"]);
    expect(removed.readCalls).toEqual([]);
    expect(removed.writes).toEqual([]);
  });

  test("reports directory enumeration failures with the normalized directory", () => {
    const harness = memoryIo([], new Map(), { failFiles: true });

    expectCliError(
      () => refresh(harness.io, "folder\\", null),
      "folder: cannot read the directory",
    );
    expect(harness.fileCalls).toEqual(["folder"]);
    expect(harness.readCalls).toEqual([]);
    expect(harness.writes).toEqual([]);
  });

  test("reports note read failures with the complete normalized note path", () => {
    const harness = memoryIo(["nested/alpha.md"], new Map(), {
      failReads: new Set(["folder/nested/alpha.md"]),
    });

    expectCliError(
      () => refresh(harness.io, "folder\\", null),
      "folder/nested/alpha.md: cannot read the file",
    );
    expect(harness.fileCalls).toEqual(["folder"]);
    expect(harness.readCalls).toEqual(["folder/nested/alpha.md"]);
    expect(harness.writes).toEqual([]);
  });
});

describe("index loading through Io", () => {
  test("loads a valid index using only its normalized index path", () => {
    const expected = [
      note("alpha", "---\ntitle: Alpha\ntags: [plan]\n---\nBody text.\n"),
      note("nested/beta", "# Beta\n"),
    ];
    const indexBytes = encoder.encode(formatIndex(expected));
    const harness = memoryIo([], new Map([["notes/.notesift/index.txt", indexBytes]]), {
      failFiles: true,
    });

    expect(loadIndex(harness.io, "notes\\")).toEqual(expected);
    expect(harness.fileCalls).toEqual([]);
    expect(harness.readCalls).toEqual(["notes/.notesift/index.txt"]);
    expect(harness.writes).toEqual([]);
  });

  test("reports a missing or unreadable index with the exact no-index error", () => {
    const missing = memoryIo([], new Map());
    expectCliError(
      () => loadIndex(missing.io, "other"),
      'other/.notesift/index.txt: no index (run "notesift index" first)',
    );
    expect(missing.fileCalls).toEqual([]);
    expect(missing.readCalls).toEqual(["other/.notesift/index.txt"]);
    expect(missing.writes).toEqual([]);

    const unreadable = memoryIo([], new Map(), {
      failReads: new Set(["other/.notesift/index.txt"]),
    });
    expectCliError(
      () => loadIndex(unreadable.io, "other"),
      'other/.notesift/index.txt: no index (run "notesift index" first)',
    );
    expect(unreadable.fileCalls).toEqual([]);
    expect(unreadable.readCalls).toEqual(["other/.notesift/index.txt"]);
    expect(unreadable.writes).toEqual([]);
  });

  test("treats malformed index text as damaged without scanning notes", () => {
    const harness = memoryIo(
      ["unrelated.md"],
      new Map([["notes/.notesift/index.txt", encoder.encode("junk\n")]]),
      { failFiles: true },
    );

    expectCliError(
      () => loadIndex(harness.io, "notes"),
      'notes/.notesift/index.txt: damaged index (run "notesift index" again)',
    );
    expect(harness.fileCalls).toEqual([]);
    expect(harness.readCalls).toEqual(["notes/.notesift/index.txt"]);
    expect(harness.writes).toEqual([]);
  });

  test("passes exact invalid UTF-8 index bytes through Io and reports a damaged index", () => {
    const invalidUtf8 = new Uint8Array([0xff, 0xfe]);
    const harness = memoryIo([], new Map([["vault/.notesift/index.txt", invalidUtf8]]), {
      failFiles: true,
    });

    expectCliError(
      () => loadIndex(harness.io, "vault"),
      'vault/.notesift/index.txt: damaged index (run "notesift index" again)',
    );
    expect(harness.fileCalls).toEqual([]);
    expect(harness.readCalls).toEqual(["vault/.notesift/index.txt"]);
    expect(harness.writes).toEqual([]);
  });
});
