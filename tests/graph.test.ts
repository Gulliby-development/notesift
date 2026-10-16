import { describe, expect, test } from "bun:test";
import { buildGraph, countComponents, resolve, resolveNote, shortestPath } from "../src/graph";
import { parseNote } from "../src/note";
import { CliError, type Note } from "../src/types";

const encoder = new TextEncoder();

function note(id: string, text: string): Note {
  return parseNote(id, encoder.encode(text));
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
        "~~~text\n[[not-a-link]] #nottag\n~~~",
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

describe("note resolution", () => {
  test("uses the first matching tier: exact id, alias, title, then basename", () => {
    const notes = [
      note("alpha", "---\ntitle: Shared\n---\n"),
      note("alias-owner", "---\naliases: [alpha, Shared]\n---\n"),
      note("title-owner", "---\ntitle: Topic\n---\n"),
      note("folder/topic", "# Other title\n"),
      note("basename-owner/target", "# Elsewhere\n"),
    ];

    expect(resolve(notes, "alpha")).toEqual({ kind: "ok", id: "alpha" });
    expect(resolve(notes, "shared")).toEqual({ kind: "ok", id: "alias-owner" });
    expect(resolve(notes, "TOPIC")).toEqual({ kind: "ok", id: "title-owner" });
    expect(resolve(notes, "TaRgEt")).toEqual({ kind: "ok", id: "basename-owner/target" });
  });

  test("keeps exact ids case-sensitive and folds only ASCII letters in other tiers", () => {
    const upperPath = note("Folder/Note", "---\naliases: [ALPHA, Älias]\n---\n");

    expect(resolve([upperPath], "Folder/Note")).toEqual({ kind: "ok", id: "Folder/Note" });
    expect(resolve([upperPath], "folder/note")).toEqual({ kind: "broken" });
    expect(resolve([upperPath], "note")).toEqual({ kind: "ok", id: "Folder/Note" });
    expect(resolve([upperPath], "alpha")).toEqual({ kind: "ok", id: "Folder/Note" });
    expect(resolve([upperPath], "älias")).toEqual({ kind: "broken" });
    expect(resolve([upperPath], "not-present")).toEqual({ kind: "broken" });
  });

  test("deduplicates matches within one note and sorts ambiguous ids by code point", () => {
    const notes = [
      note("😀", "---\naliases: [Needle, needle]\n---\n"),
      note("é", "---\naliases: [needle]\n---\n"),
      note("z", "---\naliases: [NEEDLE]\n---\n"),
    ];

    expect(resolve(notes, "needle")).toEqual({
      kind: "ambiguous",
      ids: ["z", "é", "😀"],
    });
    expectCliError(() => resolveNote(notes, "needle"), 'ambiguous note "needle" (z or é or 😀)');
  });

  test("resolveNote returns the resolved id and reports an unknown original argument", () => {
    const notes = [note("folder/alpha", "# Alpha\n")];

    expect(resolveNote(notes, "ALPHA")).toBe("folder/alpha");
    expectCliError(() => resolveNote(notes, "nope"), 'unknown note "nope"');
  });

  test("reports the supplied todo ambiguity with sorted ids", () => {
    const notes = fiveExampleNotes();

    expect(resolve(notes, "todo")).toEqual({
      kind: "ambiguous",
      ids: ["daily/todo", "work/todo"],
    });
    expectCliError(
      () => resolveNote(notes, "todo"),
      'ambiguous note "todo" (daily/todo or work/todo)',
    );
  });
});

describe("graph construction", () => {
  test("deduplicates resolved edges, ignores self-links, and retains every issue occurrence", () => {
    const notes = [
      note("z", "[[missing]]"),
      note("peer", "[[a]]"),
      note("c-clash", "---\naliases: [Clash, echo]\n---\n"),
      note(
        "a",
        "---\ntitle: Alpha\n---\n" +
          "[[missing]] [[also-missing]]\n" +
          "[[Clash]] [[echo]] [[Clash]] [[missing]]\n" +
          "[[a]] [[Alpha]] [[peer]] [[peer]]",
      ),
      note("b-clash", "---\naliases: [Clash, echo]\n---\n"),
    ];

    const graph = buildGraph(notes);

    expect([...graph.out]).toEqual([
      ["a", ["peer"]],
      ["b-clash", []],
      ["c-clash", []],
      ["peer", ["a"]],
      ["z", []],
    ]);
    expect([...graph.inn]).toEqual([
      ["a", ["peer"]],
      ["b-clash", []],
      ["c-clash", []],
      ["peer", ["a"]],
      ["z", []],
    ]);
    expect(graph.broken).toEqual([
      { id: "a", line: 4, target: "missing" },
      { id: "a", line: 4, target: "also-missing" },
      { id: "a", line: 5, target: "missing" },
      { id: "z", line: 1, target: "missing" },
    ]);
    expect(graph.ambiguous).toEqual([
      { id: "a", line: 5, target: "Clash", ids: ["b-clash", "c-clash"] },
      { id: "a", line: 5, target: "echo", ids: ["b-clash", "c-clash"] },
      { id: "a", line: 5, target: "Clash", ids: ["b-clash", "c-clash"] },
    ]);
  });

  test("reproduces the supplied five-note graph and occurrence records", () => {
    const graph = buildGraph(fiveExampleNotes());

    expect([...graph.out]).toEqual([
      ["daily/todo", []],
      ["ideas", ["projects/alpha"]],
      ["projects/alpha", ["projects/beta"]],
      ["projects/beta", ["projects/alpha"]],
      ["work/todo", []],
    ]);
    expect([...graph.inn]).toEqual([
      ["daily/todo", []],
      ["ideas", []],
      ["projects/alpha", ["ideas", "projects/beta"]],
      ["projects/beta", ["projects/alpha"]],
      ["work/todo", []],
    ]);
    expect(graph.broken).toEqual([{ id: "ideas", line: 7, target: "missing-note" }]);
    expect(graph.ambiguous).toEqual([
      {
        id: "ideas",
        line: 7,
        target: "todo",
        ids: ["daily/todo", "work/todo"],
      },
    ]);
  });
});

describe("graph traversal", () => {
  test("returns same-node paths, shortest paths, and the id-ordered route for tied paths", () => {
    const graph = buildGraph([
      note("a", "[[c]] [[b]]"),
      note("b", "[[d]]"),
      note("c", "[[d]]"),
      note("d", "[[e]]"),
      note("e", "[[b]]"),
      note("f", ""),
    ]);

    expect(shortestPath(graph, "a", "a")).toEqual(["a"]);
    expect(shortestPath(graph, "a", "d")).toEqual(["a", "b", "d"]);
    expect(shortestPath(graph, "a", "e")).toEqual(["a", "b", "d", "e"]);
    expect(shortestPath(graph, "f", "a")).toBeNull();
    expect(shortestPath(graph, "unknown", "a")).toBeNull();
  });

  test("counts directed edges as weak connections and includes isolated notes", () => {
    const graph = buildGraph([
      note("a", "[[b]]"),
      note("b", ""),
      note("c", ""),
      note("d", "[[e]]"),
      note("e", ""),
      note("f", ""),
    ]);

    expect(countComponents(graph)).toBe(4);
    expect(countComponents(buildGraph([]))).toBe(0);
  });

  test("finds the supplied forward route and leaves the reverse route unreachable", () => {
    const graph = buildGraph(fiveExampleNotes());

    expect(shortestPath(graph, "ideas", "projects/beta")).toEqual([
      "ideas",
      "projects/alpha",
      "projects/beta",
    ]);
    expect(shortestPath(graph, "projects/beta", "ideas")).toBeNull();
    expect(countComponents(graph)).toBe(3);
  });
});
