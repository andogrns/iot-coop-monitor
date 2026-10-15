// Shared by both export paths. JSON/history/archive values remain unchanged.
export function csvCell(value) {
  let text = String(value ?? '');
  // Treat potentially executable text as a literal, including whitespace and
  // full-width formula prefixes. Actual numeric measurements stay numeric.
  if (typeof value === 'string' && (/^\s*[=+\-@＝＋－＠]/u.test(text) || /^[\t\r\n]/.test(text))) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
