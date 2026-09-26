import { readFileSync, writeFileSync } from 'node:fs';
const [, , target, searchFile, replaceFile] = process.argv;
const norm = (s) => s.replace(/\r\n/g, '\n');
const raw = readFileSync(target, 'utf8');
const crlf = raw.includes('\r\n');
const text = norm(raw);
const a = norm(readFileSync(searchFile, 'utf8'));
let b = norm(readFileSync(replaceFile, 'utf8'));
if (crlf) b = b.replace(/\n/g, '\r\n');
const n = text.split(a).length - 1;
if (n !== 1) {
  console.error('FAIL: matched ' + n + ' times (expected 1), file unchanged. Snippet starts with: ' + JSON.stringify(a.slice(0, 60)));
  process.exit(1);
}
writeFileSync(target, text.split(a).join(b));
console.log('OK: ' + target + ' replaced 1 occurrence');
