#!/usr/bin/env node
import fs from 'fs'; import path from 'path'; import os from 'os'; import { spawnSync } from 'child_process';
import { gather, doRoute } from '../src/core.mjs';
import { serve } from '../src/mcp.mjs';
import * as hook from '../src/hook.mjs';
import { watch } from '../src/watch.mjs';
const a = process.argv.slice(2), flag = n => a.includes('--' + n), opt = n => { const i = a.indexOf('--' + n); return i >= 0 ? a[i + 1] : undefined; };
const offline = flag('offline') || process.env.PLANLIMITS_OFFLINE === '1', json = flag('json');
const fmt = iso => iso ? new Date(iso).toLocaleString() : '-';
const pad = (s, n) => String(s).padEnd(n).slice(0, Math.max(n, String(s).length));
const HELP = `planlimits: local usage helper for https://planlimits.app (no keys, logs or prompts leave your machine)
  planlimits status [--json]                     detected usage, state and resets per plan
  planlimits route [--task refactor|everyday|quick] [--offline] [--json]
  planlimits mcp [--offline]                     local stdio MCP server (get_my_usage, route_me)
  planlimits watch [--threshold 80] [--interval 60] [--once] [--no-desktop] [--json]
                                                 alert at a % of the 5h or weekly window (Codex: server-reported; Claude Code: estimate vs your thresholds)
  planlimits init                                write a ~/.planlimits.json template
  planlimits hook install|uninstall claude-code [--yes]
  planlimits handoff codex [--print]              continue in Codex with the saved handoff
Online mode sends only plan ids + states (+ task) to planlimits.app/api/v1/route. --offline (or PLANLIMITS_OFFLINE=1) sends nothing.`;
async function main() {
  const c = a[0];
  if (c === 'mcp') return serve({ offline });
  if (c === 'status') { const g = gather(); if (json) return console.log(JSON.stringify({ plans: g.plans.map(({ detail, ...p }) => ({ ...p, detail })), notes: g.notes }, null, 1));
    console.log(pad('PLAN', 16) + pad('STATE', 12) + pad('SOURCE', 16) + 'DETAIL');
    for (const p of g.plans) { const d = p.detail || {}; const use = d.tool === 'claude-code' ? `5h tokens ${d.session_tokens ?? 0}, 7d tokens ${d.weekly_tokens_7d ?? 0}${d.estimate ? ' (estimate)' : ''}` : d.tool === 'openai-codex' && d.windows ? d.windows.map(w => `${w.kind} ${w.used_percent}%`).join(', ') + ` (server-reported, ${d.snapshot_age_min} min old)` : '';
      console.log(pad(p.plan, 16) + pad(p.state, 12) + pad(p.source, 16) + [use, d.basis].filter(Boolean).join(' | '));
      for (const r of d.resets || []) console.log(pad('', 44) + `resets: ${r.window} at ${fmt(r.at)}`); }
    if (!g.plans.length) console.log('(no plans found: no local Claude Code/Codex logs and no ~/.planlimits.json; run planlimits init)');
    for (const n of g.notes) console.log('note: ' + n); console.log(`config: ${g.cfg.file}${g.cfg.exists ? '' : ' (not found)'}${g.cfg.parseError ? ' (INVALID JSON: ' + g.cfg.parseError + ')' : ''}`); return; }
  if (c === 'route') { const g = gather(); if (!g.plans.length) { console.error('No plans found. Run planlimits init and edit ~/.planlimits.json.'); process.exitCode = 1; return; }
    const r = await doRoute(g.plans, opt('task'), { offline }); if (json) return console.log(JSON.stringify(r, null, 1));
    if (r.ok === false) { console.error('Route error: ' + r.error); process.exitCode = 1; return; }
    console.log(r.summary); if (r.recommendation) console.log('Why: ' + r.recommendation.why); if (r.fallback) console.log((r.recommendation ? 'Fallback: ' : 'Back first: ') + r.fallback.name);
    if (r.cost_note) console.log('Cost: ' + r.cost_note); console.log('Resets:'); for (const p of r.plans) console.log(`  ${p.name} (${p.state}): ${p.resets.join('; ')}`);
    console.log(`Rotation (${r.rotation.label}):`); for (const d of r.rotation.schedule) console.log(`  ${pad(d.day, 9)} ${d.why}`);
    console.log(`via ${r.via}; sources checked ${r.data_checked_oldest} to ${r.data_checked_newest}`); return; }
  if (c === 'watch') { const cfgW = (await import('../src/detect.mjs')).loadConfig().watch || {};
    const th = Number(opt('threshold') ?? cfgW.threshold_percent ?? 80), iv = Number(opt('interval') ?? cfgW.interval_seconds ?? 60);
    if (!(th > 0 && th <= 100) || !(iv >= 10)) { console.error('--threshold must be 1-100 and --interval at least 10 seconds.'); process.exitCode = 1; return; }
    const r = await watch({ threshold: th, interval: iv, once: flag('once'), desktop: !flag('no-desktop') && cfgW.desktop !== false, json }); if (flag('once') && r.length) process.exitCode = 2; return; }
  if (c === 'init') { const f = path.join(process.env.HOME || os.homedir(), '.planlimits.json'); if (fs.existsSync(f) && !flag('force')) { console.log(`${f} already exists (use --force to overwrite).`); return; }
    fs.writeFileSync(f, JSON.stringify({ plans: { 'claude-pro': 'auto', 'codex-plus': 'auto', 'cursor-premium': 'fine', 'copilot-pro': 'fine' }, thresholds: { 'claude-code': { session_tokens: null, weekly_tokens: null, low_ratio: 0.8, _note: 'Anthropic publishes no token limits. Set your own (estimate), e.g. from past sessions where you hit the limit.' }, 'openai-codex': { low_percent: 80 } }, watch: { threshold_percent: 80, interval_seconds: 60, desktop: true }, _states: 'manual states: fine | low | session_hit | exhausted (or weekly_hit); "auto" = detect from local logs (Claude Code, Codex CLI only)' }, null, 2) + '\n');
    console.log('Wrote ' + f + '. Edit plans (ids like on https://planlimits.app/router/) and thresholds.'); return; }
  if (c === 'hook') { const sub = a[1], tool = a[2];
    if (sub === 'run') return hook.run();
    if (tool !== 'claude-code') { console.error('Only "claude-code" hooks are supported.'); process.exitCode = 1; return; }
    process.exitCode = sub === 'install' ? await hook.install({ yes: flag('yes') }) : sub === 'uninstall' ? await hook.uninstall({ yes: flag('yes') }) : 1; return; }
  if (c === 'handoff') { if (a[1] !== 'codex') { console.error('Usage: planlimits handoff codex'); process.exitCode = 1; return; }
    const f = path.join(process.env.HOME || os.homedir(), '.planlimits', 'handoff.md'); if (!fs.existsSync(f)) { console.error('No handoff saved yet (' + f + '). The Claude Code hook writes it when usage is low or limited.'); process.exitCode = 1; return; }
    const t = fs.readFileSync(f, 'utf8'); if (flag('print')) { console.log('codex ' + JSON.stringify(t)); return; }
    const r = spawnSync('codex', [t], { stdio: 'inherit' }); if (r.error) { console.error('Could not start codex (' + r.error.code + '). Install Codex CLI, or run: codex "$(cat ' + f + ')"'); process.exitCode = 1; } return; }
  console.log(HELP);
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
