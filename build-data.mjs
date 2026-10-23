// Builds the static 2,000-seat snapshot for IMD Seat Check.
// Run: node build-data.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'data');
const API = 'https://api.imd.fun';
const CONCURRENCY = 6;
// The four step-1 endpoints are fatal if they fail, so they ride out longer DNS/503 blips (~3 min of backoff).
const CRITICAL_ATTEMPTS = 9;
const MAX_FAILED_RATIO = 0.05;

fs.mkdirSync(OUT, { recursive: true });

const backoff = (attempt) => new Promise((s) => setTimeout(s, 5000 * (attempt + 1)));

// Retries 429, transient 5xx (the API sometimes answers 503 for a few seconds) and network errors.
async function json(url, attempts = 4) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const last = attempt === attempts - 1;
    let r;
    try {
      r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'seat-check-snapshot/1.0' } });
    } catch (err) {
      if (last) throw err;
      await backoff(attempt); continue;
    }
    if (r.status === 404) return null;
    if (r.status === 429) { await backoff(attempt); continue; }
    if (r.status >= 500 && !last) { await backoff(attempt); continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
    return r.json();
  }
  throw new Error(`HTTP 429 after ${attempts} attempts ${url}`);
}

async function pool(items, worker) {
  const out = new Array(items.length);
  let i = 0, failed = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await worker(items[idx]); } catch { out[idx] = null; failed++; }
    }
  }));
  return { out, failed };
}

console.log('[1/4] swarm, owners, records, workers…');
const [swarm, owners, records, workers] = await Promise.all([
  json(`${API}/swarm`, CRITICAL_ATTEMPTS), json(`${API}/seats/owners`, CRITICAL_ATTEMPTS),
  json(`${API}/seats/records`, CRITICAL_ATTEMPTS), json(`${API}/workers`, CRITICAL_ATTEMPTS),
]);

const recordBy = new Map((records.seats || []).map((s) => [String(s.tokenId), s]));
const workerBy = new Map();
for (const w of workers.workers || []) if (w.seat?.tokenId) workerBy.set(String(w.seat.tokenId), w);

const ownerList = [];
const ownerIdx = new Map();
const ownerSeatCount = new Map();
(owners.owners || []).forEach((o) => {
  const a = (o || '').toLowerCase();
  if (!a) return;
  ownerSeatCount.set(a, (ownerSeatCount.get(a) || 0) + 1);
});

const toCheck = [...new Set([...recordBy.keys(), ...workerBy.keys()])].sort((a, b) => a - b);
console.log(`[2/4] standing for ${toCheck.length} seats (concurrency ${CONCURRENCY})…`);
let done = 0;
const { out: standings, failed } = await pool(toCheck, async (id) => {
  const s = await json(`${API}/seats/${id}/standing?queue=0`);
  if (++done % 100 === 0) console.log(`   ${done}/${toCheck.length}`);
  return s;
});
if (failed) console.log(`   ${failed}/${toCheck.length} standing requests failed`);
// A failed standing publishes the seat as not enrolled / not qualified: past this ratio the API was down, keep the last snapshot.
if (failed > toCheck.length * MAX_FAILED_RATIO) {
  console.error(`aborting: over ${MAX_FAILED_RATIO * 100}% of standing requests failed, previous snapshot kept`);
  process.exit(1);
}
const standingBy = new Map(toCheck.map((id, i) => [id, standings[i]]));

console.log('[3/4] assembling seats.json…');
const seats = [];
for (let id = 0; id < (owners.owners || []).length; id++) {
  const tid = String(id);
  const owner = (owners.owners[id] || '').toLowerCase();
  if (!owner) continue;
  if (!ownerIdx.has(owner)) { ownerIdx.set(owner, ownerList.length); ownerList.push([owner, ownerSeatCount.get(owner)]); }
  const rec = recordBy.get(tid);
  const w = workerBy.get(tid);
  const st = standingBy.get(tid);
  const c = st?.contract || {};
  seats.push({
    id,
    o: ownerIdx.get(owner),
    on: w ? 1 : 0,
    en: st?.enrollment?.status === 'active' ? 1 : 0,
    m: w?.runtimes?.[0]?.premiumModel?.model || w?.runtimes?.[0]?.id || null,
    t: (w?.tools || []).length,
    a: rec?.attempts || 0,
    ok: rec?.accepted || 0,
    rj: rec?.rejected || 0,
    fl: rec?.failed || 0,
    lw: rec?.lastWorkedAt || null,
    q: c.qualifies ? 1 : 0,
    g: c.good || 0,
    b: c.bad || 0,
    r: (c.recent || []).map((x) => (x === 'good' ? 'g' : 'b')).join(''),
    pu: c.probationUntil || null,
    pn: c.probations || 0,
    cf: st?.standing?.consecutiveFailures || 0,
    pz: st?.standing?.pausedByOwnerAt || st?.standing?.pausedUntil || null,
  });
}

fs.writeFileSync(path.join(OUT, 'seats.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  collection: owners.collection,
  owners: ownerList,
  seats,
}));

console.log('[4/4] study.json…');
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const prevStudy = readJson(path.join(OUT, 'study.json')) || {};
const study = {
  generatedAt: new Date().toISOString(),
  network: {
    holders: owners.holders,
    seatsTotal: (owners.owners || []).length,
    enrolled: swarm.health?.seatsEnrolled,
    online: workers.count,
    everWorked: records.count,
    launchesLive: swarm.counts?.launchesLive,
    jobsCompleted: swarm.counts?.jobStates?.completed,
  },
  launches: prevStudy.launches || null,
  backtest: prevStudy.backtest || null,
  seatYield: prevStudy.seatYield || null,
};
fs.writeFileSync(path.join(OUT, 'study.json'), JSON.stringify(study, null, 2));
const kb = (f) => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0);
console.log(`done: seats.json ${kb('seats.json')} KB, study.json ${kb('study.json')} KB, ${seats.length} seats, ${ownerList.length} owners`);
