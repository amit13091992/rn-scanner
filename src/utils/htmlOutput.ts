import { writeFileSync } from 'fs';

/**
 * Wraps any command's existing JSON-shaped result in a minimal, dependency-free HTML page —
 * no CSS framework, no build step, same "no new dependency for an output format" approach
 * `utils/reportFormat.ts`'s `formatReportHtml` already uses for `report --format html`.
 */
export function formatJsonAsHtml(title: string, data: unknown): string {
  const json = JSON.stringify(data, null, 2);
  const escaped = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
body{font-family:-apple-system,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;line-height:1.5}
pre{white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;background:#f6f8fa;padding:1rem;border-radius:6px;overflow-x:auto;font-size:0.85rem}
</style>
</head>
<body>
<h1>${title}</h1>
<p>Generated: ${new Date().toISOString()}</p>
<pre>${escaped}</pre>
</body>
</html>
`;
}

/** Writes HTML to a file when a path is given, else prints it to stdout — the same
 *  "path or stdout" convention `report --out` already uses. */
export function emitHtml(html: string, outPath?: string): void {
  if (outPath) {
    writeFileSync(outPath, html);
    console.log(`HTML report written to ${outPath}`);
  } else {
    console.log(html);
  }
}

/** A command's `--html [path]` option value: `true` (flag given, no path — print to stdout),
 *  a path string (write to that file), or absent/false. */
export type HtmlOption = string | boolean | undefined;

/**
 * Shared success-path output for a command that supports `--json` and `--html`. Returns true
 * if it handled output (caller should `return` immediately after), false if the caller should
 * fall through to its normal human-readable printing.
 */
export function emitStructuredOutput(
  data: unknown,
  title: string,
  options: { json?: boolean; html?: HtmlOption }
): boolean {
  if (options.html) {
    emitHtml(formatJsonAsHtml(title, data), typeof options.html === 'string' ? options.html : undefined);
    return true;
  }
  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return true;
  }
  return false;
}
