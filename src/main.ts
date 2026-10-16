import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { run } from "./cli";
import type { Io } from "./types";

function listFiles(root: string, directory: string, files: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      listFiles(root, path, files);
    } else if (entry.isFile()) {
      files.push(relative(root, path).split(sep).join("/"));
    }
  }
}

const io: Io = {
  files(dir) {
    const root = resolve(dir);
    const files: string[] = [];
    listFiles(root, root, files);
    return files;
  },
  read(path) {
    return readFileSync(path);
  },
  write(path, data) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
  },
  readStdin() {
    return readFileSync(0);
  },
  out(text) {
    process.stdout.write(text);
  },
  err(text) {
    process.stderr.write(text);
  },
};

process.exitCode = run(process.argv.slice(2), io);
