export function decodeLossy(bytes: Uint8Array): string {
  const decoded = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(bytes);
  return decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded;
}

export function decodeStrict(bytes: Uint8Array): string | null {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded;
  } catch {
    return null;
  }
}

export function fnv1a(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function escapeField(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\t/g, "\\t")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

export function unescapeField(value: string): string | null {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== "\\") {
      result += character;
      continue;
    }

    index += 1;
    const escaped = value[index];
    if (escaped === "\\") result += "\\";
    else if (escaped === "t") result += "\t";
    else if (escaped === "r") result += "\r";
    else if (escaped === "n") result += "\n";
    else return null;
  }
  return result;
}

export function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (character) => String.fromCharCode(character.charCodeAt(0) + 32));
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function scaled(value: number): number {
  return Math.floor(value * 1000 + 0.5);
}

export function score3(value: number): string {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(Math.trunc(value));
  const whole = Math.floor(absolute / 1000);
  const fraction = String(absolute % 1000).padStart(3, "0");
  return `${sign}${whole}.${fraction}`;
}
