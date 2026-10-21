// SPDX-License-Identifier: MIT
// HP39 transport envelopes only. Never execute or certify the contained object.
// Format evidence and byte/charset limits: docs/development/hp39-files.md.
export const MAX_HP39_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_HP39_BUNDLE_BYTES = 16 * 1024 * 1024;
export const MAX_HP39_DIRECTORY_ENTRIES = 256;
const descriptions = Object.freeze({ A: 'directory', B: 'aplet', C: 'note', D: 'program', H: 'library' });
const space = byte => byte === 32 || byte === 9 || byte === 10 || byte === 13;
const kind = byte => byte >= 65 && byte <= 75;
const latin1 = bytes => Array.from(bytes, byte => String.fromCharCode(byte)).join('');

function bytesOf(input) {
  if (!(input instanceof Uint8Array)) throw new TypeError('HP39 input must be a Uint8Array.');
  if (input.length < 8 || input.length > MAX_HP39_FILE_BYTES)
    throw new Error('HP39 input must contain 8 bytes to 2 MiB.');
  return input;
}

function header(input) {
  const bytes = bytesOf(input), magic = latin1(bytes.subarray(0, 8));
  if (!/^HP39(?:Bin|Asc)[A-K]$/.test(magic))
    throw new Error('Expected an HP39Bin/HP39Asc typed file, not an HP48/49 object or ROM.');
  return { bytes, magic, encoding: magic.slice(4, 7) === 'Bin' ? 'binary' : 'ascii', kind: magic[7] };
}

function title(bytes) {
  if (bytes.some(byte => byte < 32 || byte === 127)) throw new Error('Control byte in HP39 title.');
  // A reversible byte display, not an HP charset-to-Unicode translation.
  return latin1(bytes);
}

function counted(bytes, offset, field) {
  while (space(bytes[offset])) ++offset;
  const first = offset;
  let count = 0;
  while (bytes[offset] >= 48 && bytes[offset] <= 57) {
    count = count * 10 + bytes[offset++] - 48;
    if (offset - first > 3 || count > 255) throw new Error(`${field} exceeds the 255-byte envelope limit.`);
  }
  // Consume exactly one separator: a leading space can belong to the value.
  if (offset === first || bytes[offset++] !== 32) throw new Error(`Missing ${field} byte count or space.`);
  const end = offset + count;
  if (end > bytes.length) throw new Error(`Truncated ${field}.`);
  return { value: bytes.subarray(offset, end), end };
}

/** Local, printable ASCII basename policy for a future Kermit file server.
 * This is a host policy, not a claim that every calculator supports long names. */
export function validateHp39Filename(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,254}$/.test(name) || name.endsWith('.') ||
      /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name))
    throw new Error('HP39 file name must be a local ASCII basename without paths or reserved device names.');
  return name;
}

/** Parse length-delimited HP39AscA entries; titles may contain spaces. */
export function parseHp39Directory(input) {
  const h = header(input);
  if (h.encoding !== 'ascii' || h.kind !== 'A') throw new Error('Only HP39AscA directories are supported.');
  const entries = [], seen = new Set();
  let offset = 8;
  if (offset < h.bytes.length && !space(h.bytes[offset])) throw new Error('Missing directory header separator.');
  while (offset < h.bytes.length) {
    while (space(h.bytes[offset])) ++offset;
    if (offset === h.bytes.length) break;
    if (entries.length >= MAX_HP39_DIRECTORY_ENTRIES) throw new Error('Too many HP39 directory entries.');
    const type = h.bytes[offset++];
    if (!kind(type) || !space(h.bytes[offset])) throw new Error('Invalid HP39 directory entry type or separator.');
    const fileField = counted(h.bytes, offset, 'file name');
    const file = validateHp39Filename(latin1(fileField.value));
    const nameField = counted(h.bytes, fileField.end, 'title');
    const name = title(nameField.value), key = file.toUpperCase();
    if (seen.has(key)) throw new Error('Duplicate file name in HP39 directory (case insensitive).');
    seen.add(key);
    entries.push({ kind: String.fromCharCode(type), file, title: name });
    offset = nameField.end;
  }
  return entries;
}

/** Identify the envelope; a successful result does NOT validate object code. */
export function inspectHp39File(input) {
  const h = header(input);
  const out = { family: 'hp39', magic: h.magic, encoding: h.encoding, kind: h.kind,
    kindDescription: descriptions[h.kind] ?? null, bytes: h.bytes.length,
    envelopeValidated: true, payloadValidated: false, hardwareValidated: false };
  if (h.kind === 'A') {
    const entries = parseHp39Directory(h.bytes);
    return { ...out, entries, payloadValidated: true, validationScope: 'directory-fields' };
  }
  let field;
  if (h.encoding === 'binary') {
    if (h.bytes.length < 9) throw new Error('Missing binary HP39 title length.');
    const end = 9 + h.bytes[8];
    if (end > h.bytes.length) throw new Error('Truncated binary HP39 title.');
    field = { value: h.bytes.subarray(9, end), end };
  } else field = counted(h.bytes, 8, 'title');
  if (field.end === h.bytes.length) throw new Error('Missing HP39 object payload.');
  return { ...out, title: title(field.value), titleBytes: field.value.length,
    payloadOffset: field.end, payloadBytes: h.bytes.length - field.end,
    validationScope: 'typed-envelope-only' };
}

function titleText(value) {
  if (typeof value !== 'string' || value.length > 255 ||
      Array.from(value).some(char => char.codePointAt(0) > 255))
    throw new Error('HP39 titles must contain at most 255 single-byte characters.');
  title(Uint8Array.from(value, char => char.charCodeAt(0)));
  return value;
}

/** Create the two directory files independently of any binary object builder. */
export function createHp39Directory(entries) {
  if (!Array.isArray(entries) || entries.length > MAX_HP39_DIRECTORY_ENTRIES)
    throw new Error('Invalid HP39 directory entry count.');
  let text = 'HP39AscA ';
  for (const entry of entries) {
    if (!entry || typeof entry.kind !== 'string' || !/^[A-K]$/.test(entry.kind))
      throw new Error('Invalid HP39 directory entry type.');
    const file = validateHp39Filename(entry.file), name = titleText(entry.title);
    text += `${entry.kind} ${file.length} ${file}${name.length} ${name}`;
  }
  const bytes = Uint8Array.from(text, char => char.charCodeAt(0));
  parseHp39Directory(bytes); // Also rejects duplicate case-folded file names.
  return bytes;
}

/** Check a finite, in-memory package. Does not upload, execute, or read paths. */
export function inspectHp39Bundle(files) {
  if (!Array.isArray(files) || files.length < 2 || files.length > MAX_HP39_DIRECTORY_ENTRIES)
    throw new Error('An HP39 bundle needs 2 to 256 explicit files.');
  const byName = new Map();
  let total = 0;
  for (const file of files) {
    const name = validateHp39Filename(file?.name), key = name.toUpperCase();
    if (byName.has(key)) throw new Error('Duplicate bundle file name (case insensitive).');
    const info = inspectHp39File(file.bytes);
    total += info.bytes;
    if (total > MAX_HP39_BUNDLE_BYTES) throw new Error('HP39 bundle exceeds the 16 MiB host limit.');
    byName.set(key, { name, info });
  }
  const current = byName.get('HP39DIR.CUR');
  if (!current || current.info.kind !== 'A' || current.info.entries.length !== 1 ||
      current.info.entries[0].kind !== 'A')
    throw new Error('HP39DIR.CUR must point to exactly one directory.');
  const visited = new Set(), active = new Set();
  function visit(key) {
    if (active.has(key)) throw new Error('Cycle in HP39 directory references.');
    if (visited.has(key)) return;
    const item = byName.get(key);
    active.add(key);
    for (const entry of item.info.entries ?? []) {
      const targetKey = entry.file.toUpperCase(), target = byName.get(targetKey);
      if (!target) throw new Error(`Missing HP39 bundle file: ${entry.file}.`);
      if (target.info.kind !== entry.kind) throw new Error(`HP39 type mismatch for ${entry.file}.`);
      if (entry.kind !== 'A' && target.info.title !== entry.title)
        throw new Error(`HP39 title mismatch for ${entry.file}.`);
      visit(targetKey);
    }
    active.delete(key);
    visited.add(key);
  }
  visit('HP39DIR.CUR');
  const unreferenced = [...byName].filter(([key]) => !visited.has(key)).map(([, item]) => item.name);
  if (unreferenced.length) throw new Error(`Unreferenced HP39 bundle files: ${unreferenced.join(', ')}.`);
  return { family: 'hp39', files: files.length, bytes: total, referencesValidated: true,
    payloadValidated: false, hardwareValidated: false, uploadEnabled: false,
    objects: [...byName.values()].map(({ name, info }) => ({ file: name, ...info })) };
}
