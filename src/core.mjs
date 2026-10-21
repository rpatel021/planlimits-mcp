import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { loadConfig, detectClaude, detectCodex, myPlans } from './detect.mjs';
import { route } from '../vendor/route.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
export const PLANS = JSON.parse(fs.readFileSync(path.join(here, '..', 'vendor', 'plans.json'), 'utf8'));
export const API = process.env.PLANLIMITS_API || 'https://planlimits.app/api/v1/route';
export function gather(now = Date.now()) {
  const cfg = loadConfig(); const det = { claude: detectClaude(cfg, now), codex: detectCodex(cfg, now) };
  return { cfg, det, ...myPlans(cfg, det, now) };
}
// Online: sends ONLY plan ids, states and task to /api/v1/route. Offline: bundled lib/route.mjs + data (same code as the site).
export async function doRoute(plans, task, { offline } = {}) {
  const input = { plans: plans.map(p => ({ plan: p.plan, state: p.state })), task };
  if (!offline) {
    try { const qs = 'plans=' + encodeURIComponent(input.plans.map(p => p.plan + ':' + p.state).join(',')).replace(/%3A/g, ':').replace(/%2C/g, ',') + (task ? '&task=' + encodeURIComponent(task) : '') + '&src=cli';
      const r = await fetch(API + '?' + qs, { signal: AbortSignal.timeout(8000), headers: process.env.PLANLIMITS_TEST ? { 'x-planlimits-test': '1' } : {} }); const j = await r.json(); return { ...j, via: 'api' };
    } catch (e) { const j = route(PLANS, input); return { ...j, via: 'offline (API unreachable: ' + e.message + ')' }; }
  }
  return { ...route(PLANS, input), via: 'offline (bundled data checked ' + PLANS.checked + ')' };
}
