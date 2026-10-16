import { describe, expect, test } from "bun:test";
import { capture } from "../src/capture";
import { CliError, type Io } from "../src/types";

const encoder = new TextEncoder();

interface WriteCall {
  path: string;
  data: Uint8Array;
}

interface HarnessOptions {
  files?: string[];
  input?: Uint8Array;
  initialFiles?: Map<string, Uint8Array>;
  filesError?: Error;
  stdinError?: Error;
  writeError?: Error;
}

interface IoHarness {
  io: Io;
  calls: string[];
  writes: WriteCall[];
  contents: Map<string, Uint8Array>;
}

function memoryIo(options: HarnessOptions = {}): IoHarness {
  const calls: string[] = [];
  const writes: WriteCall[] = [];
  const contents = new Map(options.initialFiles);

  const io: Io = {
    files(dir) {
      calls.push(`files:${dir}`);
      if (options.filesError !== undefined) throw options.filesError;
      return options.files ?? [];
    },
    read(path) {
      calls.push(`read:${path}`);
      throw new Error("capture must not read files");
    },
    write(path, data) {
      calls.push(`write:${path}`);
      if (options.writeError !== undefined) throw options.writeError;
      const stored = new Uint8Array(data);
      writes.push({ path, data: stored });
      contents.set(path, stored);
    },
    readStdin() {
      calls.push("readStdin");
      if (options.stdinError !== undefined) throw options.stdinError;
      return options.input ?? new Uint8Array();
    },
    out(text) {
      calls.push(`out:${text}`);
    },
    err(text) {
      calls.push(`err:${text}`);
    },
  };

  return { io, calls, writes, contents };
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

function expectNoWrites(harness: IoHarness): void {
  expect(harness.writes).toEqual([]);
}

function expectWritten(harness: IoHarness, path: string, expected: string): void {
  expect(harness.writes).toHaveLength(1);
  expect(harness.writes[0].path).toBe(path);
  expect(harness.writes[0].data).toEqual(encoder.encode(expected));
}

describe("capture NAME validation", () => {
  test("accepts a one-character segment and uses its default title", () => {
    const harness = memoryIo();

    expect(capture(harness.io, "notes", "a", null, [])).toBe("wrote a.md\n");
    expectWritten(harness, "notes/a.md", "---\ntitle: A\n---\n");
    expect(harness.calls).toEqual(["readStdin", "files:notes", "write:notes/a.md"]);
  });

  test("accepts nested names, normalizes the directory, and uses only the last segment", () => {
    const harness = memoryIo();

    expect(capture(harness.io, "notes\\\\", "reviews/week-1", null, [])).toBe(
      "wrote reviews/week-1.md\n",
    );
    expectWritten(harness, "notes/reviews/week-1.md", "---\ntitle: Week 1\n---\n");
  });

  test("accepts exactly 64 characters in a segment", () => {
    const sixtyFour =
      "aaaaaaaaaaaaaaaa" + "aaaaaaaaaaaaaaaa" + "aaaaaaaaaaaaaaaa" + "aaaaaaaaaaaaaaaa";
    expect(sixtyFour.length).toBe(64);

    const harness = memoryIo();
    expect(capture(harness.io, "", sixtyFour, null, [])).toBe(`wrote ${sixtyFour}.md\n`);
    expectWritten(harness, `./${sixtyFour}.md`, `---\ntitle: A${sixtyFour.slice(1)}\n---\n`);
    expect(harness.calls).toEqual(["readStdin", "files:.", `write:./${sixtyFour}.md`]);
  });

  test("uppercases the first alphabetic character of a digit-leading default title", () => {
    const harness = memoryIo();

    expect(capture(harness.io, "notes", "2_notes", null, [])).toBe("wrote 2_notes.md\n");
    expectWritten(harness, "notes/2_notes.md", "---\ntitle: 2 Notes\n---\n");
  });

  test("rejects an empty NAME before reading stdin", () => {
    const harness = memoryIo();

    expectCliError(() => capture(harness.io, "notes", "", null, []), 'invalid NAME ""');
    expect(harness.calls).toEqual([]);
    expectNoWrites(harness);
  });

  test("rejects uppercase characters in NAME", () => {
    const harness = memoryIo();

    expectCliError(
      () => capture(harness.io, "notes", "Bad_Name", null, []),
      'invalid NAME "Bad_Name"',
    );
    expect(harness.calls).toEqual([]);
    expectNoWrites(harness);
  });

  test("rejects hidden, empty, traversal, backslash, and extension segments", () => {
    const hidden = memoryIo();
    expectCliError(
      () => capture(hidden.io, "notes", ".hidden", null, []),
      'invalid NAME ".hidden"',
    );
    expect(hidden.calls).toEqual([]);
    expectNoWrites(hidden);

    const emptySegment = memoryIo();
    expectCliError(
      () => capture(emptySegment.io, "notes", "a//b", null, []),
      'invalid NAME "a//b"',
    );
    expect(emptySegment.calls).toEqual([]);
    expectNoWrites(emptySegment);

    const traversal = memoryIo();
    expectCliError(() => capture(traversal.io, "notes", "../a", null, []), 'invalid NAME "../a"');
    expect(traversal.calls).toEqual([]);
    expectNoWrites(traversal);

    const backslash = memoryIo();
    expectCliError(
      () => capture(backslash.io, "notes", "a\\\\b", null, []),
      'invalid NAME "a\\\\b"',
    );
    expect(backslash.calls).toEqual([]);
    expectNoWrites(backslash);

    const extension = memoryIo();
    expectCliError(() => capture(extension.io, "notes", "a.md", null, []), 'invalid NAME "a.md"');
    expect(extension.calls).toEqual([]);
    expectNoWrites(extension);

    const trailingSlash = memoryIo();
    expectCliError(() => capture(trailingSlash.io, "notes", "a/", null, []), 'invalid NAME "a/"');
    expect(trailingSlash.calls).toEqual([]);
    expectNoWrites(trailingSlash);
  });

  test("rejects a 65-character segment at the NAME boundary", () => {
    const sixtyFour =
      "aaaaaaaaaaaaaaaa" + "aaaaaaaaaaaaaaaa" + "aaaaaaaaaaaaaaaa" + "aaaaaaaaaaaaaaaa";
    const sixtyFive = `${sixtyFour}a`;
    expect(sixtyFive.length).toBe(65);
    const harness = memoryIo();

    expectCliError(
      () => capture(harness.io, "notes", sixtyFive, null, []),
      `invalid NAME "${sixtyFive}"`,
    );
    expect(harness.calls).toEqual([]);
    expectNoWrites(harness);
  });
});

describe("capture metadata validation", () => {
  test("rejects blank explicit titles and preserves their original text in errors", () => {
    const spaces = memoryIo();
    expectCliError(() => capture(spaces.io, "notes", "a", "  \t ", []), 'invalid --title "  \t "');
    expect(spaces.calls).toEqual([]);
    expectNoWrites(spaces);

    const tabs = memoryIo();
    expectCliError(() => capture(tabs.io, "notes", "a", "\t\t", []), 'invalid --title "\t\t"');
    expect(tabs.calls).toEqual([]);
    expectNoWrites(tabs);
  });

  test("rejects CR and LF anywhere in explicit titles", () => {
    const carriageReturn = memoryIo();
    expectCliError(
      () => capture(carriageReturn.io, "notes", "a", "line\rbreak", []),
      'invalid --title "line\rbreak"',
    );
    expect(carriageReturn.calls).toEqual([]);
    expectNoWrites(carriageReturn);

    const lineFeed = memoryIo();
    expectCliError(
      () => capture(lineFeed.io, "notes", "a", "line\nbreak", []),
      'invalid --title "line\nbreak"',
    );
    expect(lineFeed.calls).toEqual([]);
    expectNoWrites(lineFeed);
  });

  test("keeps nonblank explicit title whitespace and normalized tags in first-seen order", () => {
    const harness = memoryIo();

    expect(
      capture(harness.io, "notes", "a", "  Review  ", ["Zulu", "alpha", "#ZULU", "Alpha/"]),
    ).toBe("wrote a.md\n");
    expectWritten(harness, "notes/a.md", "---\ntitle:   Review  \ntags: [zulu, alpha]\n---\n");
  });

  test("normalizes the supplied capture example tags", () => {
    const harness = memoryIo({
      input: encoder.encode("Good week.\r\nNext: [[ideas]]\r\n\r\n"),
    });

    expect(capture(harness.io, "notes", "reviews/week-1", "Weekly review", ["Idea", "#plan"])).toBe(
      "wrote reviews/week-1.md\n",
    );
    expectWritten(
      harness,
      "notes/reviews/week-1.md",
      "---\ntitle: Weekly review\ntags: [idea, plan]\n---\n\nGood week.\nNext: [[ideas]]\n",
    );
  });

  test("accepts hierarchical tags and removes a trailing slash before deduplication", () => {
    const harness = memoryIo();

    expect(capture(harness.io, "notes", "a", null, ["Idea", "#plan", "work/active", "plan/"])).toBe(
      "wrote a.md\n",
    );
    expectWritten(harness, "notes/a.md", "---\ntitle: A\ntags: [idea, plan, work/active]\n---\n");
  });

  test("rejects each invalid tag with its original value", () => {
    const numeric = memoryIo();
    expectCliError(() => capture(numeric.io, "notes", "a", null, ["1"]), 'invalid --tag "1"');
    expect(numeric.calls).toEqual([]);
    expectNoWrites(numeric);

    const repeatedSeparator = memoryIo();
    expectCliError(
      () => capture(repeatedSeparator.io, "notes", "a", null, ["a//b"]),
      'invalid --tag "a//b"',
    );
    expect(repeatedSeparator.calls).toEqual([]);
    expectNoWrites(repeatedSeparator);

    const doubleHash = memoryIo();
    expectCliError(
      () => capture(doubleHash.io, "notes", "a", null, ["##plan"]),
      'invalid --tag "##plan"',
    );
    expect(doubleHash.calls).toEqual([]);
    expectNoWrites(doubleHash);

    const hashOnly = memoryIo();
    expectCliError(() => capture(hashOnly.io, "notes", "a", null, ["#"]), 'invalid --tag "#"');
    expect(hashOnly.calls).toEqual([]);
    expectNoWrites(hashOnly);
  });

  test("reports the first invalid tag before reading stdin", () => {
    const harness = memoryIo({
      input: new Uint8Array([0xff, 0xfe]),
    });

    expectCliError(
      () => capture(harness.io, "notes", "a", null, ["Plan", "1", "a//b"]),
      'invalid --tag "1"',
    );
    expect(harness.calls).toEqual([]);
    expectNoWrites(harness);
  });
});

describe("capture stdin decoding and validation order", () => {
  test("reports an invalid NAME before title, tags, stdin, or directory failures", () => {
    const harness = memoryIo({
      input: new Uint8Array([0xff, 0xfe]),
      filesError: new Error("directory unavailable"),
    });

    expectCliError(
      () => capture(harness.io, "notes", "Bad_Name", "", ["1"]),
      'invalid NAME "Bad_Name"',
    );
    expect(harness.calls).toEqual([]);
    expectNoWrites(harness);
  });

  test("reports an invalid title before tag and stdin failures", () => {
    const harness = memoryIo({
      input: new Uint8Array([0xff, 0xfe]),
      filesError: new Error("directory unavailable"),
    });

    expectCliError(() => capture(harness.io, "notes", "a", "\n", ["1"]), 'invalid --title "\n"');
    expect(harness.calls).toEqual([]);
    expectNoWrites(harness);
  });

  test("rejects malformed and truncated UTF-8 bytes through readStdin", () => {
    const malformed = memoryIo({ input: new Uint8Array([0xff, 0xfe]) });
    expectCliError(
      () => capture(malformed.io, "notes", "a", null, []),
      "stdin: input is not valid UTF-8",
    );
    expect(malformed.calls).toEqual(["readStdin"]);
    expectNoWrites(malformed);

    const truncated = memoryIo({ input: new Uint8Array([0xe2, 0x82]) });
    expectCliError(
      () => capture(truncated.io, "notes", "a", null, []),
      "stdin: input is not valid UTF-8",
    );
    expect(truncated.calls).toEqual(["readStdin"]);
    expectNoWrites(truncated);

    const malformedContinuation = memoryIo({ input: new Uint8Array([0xe2, 0x28, 0xa1]) });
    expectCliError(
      () => capture(malformedContinuation.io, "notes", "a", null, []),
      "stdin: input is not valid UTF-8",
    );
    expect(malformedContinuation.calls).toEqual(["readStdin"]);
    expectNoWrites(malformedContinuation);
  });

  test("accepts valid multibyte UTF-8 body bytes", () => {
    const harness = memoryIo({ input: encoder.encode("café — こんにちは 📝") });

    expect(capture(harness.io, "notes", "a", "International", [])).toBe("wrote a.md\n");
    expectWritten(
      harness,
      "notes/a.md",
      "---\ntitle: International\n---\n\ncafé — こんにちは 📝\n",
    );
  });

  test("removes exactly one leading BOM and preserves a second BOM as body text", () => {
    const oneBom = memoryIo({
      input: new Uint8Array([0xef, 0xbb, 0xbf, 0x41]),
    });
    expect(capture(oneBom.io, "notes", "a", null, [])).toBe("wrote a.md\n");
    expectWritten(oneBom, "notes/a.md", "---\ntitle: A\n---\n\nA\n");

    const twoBoms = memoryIo({
      input: new Uint8Array([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x41]),
    });
    expect(capture(twoBoms.io, "notes", "a", null, [])).toBe("wrote a.md\n");
    expectWritten(twoBoms, "notes/a.md", "---\ntitle: A\n---\n\n\uFEFFA\n");
  });

  test("does not enumerate the directory when readStdin throws", () => {
    const failure = new Error("stdin unavailable");
    const harness = memoryIo({ stdinError: failure });

    expect(caughtError(() => capture(harness.io, "notes", "a", null, []))).toBe(failure);
    expect(harness.calls).toEqual(["readStdin"]);
    expectNoWrites(harness);
  });
});

describe("capture file listing and creation", () => {
  test("translates directory listing failures after successful strict decoding", () => {
    const harness = memoryIo({
      input: encoder.encode("body"),
      filesError: new Error("directory unavailable"),
    });

    expectCliError(
      () => capture(harness.io, "notes\\\\", "a", null, []),
      "notes: cannot read the directory",
    );
    expect(harness.calls).toEqual(["readStdin", "files:notes"]);
    expectNoWrites(harness);
  });

  test("checks only the exact case-sensitive NAME.md path", () => {
    const caseDifferent = memoryIo({ files: ["reviews/week-1.MD", "other.md"] });

    expect(capture(caseDifferent.io, "notes/", "reviews/week-1", null, [])).toBe(
      "wrote reviews/week-1.md\n",
    );
    expectWritten(caseDifferent, "notes/reviews/week-1.md", "---\ntitle: Week 1\n---\n");
    expect(caseDifferent.calls).toEqual([
      "readStdin",
      "files:notes",
      "write:notes/reviews/week-1.md",
    ]);

    const exact = memoryIo({ files: ["reviews/week-1.md"] });
    expectCliError(
      () => capture(exact.io, "notes", "reviews/week-1", null, []),
      "reviews/week-1.md: already exists",
    );
    expect(exact.calls).toEqual(["readStdin", "files:notes"]);
    expectNoWrites(exact);
  });

  test("validates stdin before directory listing and existing-file checks", () => {
    const harness = memoryIo({
      input: new Uint8Array([0xff, 0xfe]),
      files: ["a.md"],
    });

    expectCliError(
      () => capture(harness.io, "notes", "a", null, []),
      "stdin: input is not valid UTF-8",
    );
    expect(harness.calls).toEqual(["readStdin"]);
    expectNoWrites(harness);
  });

  test("writes once through Io and leaves index and unrelated files unchanged", () => {
    const index = encoder.encode("existing index bytes");
    const unrelated = encoder.encode("unrelated note");
    const harness = memoryIo({
      files: ["unrelated.md"],
      input: encoder.encode("body"),
      initialFiles: new Map([
        ["notes/.notesift/index.txt", index],
        ["notes/unrelated.md", unrelated],
      ]),
    });

    expect(capture(harness.io, "notes", "new-note", null, [])).toBe("wrote new-note.md\n");
    expectWritten(harness, "notes/new-note.md", "---\ntitle: New note\n---\n\nbody\n");
    expect(harness.calls).toEqual(["readStdin", "files:notes", "write:notes/new-note.md"]);
    expect(harness.contents.size).toBe(3);
    expect(harness.contents.get("notes/.notesift/index.txt")).toEqual(index);
    expect(harness.contents.get("notes/unrelated.md")).toEqual(unrelated);
    expect(harness.contents.get("notes/new-note.md")).toEqual(
      encoder.encode("---\ntitle: New note\n---\n\nbody\n"),
    );
  });

  test("propagates a write exception without returning success", () => {
    const failure = new Error("write unavailable");
    const harness = memoryIo({ writeError: failure });

    expect(caughtError(() => capture(harness.io, "notes", "a", null, []))).toBe(failure);
    expect(harness.calls).toEqual(["readStdin", "files:notes", "write:notes/a.md"]);
    expect(harness.writes).toEqual([]);
  });

  test("calls no read, stdout, or stderr methods on success", () => {
    const harness = memoryIo({ input: encoder.encode("body") });

    expect(capture(harness.io, "notes", "a", null, [])).toBe("wrote a.md\n");
    expect(harness.calls).toEqual(["readStdin", "files:notes", "write:notes/a.md"]);
  });
});

describe("capture body bytes and line endings", () => {
  test("writes the supplied empty-input example without a body separator", () => {
    const harness = memoryIo();

    expect(capture(harness.io, "notes", "reviews/week-2", null, [])).toBe(
      "wrote reviews/week-2.md\n",
    );
    expectWritten(harness, "notes/reviews/week-2.md", "---\ntitle: Week 2\n---\n");
  });

  test("omits a body made only of LF, CRLF, and CR line endings", () => {
    const lf = memoryIo({ input: encoder.encode("\n\n") });
    expect(capture(lf.io, "notes", "a", null, [])).toBe("wrote a.md\n");
    expectWritten(lf, "notes/a.md", "---\ntitle: A\n---\n");

    const crlf = memoryIo({ input: encoder.encode("\r\n\r\n") });
    expect(capture(crlf.io, "notes", "a", null, [])).toBe("wrote a.md\n");
    expectWritten(crlf, "notes/a.md", "---\ntitle: A\n---\n");

    const cr = memoryIo({ input: encoder.encode("\r\r") });
    expect(capture(cr.io, "notes", "a", null, [])).toBe("wrote a.md\n");
    expectWritten(cr, "notes/a.md", "---\ntitle: A\n---\n");
  });

  test("preserves whitespace-only bodies and trailing spaces while normalizing line endings", () => {
    const whitespace = memoryIo({ input: encoder.encode(" \t  \r\n") });
    expect(capture(whitespace.io, "notes", "a", null, [])).toBe("wrote a.md\n");
    expectWritten(whitespace, "notes/a.md", "---\ntitle: A\n---\n\n \t  \n");

    const mixedEndings = memoryIo({ input: encoder.encode("one\rtwo\r\nthree\n\n") });
    expect(capture(mixedEndings.io, "notes", "a", null, [])).toBe("wrote a.md\n");
    expectWritten(mixedEndings, "notes/a.md", "---\ntitle: A\n---\n\none\ntwo\nthree\n");

    const trailingSpaces = memoryIo({ input: encoder.encode("last line  \r\n\r") });
    expect(capture(trailingSpaces.io, "notes", "a", null, [])).toBe("wrote a.md\n");
    expectWritten(trailingSpaces, "notes/a.md", "---\ntitle: A\n---\n\nlast line  \n");
  });
});
