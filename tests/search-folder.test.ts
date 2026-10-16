import { describe, expect, test } from "bun:test";
import { parseNote } from "../src/note";
import { renderSearch } from "../src/search";
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
        "```text\n[[not-a-link]] #nottag\n```",
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

describe("folder search filters", () => {
  test("combines a folder filter with query words and returns no matches for absent folders", () => {
    const notes = fiveExampleNotes();

    expect(renderSearch(notes, ["launch plan in:projects"], 10)).toBe(
      "5.519  projects/alpha  Alpha project\n1 result\n",
    );
    expect(renderSearch(notes, ["plan", "in:nothing"], 10)).toBe("0 results\n");
  });

  test("allows folder-only queries with zero scores and code-point ID ordering", () => {
    const notes = fiveExampleNotes();

    expect(renderSearch(notes, ["in:work"], 10)).toBe("0.000  work/todo  Todo\n1 result\n");
    expect(renderSearch(notes, ["in:projects", "in:daily"], 10)).toBe(
      "0.000  daily/todo  todo\n" +
        "0.000  projects/alpha  Alpha project\n" +
        "0.000  projects/beta  Beta project\n" +
        "3 results\n",
    );
  });

  test("removes one trailing slash and matches nested folder IDs only below the folder", () => {
    const notes = [
      note("projects/alpha", "# Alpha"),
      note("projects/alpha/child", "# Child"),
      note("projects/beta", "# Beta"),
      note("projects//double", "# Double"),
    ];

    expect(renderSearch(notes, ["in:projects/"], 10)).toBe(
      "0.000  projects//double  Double\n" +
        "0.000  projects/alpha  Alpha\n" +
        "0.000  projects/alpha/child  Child\n" +
        "0.000  projects/beta  Beta\n" +
        "4 results\n",
    );
    expect(renderSearch(notes, ["in:projects/alpha/"], 10)).toBe(
      "0.000  projects/alpha/child  Child\n1 result\n",
    );
    expect(renderSearch(notes, ["in:projects//"], 10)).toBe(
      "0.000  projects//double  Double\n1 result\n",
    );
  });

  test("uses whole, case-sensitive folder names and excludes an ID equal to the folder", () => {
    const notes = [
      note("work", "# Folder name"),
      note("work/todo", "# Todo"),
      note("work/a/b", "# Nested"),
      note("workshop/a", "# Workshop"),
      note("Work/a", "# Uppercase"),
      note("projects/alpha", "# Exact folder ID"),
      note("projects/alpha/child", "# Child"),
    ];

    expect(renderSearch(notes, ["in:work"], 10)).toBe(
      "0.000  work/a/b  Nested\n0.000  work/todo  Todo\n2 results\n",
    );
    expect(renderSearch(notes, ["in:projects/alpha"], 10)).toBe(
      "0.000  projects/alpha/child  Child\n1 result\n",
    );
  });

  test("ORs repeated folder filters and ANDs words, tag, title, and exclusion filters", () => {
    const notes = [
      note("projects/alpha", "---\ntitle: Project\ntags: [work/active]\n---\nneedle"),
      note("daily/todo", "---\ntitle: Todo\ntags: [work/active]\n---\nneedle"),
      note("archive/blocked", "---\ntitle: Project\ntags: [work/active]\n---\nneedle blocked"),
      note("other/project", "---\ntitle: Project\ntags: [work/active]\n---\nneedle"),
    ];

    expect(
      renderSearch(
        notes,
        ["needle", "in:projects", "in:daily", "tag:work", "title:project", "not:blocked"],
        10,
      ),
    ).toBe("1.310  projects/alpha  Project\n1 result\n");
    expect(
      renderSearch(
        notes,
        ["needle", "in:projects", "in:daily", "tag:work", "title:todo", "not:blocked"],
        10,
      ),
    ).toBe("1.310  daily/todo  Todo\n1 result\n");
  });

  test("preserves full-corpus scores, result summaries, and limit behavior", () => {
    const notes = fiveExampleNotes();

    expect(renderSearch(notes, ["launch plan"], 10)).toBe(
      "5.519  projects/alpha  Alpha project\n" +
        "4.467  daily/todo  todo\n" +
        "3.740  ideas  Ideas\n" +
        "3 results\n",
    );
    expect(renderSearch(notes, ["launch plan", "in:projects/", "in:daily"], 10)).toBe(
      "5.519  projects/alpha  Alpha project\n" + "4.467  daily/todo  todo\n2 results\n",
    );
    expect(renderSearch(notes, ["launch plan", "in:projects/", "in:daily"], 1)).toBe(
      "5.519  projects/alpha  Alpha project\nshowing 1 of 2 results\n",
    );
  });

  test("rejects empty folders in item order and retains empty-query errors", () => {
    expectCliError(() => renderSearch([], ["in:"], 10), 'invalid query item "in:"');
    expectCliError(() => renderSearch([], ["in:/"], 10), 'invalid query item "in:/"');
    expectCliError(() => renderSearch([], ["in:/", "tag:"], 10), 'invalid query item "in:/"');
    expectCliError(() => renderSearch([], ["tag:", "in:/"], 10), 'invalid query item "tag:"');
    expectCliError(() => renderSearch([], [], 10), "empty query");
  });

  test("treats an upper-case IN: prefix as an ordinary query item", () => {
    const notes = [note("unrelated", "---\ntitle: Work\n---\n")];

    expect(renderSearch(notes, ["IN:work"], 10)).toBe("3.143  unrelated  Work\n1 result\n");
  });
});
