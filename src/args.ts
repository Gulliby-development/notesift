import { cleanDir } from "./scan";
import { CliError } from "./types";

export type Command =
  | "index"
  | "search"
  | "links"
  | "backlinks"
  | "check"
  | "path"
  | "related"
  | "tags"
  | "stats"
  | "export"
  | "capture";

export type ExportFormat = "json" | "dot" | "csv" | "md";

export interface Parsed {
  command: Command | "help";
  dir: string;
  operands: string[];
  limit: number | null;
  format: ExportFormat | null;
  title: string | null;
  tags: string[];
}

const COMMANDS: readonly Command[] = [
  "index",
  "search",
  "links",
  "backlinks",
  "check",
  "path",
  "related",
  "tags",
  "stats",
  "export",
  "capture",
];

const MISSING_COMMAND =
  "missing command (index, search, links, backlinks, check, path, related, tags, stats, export or capture)";

function isCommand(value: string): value is Command {
  return COMMANDS.includes(value as Command);
}

function allowsOption(command: Command, option: string): boolean {
  switch (option) {
    case "--dir":
      return true;
    case "--limit":
      return command === "search" || command === "related";
    case "--format":
      return command === "export";
    case "--title":
    case "--tag":
      return command === "capture";
    default:
      return false;
  }
}

function isExportFormat(value: string): value is ExportFormat {
  return value === "json" || value === "dot" || value === "csv" || value === "md";
}

function validateArity(command: Command, operands: string[]): void {
  switch (command) {
    case "search":
      if (operands.length === 0) throw new CliError("missing QUERY");
      return;
    case "links":
    case "backlinks":
    case "related":
      if (operands.length === 0) throw new CliError("missing NOTE");
      if (operands.length > 1) throw new CliError("too many arguments");
      return;
    case "path":
      if (operands.length === 0) throw new CliError("missing FROM");
      if (operands.length === 1) throw new CliError("missing TO");
      if (operands.length > 2) throw new CliError("too many arguments");
      return;
    case "capture":
      if (operands.length === 0) throw new CliError("missing NAME");
      if (operands.length > 1) throw new CliError("too many arguments");
      return;
    case "tags":
      if (operands.length > 1) throw new CliError("too many arguments");
      return;
    case "index":
    case "check":
    case "stats":
    case "export":
      if (operands.length > 0) throw new CliError("too many arguments");
  }
}

export function parseArgs(args: string[]): Parsed {
  if (args.length === 1 && args[0] === "--help") {
    return {
      command: "help",
      dir: ".",
      operands: [],
      limit: null,
      format: null,
      title: null,
      tags: [],
    };
  }
  if (args.length === 0) throw new CliError(MISSING_COMMAND);

  const commandName = args[0];
  if (commandName === undefined) throw new CliError(MISSING_COMMAND);
  if (!isCommand(commandName)) {
    throw new CliError(`unknown command "${commandName}"`);
  }

  const command = commandName;
  let dir = ".";
  let limitValue: string | null = null;
  let formatValue: string | null = null;
  let title: string | null = null;
  const tags: string[] = [];
  const operands: string[] = [];

  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (!arg.startsWith("-") || arg === "-") {
      operands.push(arg);
      continue;
    }

    const equalsAt = arg.indexOf("=");
    const option = equalsAt < 0 ? arg : arg.slice(0, equalsAt);
    if (!allowsOption(command, option)) {
      throw new CliError(`unknown option "${arg}"`);
    }

    let value: string;
    if (equalsAt >= 0) {
      value = arg.slice(equalsAt + 1);
    } else {
      const next = args[i + 1];
      if (next === undefined) throw new CliError(`${option} needs a value`);
      value = next;
      i += 1;
    }

    switch (option) {
      case "--dir":
        dir = value;
        break;
      case "--limit":
        limitValue = value;
        break;
      case "--format":
        formatValue = value;
        break;
      case "--title":
        title = value;
        break;
      case "--tag":
        tags.push(value);
        break;
    }
  }

  let limit: number | null = command === "search" ? 10 : command === "related" ? 5 : null;
  if (limitValue !== null) {
    if (!/^[0-9]{1,3}$/.test(limitValue) || Number(limitValue) < 1) {
      throw new CliError(`invalid --limit "${limitValue}"`);
    }
    limit = Number(limitValue);
  }

  let format: ExportFormat | null = null;
  if (formatValue !== null) {
    if (!isExportFormat(formatValue)) {
      throw new CliError(`invalid --format "${formatValue}"`);
    }
    format = formatValue;
  }
  if (command === "export" && format === null) {
    throw new CliError("missing --format");
  }

  validateArity(command, operands);

  return {
    command,
    dir: cleanDir(dir),
    operands,
    limit,
    format,
    title,
    tags,
  };
}
