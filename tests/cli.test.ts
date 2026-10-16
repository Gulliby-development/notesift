import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { run } from "../src/cli";
import { formatIndex } from "../src/index-file";
import { parseNote } from "../src/note";
import { indexPath } from "../src/scan";
import type { Io, Note } from "../src/types";

const encoder = new TextEncoder();
const HELP =
  "usage: notesift index [--dir DIR]\n" +
  "       notesift search [--dir DIR] [--limit N] QUERY...\n" +
  "       notesift links [--dir DIR] NOTE\n" +
  "       notesift backlinks [--dir DIR] NOTE\n" +
  "       notesift check [--dir DIR]\n" +
  "       notesift path [--dir DIR] FROM TO\n" +
  "       notesift related [--dir DIR] [--limit N] NOTE\n" +
  "       notesift tags [--dir DIR] [TAG]\n" +
  "       notesift stats [--dir DIR]\n" +
  "       notesift export [--dir DIR] --format json|dot|csv|md\n" +
  "       notesift capture [--dir DIR] [--title TEXT] [--tag TAG]... NAME\n";

interface WriteCall {
  path: string;
  data: Uint8Array;
}

interface HarnessOptions {
  files?: readonly string[];
  initialFiles?: Map<string, Uint8Array>;
  stdin?: Uint8Array;
  filesError?: Error;
  readErrors?: Set<string>;
  writeError?: Error;
  outError?: Error;
}

interface IoHarness {
  io: Io;
  contents: Map<string, Uint8Array>;
  fileCalls: string[];
  readCalls: string[];
  writes: WriteCall[];
  stdinCalls: number;
  stdout: string;
  stderr: string;
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function memoryIo(options: HarnessOptions = {}): IoHarness {
  const contents = new Map(options.initialFiles);
  const fileCalls: string[] = [];
  const readCalls: string[] = [];
  const writes: WriteCall[] = [];
  let stdinCalls = 0;
  let stdout = "";
  let stderr = "";

  const io: Io = {
    files(dir) {
      fileCalls.push(dir);
      if (options.filesError !== undefined) throw options.filesError;
      return [...(options.files ?? [])];
    },
    read(path) {
      readCalls.push(path);
      if (options.readErrors?.has(path)) throw new Error("injected read failure");
      const bytes = contents.get(path);
      if (bytes === undefined) throw new Error("file unavailable");
      return copyBytes(bytes);
    },
    write(path, data) {
      const stored = copyBytes(data);
      writes.push({ path, data: stored });
      if (options.writeError !== undefined) throw options.writeError;
      contents.set(path, stored);
    },
    readStdin() {
      stdinCalls += 1;
      return copyBytes(options.stdin ?? new Uint8Array());
    },
    out(text) {
      if (options.outError !== undefined) throw options.outError;
      stdout += text;
    },
    err(text) {
      stderr += text;
    },
  };

  return {
    io,
    contents,
    fileCalls,
    readCalls,
    writes,
    get stdinCalls() {
      return stdinCalls;
    },
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

function note(id: string, text: string): Note {
  return parseNote(id, encoder.encode(text));
}

function fiveExampleNotes(): Note[] {
  return [
    note(
      "ideas",
      "---\ntitle: Ideas\ntags: [inbox]\naliases: [brainstorm]\n---\n" +
        "Rough ideas for the [[projects/alpha|alpha launch]] and a #garden plan.\n" +
        "See [[todo]] and [[missing-note]].",
    ),
    note(
      "projects/alpha",
      "---\ntitle: Alpha project\ntags: [work/active, Plan]\n---\n# Alpha\n" +
        "Plan the launch with [[projects/beta]]. The launch needs a plan and a plan review.\n" +
        "\u0060\u0060\u0060text\n[[not-a-link]] #nottag\n\u0060\u0060\u0060",
    ),
    note(
      "projects/beta",
      "# Beta project\nWaiting for the [[alpha]] review. Tags: #work/active #2024",
    ),
    note(
      "daily/todo",
      "---\naliases: [brainstorm]\n---\nWater the plants. Read about the launch plan.",
    ),
    note("work/todo", "# Todo\nCall the vendor about the garden."),
  ];
}

function twoExampleNotes(): Note[] {
  return [note("a", '---\ntitle: Alpha "A"\ntags: [x]\n---\nSee [[b]].'), note("b", "# B")];
}

function indexedIo(notes = fiveExampleNotes()): IoHarness {
  return memoryIo({
    initialFiles: new Map([[indexPath("notes"), encoder.encode(formatIndex(notes))]]),
  });
}

function expectCliError(harness: IoHarness, args: readonly string[], message: string): void {
  expect(run([...args], harness.io)).toBe(2);
  expect(harness.stdout).toBe("");
  expect(harness.stderr).toBe(`notesift: ${message}\n`);
}

function runInNotes(args: readonly string[], harness: IoHarness): number {
  const [command, ...rest] = args;
  if (command === undefined) throw new Error("a command is required");
  return run([command, "--dir=notes", ...rest], harness.io);
}

function expectIndexedCliError(harness: IoHarness, args: readonly string[], message: string): void {
  expect(runInNotes(args, harness)).toBe(2);
  expect(harness.stdout).toBe("");
  expect(harness.stderr).toBe(`notesift: ${message}\n`);
}

function expectIndexOnly(harness: IoHarness): void {
  expect(harness.fileCalls).toEqual([]);
  expect(harness.readCalls).toEqual([indexPath("notes")]);
  expect(harness.writes).toEqual([]);
  expect(harness.stdinCalls).toBe(0);
}

describe("CLI help and read-only command dispatch", () => {
  test("prints exactly the supplied usage on sole --help without touching Io", () => {
    const harness = memoryIo({ filesError: new Error("must not list files") });

    expect(run(["--help"], harness.io)).toBe(0);
    expect(harness.stdout).toBe(HELP);
    expect(harness.stderr).toBe("");
    expect(harness.fileCalls).toEqual([]);
    expect(harness.readCalls).toEqual([]);
    expect(harness.writes).toEqual([]);
    expect(harness.stdinCalls).toBe(0);
  });

  test.each([
    {
      args: ["search", "launch", "plan"],
      text:
        "5.519  projects/alpha  Alpha project\n" +
        "4.467  daily/todo  todo\n" +
        "3.740  ideas  Ideas\n" +
        "3 results\n",
      code: 0,
    },
    {
      args: ["search", "--limit=1", "plan"],
      text: "2.967  projects/alpha  Alpha project\nshowing 1 of 3 results\n",
      code: 0,
    },
    {
      args: ["search", "tag:work", "not:waiting"],
      text: "0.000  projects/alpha  Alpha project\n1 result\n",
      code: 0,
    },
    {
      args: ["search", "title:project", "launch"],
      text: "2.552  projects/alpha  Alpha project\n1 result\n",
      code: 0,
    },
    {
      args: ["links", "ideas"],
      text: "projects/alpha  Alpha project\n1 outgoing link\n",
      code: 0,
    },
    {
      args: ["backlinks", "alpha"],
      text: "ideas  Ideas\nprojects/beta  Beta project\n2 backlinks\n",
      code: 0,
    },
    {
      args: ["path", "ideas", "beta"],
      text: "ideas -> projects/alpha -> projects/beta\n2 hops\n",
      code: 0,
    },
    {
      args: ["path", "beta", "ideas"],
      text: "no path from projects/beta to ideas\n",
      code: 1,
    },
    {
      args: ["related", "projects/alpha"],
      text:
        "0.455  projects/beta  Beta project\n" +
        "0.093  daily/todo  todo\n" +
        "0.078  ideas  Ideas\n" +
        "3 related notes\n",
      code: 0,
    },
    {
      args: ["check"],
      text:
        'daily/todo: NS003 alias "brainstorm" is also used by ideas\n' +
        "daily/todo: NS004 note has no links in or out\n" +
        'ideas: NS003 alias "brainstorm" is also used by daily/todo\n' +
        'ideas:7: NS001 broken link "missing-note"\n' +
        'ideas:7: NS002 ambiguous link "todo" (daily/todo or work/todo)\n' +
        "work/todo: NS004 note has no links in or out\n" +
        "6 problems in 3 notes\n",
      code: 1,
    },
    {
      args: ["tags"],
      text: "work/active  2\ngarden  1\ninbox  1\nplan  1\n4 tags\n",
      code: 0,
    },
    {
      args: ["tags", "work"],
      text: "projects/alpha  Alpha project\nprojects/beta  Beta project\n2 notes\n",
      code: 0,
    },
    {
      args: ["stats"],
      text:
        "notes: 5\nwords: 47\ntags: 4\nlinks: 3\nbroken links: 1\n" +
        "ambiguous links: 1\norphans: 2\ncomponents: 3\n",
      code: 0,
    },
    {
      args: ["export", "--format", "csv"],
      text:
        "id,title,words,tags,inbound,outbound\n" +
        "daily/todo,todo,7,,0,0\n" +
        "ideas,Ideas,11,garden;inbox,0,1\n" +
        "projects/alpha,Alpha project,12,plan;work/active,2,1\n" +
        "projects/beta,Beta project,11,work/active,1,1\n" +
        "work/todo,Todo,6,,0,0\n",
      code: 0,
    },
    {
      args: ["export", "--format=dot"],
      text:
        "digraph notes {\n" +
        '  "daily/todo" [label="todo"];\n' +
        '  "ideas" [label="Ideas"];\n' +
        '  "projects/alpha" [label="Alpha project"];\n' +
        '  "projects/beta" [label="Beta project"];\n' +
        '  "work/todo" [label="Todo"];\n' +
        '  "ideas" -> "projects/alpha";\n' +
        '  "projects/alpha" -> "projects/beta";\n' +
        '  "projects/beta" -> "projects/alpha";\n' +
        "}\n",
      code: 0,
    },
    {
      args: ["export", "--format=md"],
      text:
        "# Notes\n\n" +
        "- [[daily/todo]] todo\n" +
        "- [[ideas]] Ideas (tags: garden, inbox)\n" +
        "- [[projects/alpha]] Alpha project (tags: plan, work/active)\n" +
        "- [[projects/beta]] Beta project (tags: work/active)\n" +
        "- [[work/todo]] Todo\n",
      code: 0,
    },
  ])("dispatches $args through the index and preserves exact output", ({ args, text, code }) => {
    const harness = indexedIo();

    expect(runInNotes(args, harness)).toBe(code);
    expect(harness.stdout).toBe(text);
    expect(harness.stderr).toBe("");
    expectIndexOnly(harness);
    expect(harness.stdout.includes("\r")).toBe(false);
  });

  test.each([
    { args: ["search", "no-match"], text: "0 results\n", stderr: "", code: 0 },
    { args: ["check"], text: "ok, 0 notes\n", stderr: "", code: 0 },
    { args: ["tags"], text: "0 tags\n", stderr: "", code: 0 },
    {
      args: ["stats"],
      text:
        "notes: 0\nwords: 0\ntags: 0\nlinks: 0\nbroken links: 0\n" +
        "ambiguous links: 0\norphans: 0\ncomponents: 0\n",
      stderr: "",
      code: 0,
    },
    { args: ["export", "--format=json"], text: "[]\n", stderr: "", code: 0 },
    { args: ["export", "--format=dot"], text: "digraph notes {\n}\n", stderr: "", code: 0 },
    {
      args: ["export", "--format=csv"],
      text: "id,title,words,tags,inbound,outbound\n",
      stderr: "",
      code: 0,
    },
    { args: ["export", "--format=md"], text: "# Notes\n\n", stderr: "", code: 0 },
    {
      args: ["links", "absent"],
      text: "",
      stderr: 'notesift: unknown note "absent"\n',
      code: 2,
    },
    {
      args: ["backlinks", "absent"],
      text: "",
      stderr: 'notesift: unknown note "absent"\n',
      code: 2,
    },
    {
      args: ["related", "absent"],
      text: "",
      stderr: 'notesift: unknown note "absent"\n',
      code: 2,
    },
    {
      args: ["path", "absent", "other"],
      text: "",
      stderr: 'notesift: unknown note "absent"\n',
      code: 2,
    },
  ])(
    "handles $args against an empty index with index-only access",
    ({ args, text, stderr, code }) => {
      const harness = indexedIo([]);

      expect(runInNotes(args, harness)).toBe(code);
      expect(harness.stdout).toBe(text);
      expect(harness.stderr).toBe(stderr);
      expectIndexOnly(harness);
    },
  );

  test("returns the exact successful check result for a clean linked index", () => {
    const notes = [note("a", "# Alpha\nSee [[b]]."), note("b", "# Beta\nSee [[a]].")];
    const harness = indexedIo(notes);

    expect(runInNotes(["check"], harness)).toBe(0);
    expect(harness.stdout).toBe("ok, 2 notes\n");
    expect(harness.stderr).toBe("");
    expectIndexOnly(harness);
  });

  test("exports the supplied two-note JSON example exactly", () => {
    const harness = indexedIo(twoExampleNotes());
    const expected =
      "[\n" +
      "  {\n" +
      '    "id": "a",\n' +
      '    "title": "Alpha \\"A\\"",\n' +
      '    "tags": [\n' +
      '      "x"\n' +
      "    ],\n" +
      '    "aliases": [],\n' +
      '    "words": 3,\n' +
      '    "links": [\n' +
      '      "b"\n' +
      "    ],\n" +
      '    "backlinks": []\n' +
      "  },\n" +
      "  {\n" +
      '    "id": "b",\n' +
      '    "title": "B",\n' +
      '    "tags": [],\n' +
      '    "aliases": [],\n' +
      '    "words": 2,\n' +
      '    "links": [],\n' +
      '    "backlinks": [\n' +
      '      "a"\n' +
      "    ]\n" +
      "  }\n" +
      "]\n";

    expect(runInNotes(["export", "--format=json"], harness)).toBe(0);
    expect(harness.stdout).toBe(expected);
    expect(harness.stderr).toBe("");
    expectIndexOnly(harness);
  });

  test("resolves FROM before TO and loads only the index for note lookups", () => {
    const fromFailure = indexedIo();
    expectIndexedCliError(
      fromFailure,
      ["path", "missing-from", "missing-to"],
      'unknown note "missing-from"',
    );
    expectIndexOnly(fromFailure);

    const toFailure = indexedIo();
    expectIndexedCliError(toFailure, ["path", "ideas", "missing-to"], 'unknown note "missing-to"');
    expectIndexOnly(toFailure);
  });

  test("uses the final directory option and passes its normalized path to index loading", () => {
    const harness = memoryIo({
      initialFiles: new Map([
        ["vault/.notesift/index.txt", encoder.encode(formatIndex(fiveExampleNotes()))],
      ]),
    });

    expect(run(["stats", "--dir=old", "--dir", "vault\\\\"], harness.io)).toBe(0);
    expect(harness.stdout).toContain("notes: 5\n");
    expect(harness.readCalls).toEqual(["vault/.notesift/index.txt"]);
    expect(harness.fileCalls).toEqual([]);
    expect(harness.writes).toEqual([]);
    expect(harness.stdinCalls).toBe(0);
  });

  test("translates only CliError and propagates unexpected Io failures", () => {
    const harness = memoryIo({
      initialFiles: new Map([
        [indexPath("notes"), encoder.encode(formatIndex(fiveExampleNotes()))],
      ]),
      outError: new TypeError("unexpected output failure"),
    });

    expect(() => runInNotes(["stats"], harness)).toThrow("unexpected output failure");
    expect(harness.stdout).toBe("");
    expect(harness.stderr).toBe("");
    expect(harness.fileCalls).toEqual([]);
    expect(harness.writes).toEqual([]);
  });
});

describe("CLI errors and validation precedence", () => {
  test.each([
    {
      args: [],
      message:
        "missing command (index, search, links, backlinks, check, path, related, tags, stats, export or capture)",
      reads: false,
    },
    { args: ["bogus"], message: 'unknown command "bogus"', reads: false },
    { args: ["index", "--unknown"], message: 'unknown option "--unknown"', reads: false },
    {
      args: ["search", "--limit=0", "--unknown"],
      message: 'unknown option "--unknown"',
      reads: false,
    },
    { args: ["search", "--limit=0"], message: 'invalid --limit "0"', reads: false },
    { args: ["search"], message: "missing QUERY", reads: false },
    { args: ["search", "the"], message: "empty query", reads: true },
    { args: ["search", "tag:"], message: 'invalid query item "tag:"', reads: true },
    {
      args: ["links", "todo"],
      message: 'ambiguous note "todo" (daily/todo or work/todo)',
      reads: true,
    },
    { args: ["links", "nope"], message: 'unknown note "nope"', reads: true },
    { args: ["tags", "1"], message: 'invalid tag "1"', reads: true },
    { args: ["path", "ideas"], message: "missing TO", reads: false },
    { args: ["export"], message: "missing --format", reads: false },
    {
      args: ["export", "--format=html"],
      message: 'invalid --format "html"',
      reads: false,
    },
    { args: ["index", "extra"], message: "too many arguments", reads: false },
    { args: ["capture", "Bad_Name"], message: 'invalid NAME "Bad_Name"', reads: false },
  ])("returns code 2 and exact stderr for $args", ({ args, message, reads }) => {
    const harness = indexedIo();

    if (reads) expectIndexedCliError(harness, args, message);
    else expectCliError(harness, args, message);
    expect(harness.fileCalls).toEqual([]);
    expect(harness.writes).toEqual([]);
    expect(harness.stdinCalls).toBe(0);
    expect(harness.readCalls).toEqual(reads ? [indexPath("notes")] : []);
  });

  test("reports missing and damaged indexes without listing source files", () => {
    const missing = memoryIo({ filesError: new Error("source files must not be listed") });
    expectCliError(
      missing,
      ["stats", "--dir=other"],
      'other/.notesift/index.txt: no index (run "notesift index" first)',
    );
    expect(missing.fileCalls).toEqual([]);
    expect(missing.readCalls).toEqual(["other/.notesift/index.txt"]);

    const damaged = memoryIo({
      initialFiles: new Map([["notes/.notesift/index.txt", encoder.encode("junk\n")]]),
      filesError: new Error("source files must not be listed"),
    });
    expectCliError(
      damaged,
      ["stats", "--dir=notes"],
      'notes/.notesift/index.txt: damaged index (run "notesift index" again)',
    );
    expect(damaged.fileCalls).toEqual([]);
    expect(damaged.readCalls).toEqual([indexPath("notes")]);
  });
});

describe("index command orchestration", () => {
  const exampleSourceFiles = [
    "ideas.md",
    "projects/alpha.md",
    "projects/beta.md",
    "daily/todo.md",
    "work/todo.md",
  ];
  const exampleSourceBytes = new Map([
    [
      "notes/ideas.md",
      encoder.encode(
        "---\ntitle: Ideas\ntags: [inbox]\naliases: [brainstorm]\n---\n" +
          "Rough ideas for the [[projects/alpha|alpha launch]] and a #garden plan.\n" +
          "See [[todo]] and [[missing-note]].",
      ),
    ],
    [
      "notes/projects/alpha.md",
      encoder.encode(
        "---\ntitle: Alpha project\ntags: [work/active, Plan]\n---\n# Alpha\n" +
          "Plan the launch with [[projects/beta]]. The launch needs a plan and a plan review.\n" +
          "\u0060\u0060\u0060text\n[[not-a-link]] #nottag\n\u0060\u0060\u0060",
      ),
    ],
    [
      "notes/projects/beta.md",
      encoder.encode("# Beta project\nWaiting for the [[alpha]] review. Tags: #work/active #2024"),
    ],
    [
      "notes/daily/todo.md",
      encoder.encode(
        "---\naliases: [brainstorm]\n---\nWater the plants. Read about the launch plan.",
      ),
    ],
    ["notes/work/todo.md", encoder.encode("# Todo\nCall the vendor about the garden.")],
  ]);

  test("builds and writes the canonical index on the first run", () => {
    const notes = fiveExampleNotes();
    const harness = memoryIo({
      files: exampleSourceFiles,
      initialFiles: exampleSourceBytes,
    });

    expect(run(["index", "--dir=notes"], harness.io)).toBe(0);
    expect(harness.stdout).toBe("indexed 5 notes (5 new, 0 changed, 0 removed, 0 unchanged)\n");
    expect(harness.stderr).toBe("");
    expect(harness.fileCalls).toEqual(["notes"]);
    expect(harness.readCalls).toEqual([
      indexPath("notes"),
      "notes/daily/todo.md",
      "notes/ideas.md",
      "notes/projects/alpha.md",
      "notes/projects/beta.md",
      "notes/work/todo.md",
    ]);
    expect(harness.writes).toEqual([
      { path: indexPath("notes"), data: encoder.encode(formatIndex(notes)) },
    ]);
    expect(harness.contents.get(indexPath("notes"))).toEqual(encoder.encode(formatIndex(notes)));
  });

  test("does not rewrite a canonical unchanged index", () => {
    const notes = fiveExampleNotes();
    const initialFiles = new Map(exampleSourceBytes);
    initialFiles.set(indexPath("notes"), encoder.encode(formatIndex(notes)));
    const harness = memoryIo({ files: exampleSourceFiles, initialFiles });

    expect(run(["index", "--dir=notes"], harness.io)).toBe(0);
    expect(harness.stdout).toBe("indexed 5 notes (0 new, 0 changed, 0 removed, 5 unchanged)\n");
    expect(harness.stderr).toBe("");
    expect(harness.writes).toEqual([]);
    expect(harness.fileCalls).toEqual(["notes"]);
    expect(harness.readCalls).toHaveLength(6);
  });

  test("writes one canonical index for add, change, remove, and unchanged counts", () => {
    const previous = [
      note("stable", "# Stable\n"),
      note("changed", "# Old title\n"),
      note("removed", "# Removed\n"),
    ];
    const current = [
      note("stable", "# Stable\n"),
      note("changed", "# New title\n"),
      note("added", "# Added\n"),
    ];
    const sourceFiles = ["added.md", "changed.md", "stable.md"];
    const sources = new Map([
      ["notes/added.md", encoder.encode("# Added\n")],
      ["notes/changed.md", encoder.encode("# New title\n")],
      ["notes/stable.md", encoder.encode("# Stable\n")],
    ]);
    sources.set(indexPath("notes"), encoder.encode(formatIndex(previous)));
    const harness = memoryIo({ files: sourceFiles, initialFiles: sources });

    expect(run(["index", "--dir=notes"], harness.io)).toBe(0);
    expect(harness.stdout).toBe("indexed 3 notes (1 new, 1 changed, 1 removed, 1 unchanged)\n");
    expect(harness.stderr).toBe("");
    expect(harness.writes).toEqual([
      { path: indexPath("notes"), data: encoder.encode(formatIndex(current)) },
    ]);
  });

  test("writes an empty canonical index when no notes exist", () => {
    const harness = memoryIo({ files: [] });

    expect(run(["index", "--dir=notes"], harness.io)).toBe(0);
    expect(harness.stdout).toBe("indexed 0 notes (0 new, 0 changed, 0 removed, 0 unchanged)\n");
    expect(harness.writes).toEqual([
      { path: indexPath("notes"), data: encoder.encode(formatIndex([])) },
    ]);
  });

  test("rebuilds a damaged index from current sources", () => {
    const harness = memoryIo({
      files: ["a.md"],
      initialFiles: new Map([
        [indexPath("notes"), encoder.encode("damaged\n")],
        ["notes/a.md", encoder.encode("# Alpha\n")],
      ]),
    });

    expect(run(["index", "--dir=notes"], harness.io)).toBe(0);
    expect(harness.stdout).toBe("indexed 1 note (1 new, 0 changed, 0 removed, 0 unchanged)\n");
    expect(harness.writes).toEqual([
      { path: indexPath("notes"), data: encoder.encode(formatIndex([note("a", "# Alpha\n")])) },
    ]);
  });

  test("reports unreadable directories and does not print success", () => {
    const harness = memoryIo({ filesError: new Error("directory unavailable") });

    expectCliError(harness, ["index", "--dir=notes"], "notes: cannot read the directory");
    expect(harness.fileCalls).toEqual(["notes"]);
    expect(harness.writes).toEqual([]);
  });

  test("does not emit success if writing the rebuilt index fails", () => {
    const harness = memoryIo({
      files: [],
      writeError: new Error("write failed"),
    });

    expect(() => run(["index", "--dir=notes"], harness.io)).toThrow("write failed");
    expect(harness.stdout).toBe("");
    expect(harness.stderr).toBe("");
    expect(harness.writes).toHaveLength(1);
  });
});

describe("capture command orchestration", () => {
  test("writes nested Markdown with normalized body, lowercase unique tags, and exact output", () => {
    const harness = memoryIo({
      files: [],
      stdin: encoder.encode("Good week.\r\nNext: [[ideas]]\r\n\r\n"),
    });

    expect(
      run(
        [
          "capture",
          "--dir=notes",
          "--tag",
          "Idea",
          "--tag=#plan",
          "--tag=IDEA",
          "--title=Weekly review",
          "reviews/week-1",
        ],
        harness.io,
      ),
    ).toBe(0);
    expect(harness.stdout).toBe("wrote reviews/week-1.md\n");
    expect(harness.stderr).toBe("");
    expect(harness.stdinCalls).toBe(1);
    expect(harness.fileCalls).toEqual(["notes"]);
    expect(harness.writes).toEqual([
      {
        path: "notes/reviews/week-1.md",
        data: encoder.encode(
          "---\ntitle: Weekly review\ntags: [idea, plan]\n---\n\n" +
            "Good week.\nNext: [[ideas]]\n",
        ),
      },
    ]);
  });

  test("uses the default title and emits only front matter for empty input", () => {
    const harness = memoryIo({ files: [], stdin: new Uint8Array() });

    expect(run(["capture", "--dir=notes", "reviews/week-2"], harness.io)).toBe(0);
    expect(harness.stdout).toBe("wrote reviews/week-2.md\n");
    expect(harness.writes[0]).toEqual({
      path: "notes/reviews/week-2.md",
      data: encoder.encode("---\ntitle: Week 2\n---\n"),
    });
  });

  test.each([
    {
      args: ["capture", "--title=", "--tag=1", "Bad_Name"],
      input: new Uint8Array([0xff, 0xfe]),
      files: [],
      message: 'invalid NAME "Bad_Name"',
      stdinCalls: 0,
      fileCalls: [],
    },
    {
      args: ["capture", "--title=", "--tag=1", "valid-name"],
      input: new Uint8Array([0xff, 0xfe]),
      files: [],
      message: 'invalid --title ""',
      stdinCalls: 0,
      fileCalls: [],
    },
    {
      args: ["capture", "--tag=1", "valid-name"],
      input: new Uint8Array([0xff, 0xfe]),
      files: [],
      message: 'invalid --tag "1"',
      stdinCalls: 0,
      fileCalls: [],
    },
    {
      args: ["capture", "valid-name"],
      input: new Uint8Array([0xff, 0xfe]),
      files: [],
      message: "stdin: input is not valid UTF-8",
      stdinCalls: 1,
      fileCalls: [],
    },
    {
      args: ["capture", "valid-name"],
      input: encoder.encode("body"),
      files: ["valid-name.md"],
      message: "valid-name.md: already exists",
      stdinCalls: 1,
      fileCalls: ["."],
    },
  ])(
    "reports capture failure in validation order: $message",
    ({ args, input, files, message, stdinCalls, fileCalls }) => {
      const harness = memoryIo({ files, stdin: input });

      expectCliError(harness, args, message);
      expect(harness.stdinCalls).toBe(stdinCalls);
      expect(harness.fileCalls).toEqual([...fileCalls]);
      expect(harness.writes).toEqual([]);
    },
  );

  test("reports a capture directory error after reading valid stdin", () => {
    const harness = memoryIo({
      filesError: new Error("cannot list"),
      stdin: encoder.encode("body"),
    });

    expectCliError(
      harness,
      ["capture", "--dir=notes", "valid-name"],
      "notes: cannot read the directory",
    );
    expect(harness.stdinCalls).toBe(1);
    expect(harness.fileCalls).toEqual(["notes"]);
    expect(harness.writes).toEqual([]);
  });

  test("does not emit a success message when the note write fails", () => {
    const harness = memoryIo({
      files: [],
      writeError: new Error("write failed"),
      stdin: encoder.encode("body"),
    });

    expect(() => run(["capture", "valid-name"], harness.io)).toThrow("write failed");
    expect(harness.stdout).toBe("");
    expect(harness.stderr).toBe("");
    expect(harness.writes).toHaveLength(1);
  });
});

describe("real stdin entry point", () => {
  test("reads malformed UTF-8 bytes from descriptor zero and exits with the exact diagnostic", async () => {
    const script = resolve(import.meta.dir, "../src/main.ts");
    const proc = Bun.spawn(
      [process.execPath, script, "capture", "--dir", "unused-malformed-stdin-dir", "valid-name"],
      {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        timeout: 30_000,
      },
    );

    if (proc.stdin === null || proc.stdout === null || proc.stderr === null) {
      proc.kill();
      throw new Error("spawned process pipes were unavailable");
    }

    proc.stdin.write(new Uint8Array([0xff, 0xfe]));
    proc.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stdout).toBe("");
    expect(stderr).toBe("notesift: stdin: input is not valid UTF-8\n");
    expect(exitCode).toBe(2);
  }, 60_000);
});
