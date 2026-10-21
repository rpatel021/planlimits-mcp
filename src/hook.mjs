// Claude Code hook install/uninstall/run. Edits ~/.claude/settings.json only after a backup and confirmation.
import fs from 'fs'; import path from 'path'; import os from 'os'; import readline from 'readline'; import { fileURLToPath } from 'url';
import { gather, doRoute } from './core.mjs';
const H = () => process.env.HOME || os.homedir();
const MARK = 'planlimits-hook-run';
const settingsFile = () => path.join(process.env.CLAUDE_CONFIG_DIR?.split(',')[0] || path.join(H(), '.claude'), 'settings.json');
const home = () => path.join(H(), '.planlimits');
async function confirm(q) { if (!process.stdin.isTTY) return false; const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); const a = await new Promise(r => rl.question(q + ' [y/N] ', r)); rl.close(); return /^y(es)?$/i.test(a.trim()); }
export async function install({ yes } = {}) {
  const f = settingsFile(); let s = {};
  if (fs.existsSync(f)) { try { s = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { console.error(`Refusing to edit ${f}: it is not valid JSON (${e.message}). Nothing changed.`); return 1; } }
  if (JSON.stringify(s.hooks?.Stop || []).includes(MARK)) { console.log('PlanLimits hook is already installed. Nothing changed.'); return 0; }
  // Copy this CLI to ~/.planlimits/cli so the hook doesn't depend on the npx cache.
  const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const dst = path.join(home(), 'cli');
  const cmd = `node "${path.join(dst, 'bin', 'planlimits.mjs')}" hook run # ${MARK}`;
  console.log(`This will:\n  1. copy the planlimits CLI to ${dst}\n  2. back up ${f}\n  3. add a "Stop" hook to it: ${cmd}\nThe hook runs locally after each Claude Code reply. It reads your local logs, and if usage is low or a limit is hit it prints a warning and writes ${path.join(home(), 'handoff.md')}. It never moves or stops a session.`);
  if (!yes && !(await confirm('Proceed?'))) { console.log('Cancelled. Nothing changed. (Use --yes to skip the prompt.)'); return 1; }
  fs.mkdirSync(dst, { recursive: true }); fs.cpSync(src, dst, { recursive: true, filter: p => !p.includes('node_modules') && !p.includes(path.sep + 'test' + path.sep) && !p.endsWith(path.sep + 'test') });
  fs.mkdirSync(path.dirname(f), { recursive: true });
  let backup = null; if (fs.existsSync(f)) { backup = f + '.planlimits-backup-' + new Date().toISOString().replace(/[:.]/g, '-'); fs.copyFileSync(f, backup); }
  s.hooks = s.hooks || {}; s.hooks.Stop = s.hooks.Stop || []; s.hooks.Stop.push({ hooks: [{ type: 'command', command: cmd, timeout: 30 }] });
  const tmp = f + '.planlimits-tmp'; fs.writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n'); fs.renameSync(tmp, f);
  console.log(`Installed. ${backup ? 'Backup: ' + backup : 'No previous settings file.'}\nUndo any time: planlimits hook uninstall claude-code`); return 0;
}
export async function uninstall({ yes } = {}) {
  const f = settingsFile(); if (!fs.existsSync(f)) { console.log('No Claude Code settings file. Nothing to remove.'); return 0; }
  let s; try { s = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { console.error(`Refusing to edit ${f}: not valid JSON. Nothing changed.`); return 1; }
  const before = JSON.stringify(s.hooks?.Stop || []); if (!before.includes(MARK)) { console.log('PlanLimits hook not found. Nothing changed.'); return 0; }
  if (!yes && !(await confirm(`Remove the PlanLimits Stop hook from ${f} (a backup is made first)?`))) { console.log('Cancelled. Nothing changed.'); return 1; }
  const backup = f + '.planlimits-backup-' + new Date().toISOString().replace(/[:.]/g, '-'); fs.copyFileSync(f, backup);
  s.hooks.Stop = s.hooks.Stop.map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !String(h.command || '').includes(MARK)) })).filter(g => g.hooks.length);
  if (!s.hooks.Stop.length) delete s.hooks.Stop; if (!Object.keys(s.hooks).length) delete s.hooks;
  const tmp = f + '.planlimits-tmp'; fs.writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n'); fs.renameSync(tmp, f);
  console.log(`Removed. Backup of the previous file: ${backup}\n(${path.join(home(), 'cli')} was left in place; delete it if you like.)`); return 0;
}
// Runs inside Claude Code's Stop hook: stdin = hook JSON. Prints {"systemMessage": ...} only when action is needed. Offline routing (no network).
export async function run() {
  let inp = {}; try { const t = fs.readFileSync(0, 'utf8'); inp = t ? JSON.parse(t) : {}; } catch {}
  const g = gather(); const me = g.plans.find(p => p.plan.startsWith('claude-'));
  if (!me || me.state === 'fine') return 0;
  const r = await doRoute(g.plans, 'everyday', { offline: true });
  const alt = r.recommendation && !r.recommendation.plan.startsWith('claude-') ? r.recommendation : r.fallback && !r.fallback.plan.startsWith('claude-') ? r.fallback : null;
  fs.mkdirSync(home(), { recursive: true }); const hf = path.join(home(), 'handoff.md');
  fs.writeFileSync(hf, `# Handoff from Claude Code (${new Date().toISOString()})\n\nProject directory: ${inp.cwd || process.cwd()}\nClaude Code state: ${me.state} (${me.detail?.basis || ''})\nRoute: ${r.summary || ''}\n\n## Last assistant message\n${String(inp.last_assistant_message || '(not available)').slice(0, 4000)}\n\n## Please continue\nContinue the task above in this repository. Check \`git status\` and \`git diff\` first to see what was already changed.\n`);
  const msg = `PlanLimits: Claude Code looks ${me.state === 'low' ? 'close to its limit' : 'limited (' + me.state + ')'} [${me.detail?.basis || ''}]. ${r.summary || ''}${alt && alt.plan.startsWith('codex-') ? ' To continue in Codex: planlimits handoff codex' : ''} (handoff saved to ${hf})`;
  process.stdout.write(JSON.stringify({ systemMessage: msg }) + '\n'); return 0;
}
