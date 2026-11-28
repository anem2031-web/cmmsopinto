import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
const root = process.cwd();
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const norm = file => path.resolve(root, file).replaceAll('\\', '/').toLowerCase();
const changed = git('diff', '--name-only', '--diff-filter=M').trim().split(/\r?\n/).filter(f => /\.[cm]?tsx?$/.test(f));
const originals = new Map(changed.map(file => [norm(file), git('show', `HEAD:${file}`)]));
const added = new Set(git('ls-files', '--others', '--exclude-standard').trim().split(/\r?\n/).filter(f => /\.[cm]?tsx?$/.test(f)).map(norm));
const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
function check(before) {
  const host = ts.createCompilerHost({ ...parsed.options, incremental: false });
  const read = host.readFile.bind(host), exists = host.fileExists.bind(host);
  if (before) {
    host.readFile = file => added.has(norm(file)) ? undefined : originals.get(norm(file)) ?? read(file);
    host.fileExists = file => !added.has(norm(file)) && exists(file);
  }
  const program = ts.createProgram({ rootNames: parsed.fileNames.filter(file => !before || !added.has(norm(file))), options: { ...parsed.options, incremental: false }, host });
  return ts.getPreEmitDiagnostics(program).map(d => {
    const file = d.file ? path.relative(root, d.file.fileName).replaceAll('\\', '/') : 'config';
    const message = `${file}: TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
    // Unchanged source diagnostics can print properties/unions in a different order
    // after adding an import. Their exact source location/code remains identical.
    const unchanged = d.file && !originals.has(norm(d.file.fileName)) && !added.has(norm(d.file.fileName));
    return { key: unchanged ? `${file}:${d.start}:TS${d.code}` : message, message };
  }).sort((a, b) => a.key.localeCompare(b.key));
}
const before = check(true); global.gc?.(); const after = check(false);
const difference = (a, b) => { const remaining = [...b]; return a.filter(v => { const i = remaining.findIndex(other => other.key === v.key); if (i < 0) return true; remaining.splice(i, 1); return false; }).map(v => v.message); };
const result = { before: before.length, after: after.length, introduced: difference(after, before), resolved: difference(before, after) };
fs.writeFileSync(path.join(os.tmpdir(), 'cmms-your-work-type-comparison.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
if (result.introduced.length) process.exitCode = 1;
