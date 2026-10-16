import { describe, expect, test } from "bun:test";
import { type Parsed, parseArgs } from "../src/args";
import { CliError } from "../src/types";

function expectParseError(args: string[], message: string): void {
  let caught: unknown;
  try {
    parseArgs(args);
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(CliError);
  expect(caught instanceof Error ? caught.message : "").toBe(message);
}

const parsed = (
  command: Parsed["command"],
  operands: string[] = [],
  options: Partial<Parsed> = {},
): Parsed => ({
  command,
  dir: ".",
  operands,
  limit: null,
  format: null,
  title: null,
  tags: [],
  ...options,
});

describe("parseArgs command and help handling", () => {
  test("reports a missing command", () => {
    expectParseError(
      [],
      "missing command (index, search, links, backlinks, check, path, related, tags, stats, export or capture)",
    );
  });

  test("reports an unknown command with the original token", () => {
    expectParseError(["bogus"], 'unknown command "bogus"');
    expectParseError(["--help", "index"], 'unknown command "--help"');
  });

  test("recognizes --help only when it is the sole argument", () => {
    expect(parseArgs(["--help"])).toEqual(parsed("help"));
    expectParseError(["search", "--help", "topic"], 'unknown option "--help"');
  });

  test.each([
    { args: ["index"], expected: parsed("index") },
    { args: ["search", "topic"], expected: parsed("search", ["topic"], { limit: 10 }) },
    { args: ["links", "note"], expected: parsed("links", ["note"]) },
    { args: ["backlinks", "note"], expected: parsed("backlinks", ["note"]) },
    { args: ["check"], expected: parsed("check") },
    { args: ["path", "from", "to"], expected: parsed("path", ["from", "to"]) },
    { args: ["related", "note"], expected: parsed("related", ["note"], { limit: 5 }) },
    { args: ["tags"], expected: parsed("tags") },
    { args: ["tags", "garden"], expected: parsed("tags", ["garden"]) },
    { args: ["stats"], expected: parsed("stats") },
    { args: ["export", "--format", "md"], expected: parsed("export", [], { format: "md" }) },
    { args: ["capture", "new-note"], expected: parsed("capture", ["new-note"]) },
  ] as { args: string[]; expected: Parsed }[])(
    "applies command defaults and preserves operands: $args",
    ({ args, expected }) => {
      expect(parseArgs(args)).toEqual(expected);
    },
  );
});

describe("parseArgs options", () => {
  test("normalizes directory separators and removes trailing separators", () => {
    expect(parseArgs(["index", "--dir", "C:\\notes\\"]).dir).toBe("C:/notes");
    expect(parseArgs(["index", "--dir=folder///"]).dir).toBe("folder");
    expect(parseArgs(["index", "--dir="]).dir).toBe(".");
    expect(parseArgs(["index", "--dir", "\\\\"]).dir).toBe(".");
  });

  test("accepts separated and equals values, including dash-prefixed values", () => {
    expect(parseArgs(["search", "--dir", "-vault", "--limit", "999", "query"])).toEqual(
      parsed("search", ["query"], { dir: "-vault", limit: 999 }),
    );
    expect(parseArgs(["search", "--dir=", "--limit=005", "query"])).toEqual(
      parsed("search", ["query"], { limit: 5 }),
    );
    expect(parseArgs(["search", "--dir", "--help", "query"]).dir).toBe("--help");
    expect(parseArgs(["search", "-"]).operands).toEqual(["-"]);
  });

  test("uses the final value of repeated scalar options", () => {
    expect(
      parseArgs(["search", "--dir=old", "--dir", "new///", "--limit=0", "--limit", "005", "query"]),
    ).toEqual(parsed("search", ["query"], { dir: "new", limit: 5 }));
    expect(parseArgs(["export", "--format=invalid", "--format", "csv"])).toEqual(
      parsed("export", [], { format: "csv" }),
    );
    expect(parseArgs(["capture", "--title=old", "--title", "new", "name"]).title).toBe("new");
  });

  test("collects repeated tags in their original order", () => {
    expect(
      parseArgs(["capture", "--tag=Idea", "--tag", "#plan", "--tag=Idea", "new-note"]).tags,
    ).toEqual(["Idea", "#plan", "Idea"]);
  });

  test.each([
    { command: "index", option: "--limit=2" },
    { command: "search", option: "--format=md" },
    { command: "links", option: "--title=note" },
    { command: "backlinks", option: "--tag=x" },
    { command: "check", option: "--limit=2" },
    { command: "path", option: "--limit=2" },
    { command: "related", option: "--tag=x" },
    { command: "tags", option: "--format=csv" },
    { command: "stats", option: "--title=x" },
    { command: "export", option: "--limit=2" },
    { command: "capture", option: "--format=md" },
  ])("rejects option not offered by $command without rewriting $option", ({ command, option }) => {
    expectParseError([command, option], `unknown option "${option}"`);
  });

  test("preserves the complete original unknown option token, including equals content", () => {
    expectParseError(
      ["search", "--mystery=first=second"],
      'unknown option "--mystery=first=second"',
    );
    expectParseError(["search", "--"], 'unknown option "--"');
  });

  test.each([
    { args: ["index", "--dir"], message: "--dir needs a value" },
    { args: ["search", "--limit"], message: "--limit needs a value" },
    { args: ["related", "--limit"], message: "--limit needs a value" },
    { args: ["export", "--format"], message: "--format needs a value" },
    { args: ["capture", "--title"], message: "--title needs a value" },
    { args: ["capture", "--tag"], message: "--tag needs a value" },
  ] as { args: string[]; message: string }[])(
    "reports a missing value for $args",
    ({ args, message }) => {
      expectParseError(args, message);
    },
  );

  test("processes options from left to right before scalar validation", () => {
    expectParseError(["search", "--limit=0", "--unknown"], 'unknown option "--unknown"');
    expect(parseArgs(["search", "--dir", "--unknown", "query"])).toEqual(
      parsed("search", ["query"], { dir: "--unknown", limit: 10 }),
    );
  });
});

describe("parseArgs limit and format validation", () => {
  test.each([
    { value: "1", expected: 1 },
    { value: "999", expected: 999 },
    { value: "005", expected: 5 },
  ])("accepts positive one-to-three digit limit $value", ({ value, expected }) => {
    expect(parseArgs(["search", `--limit=${value}`, "query"]).limit).toBe(expected);
  });

  test.each(["0", "000", "-1", "+1", "1.0", "1000", "abc"])(
    "rejects invalid limit %s before operand arity",
    (value) => {
      expectParseError(["search", `--limit=${value}`], `invalid --limit "${value}"`);
    },
  );

  test.each([
    { value: "json", expected: "json" },
    { value: "dot", expected: "dot" },
    { value: "csv", expected: "csv" },
    { value: "md", expected: "md" },
  ])("accepts export format $value", ({ value, expected }) => {
    expect(parseArgs(["export", "--format", value]).format).toBe(expected);
  });

  test("rejects an invalid format before checking operands", () => {
    expectParseError(["export", "--format=html", "extra"], 'invalid --format "html"');
  });

  test("requires an export format before checking operand arity", () => {
    expectParseError(["export", "extra"], "missing --format");
  });

  test("an invalid scalar overwritten by a valid final value is accepted", () => {
    expect(parseArgs(["search", "--limit=1000", "--limit=1", "topic"]).limit).toBe(1);
    expect(parseArgs(["export", "--format=bad", "--format=json"]).format).toBe("json");
  });
});

describe("parseArgs operand arity and precedence", () => {
  test.each([
    { args: ["search"], message: "missing QUERY" },
    { args: ["links"], message: "missing NOTE" },
    { args: ["backlinks"], message: "missing NOTE" },
    { args: ["path"], message: "missing FROM" },
    { args: ["path", "from"], message: "missing TO" },
    { args: ["related"], message: "missing NOTE" },
    { args: ["capture"], message: "missing NAME" },
  ] as { args: string[]; message: string }[])(
    "reports missing required operands for $args",
    ({ args, message }) => {
      expectParseError(args, message);
    },
  );

  test.each([
    { args: ["index", "extra"] },
    { args: ["links", "one", "two"] },
    { args: ["backlinks", "one", "two"] },
    { args: ["check", "extra"] },
    { args: ["path", "one", "two", "three"] },
    { args: ["related", "one", "two"] },
    { args: ["tags", "one", "two"] },
    { args: ["stats", "extra"] },
    { args: ["export", "--format=json", "extra"] },
    { args: ["capture", "one", "two"] },
  ] as { args: string[] }[])("rejects excess operands for $args", ({ args }) => {
    expectParseError(args, "too many arguments");
  });

  test("allows multiple search operands and zero or one tags operand", () => {
    expect(parseArgs(["search", "launch", "weekly", "review"]).operands).toEqual([
      "launch",
      "weekly",
      "review",
    ]);
    expect(parseArgs(["tags"]).operands).toEqual([]);
    expect(parseArgs(["tags", "work"]).operands).toEqual(["work"]);
  });

  test("applies option and value errors before operand errors", () => {
    expectParseError(["search", "--unknown", "--limit=0"], 'unknown option "--unknown"');
    expectParseError(["search", "--limit=0"], 'invalid --limit "0"');
    expectParseError(["path", "from"], "missing TO");
  });

  test("checks export format errors before excess operands", () => {
    expectParseError(["export", "--format=invalid", "extra"], 'invalid --format "invalid"');
    expectParseError(["export", "--format=json", "extra"], "too many arguments");
  });
});
