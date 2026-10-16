import { describe, expect, test } from "bun:test";
import { renderTags } from "../src/tags";
import { CliError, type Note } from "../src/types";

function note(id: string, title: string, tags: string[]): Note {
  return {
    id,
    hash: `hash:${id}`,
    words: id.length,
    title,
    tags: [...tags],
    aliases: [`alias:${id}`],
    links: [{ line: 1, target: `target:${id}` }],
    terms: [[id, id.length]],
  };
}

function fiveNoteExample(): Note[] {
  return [
    note("ideas", "Ideas", ["garden", "inbox"]),
    note("projects/alpha", "Alpha project", ["plan", "work/active"]),
    note("projects/beta", "Beta project", ["work/active"]),
    note("daily/todo", "todo", []),
    note("work/todo", "Todo", []),
  ];
}

function expectInvalidTag(tag: string, expectedMessage: string): void {
  let thrown: unknown;
  try {
    renderTags([], tag);
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(CliError);
  expect(thrown).toHaveProperty("message", expectedMessage);
}

describe("tag inventory", () => {
  test("counts exact tags, sorts by count then code point, and matches the supplied example", () => {
    expect(renderTags(fiveNoteExample(), null)).toBe(
      "work/active  2\ngarden  1\ninbox  1\nplan  1\n4 tags\n",
    );
  });

  test("prints zero, singular, and plural inventory summaries", () => {
    expect(renderTags([], null)).toBe("0 tags\n");
    expect(renderTags([note("one", "One", [])], null)).toBe("0 tags\n");
    expect(renderTags([note("one", "One", ["work/active"])], null)).toBe("work/active  1\n1 tag\n");
    expect(renderTags(fiveNoteExample(), null)).toEndWith("4 tags\n");
  });

  test("does not roll child counts into an exact parent tag", () => {
    expect(
      renderTags(
        [note("parent", "Parent", ["work"]), note("child", "Child", ["work/active"])],
        null,
      ),
    ).toBe("work  1\nwork/active  1\n2 tags\n");
  });
});

describe("hierarchical tag filtering", () => {
  test("normalizes the supplied example filter and includes only exact tags or descendants", () => {
    const expected = "projects/alpha  Alpha project\nprojects/beta  Beta project\n2 notes\n";
    const notes = fiveNoteExample();

    expect(renderTags(notes, "work")).toBe(expected);
    expect(renderTags(notes, " #WORK/// ")).toBe(expected);
    expect(renderTags(notes, "#Work")).toBe(expected);
    expect(renderTags(notes, "plan")).toBe("projects/alpha  Alpha project\n1 note\n");
    expect(renderTags(notes, "absent")).toBe("0 notes\n");
    expect(renderTags([], "work")).toBe("0 notes\n");
  });

  test("matches exact, child, and deep tags once while rejecting bare prefixes", () => {
    const notes = [
      note("z-deep", "Deep", ["work/active/deep"]),
      note("b-exact", "Exact", ["work"]),
      note("a-child", "Child", ["work/active"]),
      note("c-multiple", "Multiple", ["work/active", "work/active/deep"]),
      note("d-prefix", "Prefix", ["worker", "work-active"]),
    ];

    expect(renderTags(notes, "work")).toBe(
      "a-child  Child\nb-exact  Exact\nc-multiple  Multiple\nz-deep  Deep\n4 notes\n",
    );
  });

  test("supports underscore and hyphen segments without accepting a longer prefix", () => {
    const notes = [
      note("b-exact", "Exact", ["a_1-b"]),
      note("a-child", "Child", ["a_1-b/child"]),
      note("c-prefix", "Prefix", ["a_1-bc"]),
    ];

    expect(renderTags(notes, "a_1-b")).toBe("a-child  Child\nb-exact  Exact\n2 notes\n");
  });

  test("preserves ORIGINAL_ARGUMENT exactly in each invalid-tag error", () => {
    expectInvalidTag("", 'invalid tag ""');
    expectInvalidTag("1", 'invalid tag "1"');
    expectInvalidTag("##work", 'invalid tag "##work"');
    expectInvalidTag("work//active", 'invalid tag "work//active"');
    expectInvalidTag("café", 'invalid tag "café"');
    expectInvalidTag(" 1 ", 'invalid tag " 1 "');
  });

  test("preserves ids and titles and sorts supplementary ids by Unicode code point", () => {
    const notes = [
      note("😀", "Astral", ["tag"]),
      note("\uE000", "BMP", ["tag"]),
      note("a", "ASCII", ["tag"]),
    ];

    expect(renderTags(notes, "tag")).toBe("a  ASCII\n\uE000  BMP\n😀  Astral\n3 notes\n");
  });

  test("uses literal LF and preserves all input metadata across repeated calls", () => {
    const notes = fiveNoteExample();
    const snapshot = JSON.stringify(notes);
    const inventory = renderTags(notes, null);
    const filtered = renderTags(notes, "work");

    expect(renderTags(notes, null)).toBe(inventory);
    expect(renderTags(notes, "work")).toBe(filtered);
    expect(inventory).not.toContain("\r");
    expect(filtered).not.toContain("\r");
    expect(JSON.stringify(notes)).toBe(snapshot);
  });
});
