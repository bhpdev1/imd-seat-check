const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const COLLECTION = "0x0000ec93127baa929e58e97dd0095a2bfb38ec1d";
const fmt = (n) => Number(n || 0).toLocaleString("en-US");
const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const shortAddr = (a) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || "–");

let snap = null;
let study = null;
let liveSwarm = null;
let refTime = Date.now();
let currentSeatId = 923;
let lang = "en";

// Directory state
let dirFilter = "all";
let dirSearch = "";
let dirSort = "accepted-desc";
let dirPage = 0;
const DIR_PAGE_SIZE = 50;

// Bilingual UI dictionary (EN / FR)
const I18N = {
  en: {
    heroTitle: "Inspect an IMD seat before you bid.",
    heroLede:
      'OpenSea listings near <strong>1.45 ETH</strong> show the SVG art, not whether the seat’s daemon is online, whether it sits <strong>one bad contract result away from 24h probation</strong>, or that <strong>all past token rewards stay locked to the seller’s wallet</strong>.',
    secInspector: "01 // Seat Inspection Slip",
    secDirectory: "02 // All 2,000 Seats Directory",
    secStudy: "03 // Empirical Token Launch Study (338 Mainnet Launches)",
    secEcon: "04 // Seat Economics & What Transfers on Sale",
    secFeed: "05 // Live Swarm Activity Stream (api.imd.fun/swarm)",
    inspectBtn: "Inspect →",
  },
  fr: {
    heroTitle: "Inspectez un siège IMD avant d'enchérir.",
    heroLede:
      "Les annonces OpenSea (~<strong>1.45 ETH</strong>) montrent uniquement le visuel SVG : elles cachent si le daemon est en ligne, si le siège est à <strong>1 erreur de 24h de probation</strong>, et que <strong>toutes les récompenses passées restent sur le wallet du vendeur</strong>.",
    secInspector: "01 // Fiche d'Audit Technique du Siège",
    secDirectory: "02 // Annuaire Interactif des 2 000 Sièges",
    secStudy: "03 // Étude Empirique des 338 Lancements Mainnet",
    secEcon: "04 // Économie d'un Siège & Ce Qui Est Transféré",
    secFeed: "05 // Flux d'Activité Swarm en Temps Réel (api.imd.fun/swarm)",
    inspectBtn: "Inspecter →",
  },
};

function ago(iso) {
  if (!iso) return lang === "fr" ? "jamais" : "never";
  const ms = refTime - Date.parse(iso);
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return lang === "fr" ? "à l'instant" : "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function verdict(s) {
  if (!s.en && !s.on && !s.a) {
    return {
      v: "idle",
      label: "IDLE",
      why:
        lang === "fr"
          ? "Aucun worker configuré sur ce siège : il ne touche ni les 8% de présence ni les 2% de travail tant que l'acheteur ne déploie pas de daemon."
          : "No worker daemon has been set up for this seat. It earns 0% until the new holder configures and connects a worker.",
    };
  }
  if (s.pu && Date.parse(s.pu) > refTime) {
    const untilStr = new Date(s.pu).toISOString().slice(0, 16).replace("T", " ") + " UTC";
    return {
      v: "probation",
      label: "PROBATION",
      why:
        lang === "fr"
          ? `En probation active jusqu'au ${untilStr}. Relégué en fin de file d'attente pour les contrats (cette pénalité est transférée avec le NFT).`
          : `Active probation until ${untilStr}. Placed last in line for contract dispatch — this penalty transfers with the seat NFT.`,
    };
  }
  const recentBad = (s.r.match(/b/g) || []).length;
  if (!s.on) {
    return {
      v: "watch",
      label: "WATCH",
      why:
        lang === "fr"
          ? "Inscrit mais actuellement hors-ligne. Un siège hors-ligne rate sa part des 8% sur chaque nouveau lancement de token."
          : "Enrolled in the swarm, but the worker daemon is currently offline. Offline seats miss the 8% presence drop on every launch.",
    };
  }
  if (recentBad >= 1 || s.cf > 0 || s.pz) {
    return {
      v: "watch",
      label: "WATCH",
      why:
        recentBad >= 1
          ? lang === "fr"
            ? `Attention : ${recentBad} résultat 'bad' dans la fenêtre des 3 derniers contrats ([${s.r.split("").join(", ")}]). Une seule erreur supplémentaire déclenche 24h de probation.`
            : `Elevated risk: ${recentBad} 'bad' outcome in the last 3 contract jobs. One more bad result triggers a 24-hour probation.`
          : lang === "fr"
          ? "Échecs consécutifs récents ou pause manuelle enregistrée sur ce siège."
          : "Recent consecutive failures or owner pause on record.",
    };
  }
  return {
    v: "clear",
    label: "CLEAR",
    why:
      lang === "fr"
        ? "Worker en ligne, éligible aux contrats, aucun résultat négatif dans la fenêtre récente."
        : "Worker daemon is online, eligible for contract dispatch, with zero bad outcomes in the recent window.",
  };
}

function getOwnerTuple(s) {
  if (s.liveOwner) {
    return [s.liveOwner, s.liveOwnerCount || 1];
  }
  return snap.owners[s.o] || ["0x0000000000000000000000000000000000000000", 1];
}

// Merge live CORS data from https://api.imd.fun/swarm onto our 2,000-seat array
function applyLiveSwarm(swarmData) {
  if (!swarmData || !snap) return;
  liveSwarm = swarmData;
  refTime = swarmData.at || Date.now();

  // Recompute live owner counts if owners array (2000 addresses) is present
  if (Array.isArray(swarmData.owners) && swarmData.owners.length === 2000) {
    const counts = new Map();
    for (const addr of swarmData.owners) {
      const a = (addr || "").toLowerCase();
      if (a) counts.set(a, (counts.get(a) || 0) + 1);
    }
    for (const s of snap.seats) {
      const a = (swarmData.owners[s.id] || "").toLowerCase();
      if (a) {
        s.liveOwner = a;
        s.liveOwnerCount = counts.get(a) || 1;
      }
    }
  }

  // Overlay live seat telemetry (attempts, accepted, working, pending, last)
  if (swarmData.seats && typeof swarmData.seats === "object") {
    for (const s of snap.seats) {
      const ls = swarmData.seats[String(s.id)];
      if (ls) {
        s.agentId = ls.agentId || s.agentId;
        s.a = Math.max(s.a, ls.attempts ?? 0);
        s.ok = Math.max(s.ok, ls.accepted ?? 0);
        s.rj = Math.max(s.rj, ls.rejected ?? 0);
        s.fl = Math.max(s.fl, ls.failed ?? 0);
        s.pending = ls.pending ?? 0;
        s.working = Boolean(ls.working);
        s.queued = ls.queued ?? 0;
        if (ls.last) s.lw = ls.last;
        if (ls.working || ls.queued > 0) s.on = 1;
      }
    }
  }

  // Update header live badge & footer status
  const online = swarmData.health?.agentsOnline ?? study?.network?.online ?? 1024;
  const working = swarmData.health?.workingNow ?? 0;
  const jobs = swarmData.counts?.jobs ?? study?.network?.jobsCompleted ?? 14058;
  const launches = swarmData.counts?.launchesLive ?? study?.network?.launchesLive ?? 647;

  $("live-badge-text").textContent = `LIVE · ${fmt(online)} ONLINE · ${working} WORKING`;
  $("btn-live-sync").classList.remove("is-offline");
  $("foot-online-text").textContent = `${fmt(online)} online · ${working} working now`;
  $("foot-jobs-text").textContent = `${fmt(jobs)} jobs · ${fmt(launches)} launches`;
  $("asof").textContent = `LIVE OVERLAY (${new Date(refTime).toISOString().slice(11, 19)} UTC) + 2,000-SEAT STANDING`;

  renderKpis();
  renderFeed();
  renderFilterCounts();
  renderDirectory();
  renderInspector(currentSeatId, false);
}

async function syncLiveSwarm() {
  try {
    $("live-badge-text").textContent = "SYNCING…";
    const r = await fetch("https://api.imd.fun/swarm", { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    applyLiveSwarm(data);
  } catch {
    $("btn-live-sync").classList.add("is-offline");
    $("live-badge-text").textContent = "SNAPSHOT MODE";
  }
}

function renderKpis() {
  const n = study?.network || {};
  const online = liveSwarm?.health?.agentsOnline ?? n.online ?? 1024;
  const working = liveSwarm?.health?.workingNow ?? 0;
  const enrolled = liveSwarm?.health?.seatsEnrolled ?? n.enrolled ?? 1049;
  const idleCount = snap.seats.filter((s) => verdict(s).v === "idle").length;
  const riskCount = snap.seats.filter((s) => {
    const v = verdict(s).v;
    return v === "probation" || v === "watch";
  }).length;
  const clearCount = snap.seats.filter((s) => verdict(s).v === "clear").length;

  const cells = [
    ["ONLINE DAEMONS", fmt(online), `${working} executing a job right now`],
    ["CLEAR SEATS", fmt(clearCount), `of ${fmt(enrolled)} enrolled workers`],
    ["WATCH / PROBATION", fmt(riskCount), "offline, recent bad, or on probation"],
    ["IDLE / NEVER SET UP", fmt(idleCount), "earn $0 until buyer runs a worker"],
    ["UNIQUE HOLDERS", fmt(n.holders || snap.owners.length), `${fmt(liveSwarm?.counts?.launchesLive || n.launchesLive)} total swarm launches`],
  ];

  $("kpi-strip").innerHTML = cells
    .map(
      ([label, fig, sub]) => `
      <div class="kpi-cell">
        <span class="kpi-label"><span>${label}</span></span>
        <div class="kpi-fig">${fig}</div>
        <span class="kpi-sub">${sub}</span>
      </div>`
    )
    .join("");
}

function auditRow(mark, label, mainHtml, subHtml = "") {
  const sym = { ok: "✓", warn: "!", bad: "✕", na: "–" }[mark] || "–";
  return `
    <li class="audit-row">
      <span class="mark-box ${mark}" aria-hidden="true">${sym}</span>
      <span class="audit-label">${label}</span>
      <div class="audit-val">
        <span>${mainHtml}</span>
        ${subHtml ? `<small>${subHtml}</small>` : ""}
      </div>
    </li>`;
}

async function fetchOwnerLiveEarned(owner, seatId) {
  const el = $("owner-earned-live");
  if (!el || !owner) return;
  el.textContent = "Querying explorer.imd.fun/api/earned…";
  try {
    const r = await fetch(`https://explorer.imd.fun/api/earned?wallet=${owner}`);
    if (!r.ok) throw new Error("earned fetch failed");
    const d = await r.json();
    if (currentSeatId !== seatId) return;
    const claimableCount = Array.isArray(d.claimable) ? d.claimable.length : 0;
    const unlocksCount = Array.isArray(d.unlocks) ? d.unlocks.length : 0;
    el.innerHTML = `
      <div><strong>Live Wallet Drops (CORS):</strong> ${claimableCount} claimable token drops · ${unlocksCount} unlocking</div>
      <div style="color:var(--faint)">Note: Claimable drops above belong to <code>${shortAddr(owner)}</code> and <strong>do not transfer</strong> if you buy Seat #${seatId}.</div>
    `;
  } catch {
    if (currentSeatId !== seatId) return;
    el.innerHTML = `<div style="color:var(--faint)">Rewards allocated to <code>${shortAddr(owner)}</code> remain on their wallet after any NFT sale.</div>`;
  }
}

function renderInspector(id, updateHash = true) {
  const s = snap.seats.find((x) => x.id === id);
  if (!s) {
    $("audit-card").innerHTML = `
      <div class="audit-head">
        <div>
          <div class="audit-kicker">INVALID SEAT NUMBER</div>
          <h3 class="audit-title">Seat #${esc(id)} not found</h3>
        </div>
      </div>
      <div class="audit-summary-banner">Identity.md has 2,000 seats numbered <strong>#0 to #1999</strong>. Enter a valid seat number or paste a 0x holder wallet address.</div>`;
    return;
  }

  currentSeatId = s.id;
  $("seat-input").value = String(s.id);
  if (updateHash) history.replaceState(null, "", `#${s.id}`);

  const [owner, ownerSeatsCount] = getOwnerTuple(s);
  const v = verdict(s);
  const judged = s.ok + s.rj + s.fl;
  const rate = judged ? s.ok / judged : null;
  const recentBad = (s.r.match(/b/g) || []).length;

  $("inspector-meta").textContent = `SEAT #${s.id} · VERDICT: ${v.label} · HELD BY ${shortAddr(owner).toUpperCase()}`;

  // Update Left Column: IMD .wallet-card
  $("card-seat-title").innerHTML = `
    <span>IMD #${s.id}</span>
    <span class="wallet-card-links">
      <a href="https://opensea.io/item/ethereum/${COLLECTION}/${s.id}" target="_blank" rel="noreferrer">OpenSea ↗</a>
      <a href="https://explorer.imd.fun/agents/${s.id}" target="_blank" rel="noreferrer">Explorer ↗</a>
    </span>`;

  const stateEl = $("card-seat-state");
  if (s.working) {
    stateEl.className = "wallet-state is-working";
    stateEl.innerHTML = `<i></i>working now`;
  } else if (v.v === "probation") {
    stateEl.className = "wallet-state is-probation";
    stateEl.innerHTML = `<i></i>probation`;
  } else if (s.on) {
    stateEl.className = "wallet-state is-online";
    stateEl.innerHTML = `<i></i>online`;
  } else if (s.en) {
    stateEl.className = "wallet-state is-watch";
    stateEl.innerHTML = `<i></i>offline`;
  } else {
    stateEl.className = "wallet-state";
    stateEl.innerHTML = `<i></i>idle`;
  }

  const imgEl = $("card-seat-img");
  const targetSrc = `https://api.imd.fun/agents/by-token/${s.id}.svg`;
  if (imgEl.getAttribute("src") !== targetSrc) {
    imgEl.setAttribute("src", targetSrc);
  }

  // Update Holder Wallet Portfolio Box
  const walletLink = $("owner-wallet-link");
  walletLink.textContent = shortAddr(owner);
  walletLink.href = `https://explorer.imd.fun/wallets/${owner}`;
  walletLink.title = owner;

  const sameOwnerSeats = snap.seats.filter((x) => getOwnerTuple(x)[0] === owner);
  const onlineInWallet = sameOwnerSeats.filter((x) => x.on).length;
  $("owner-seats-summary").innerHTML = `Holds <strong>${sameOwnerSeats.length} seat${sameOwnerSeats.length > 1 ? "s" : ""}</strong> (${onlineInWallet} online now). Click to inspect:`;

  $("owner-seats-list").innerHTML = sameOwnerSeats
    .map(
      (x) =>
        `<button type="button" class="seat-mini-chip ${x.id === s.id ? "is-active" : ""}" data-inspect="${x.id}">#${x.id}</button>`
    )
    .join("");

  $("owner-seats-list")
    .querySelectorAll("[data-inspect]")
    .forEach((btn) => {
      btn.addEventListener("click", () => renderInspector(Number(btn.dataset.inspect)));
    });

  fetchOwnerLiveEarned(owner, s.id);

  // Build Recent 3 Contract Outcomes Pills
  const recentHtml = s.r
    ? `<span class="outcome-pills">${s.r
        .split("")
        .map((c) => `<span class="outcome-pill ${c === "g" ? "good" : "bad"}">${c === "g" ? "GOOD" : "BAD"}</span>`)
        .join("")}</span>`
    : `<span style="color:var(--faint)">No recent contract jobs</span>`;

  // Build 6-Point Technical Checklist
  const rowsHtml = [
    s.on
      ? auditRow(
          "ok",
          "01 · Worker Daemon",
          `<strong>${s.working ? "WORKING RIGHT NOW" : "ONLINE"}</strong> · ${esc(s.m || "connected runtime")}`,
          `${s.t || 0} tools registered${s.queued ? ` · ${s.queued} queued` : ""}`
        )
      : auditRow(
          s.en ? "bad" : "na",
          "01 · Worker Daemon",
          s.en ? "<strong>OFFLINE</strong> (Enrolled but disconnected)" : "<strong>NEVER CONFIGURED</strong> (No daemon)",
          s.en ? "Misses 8% launch drops while offline" : "Requires setup after purchase"
        ),

    s.a
      ? auditRow(
          rate >= 0.95 ? "ok" : rate >= 0.85 ? "warn" : "bad",
          "02 · Work Record",
          `<strong>${fmt(s.ok)} accepted</strong> / ${fmt(s.a)} attempts (${rate != null ? pct(rate, 1) : "–"})`,
          `${fmt(s.rj)} rejected · ${fmt(s.fl)} failed${s.pending ? ` · ${s.pending} pending` : ""}`
        )
      : auditRow("na", "02 · Work Record", "0 submissions on record", "Never completed a swarm step"),

    s.en
      ? auditRow(
          s.q && !s.pz && s.cf === 0 ? "ok" : "warn",
          "03 · Contract Standing",
          s.q ? "<strong>QUALIFIES</strong> for contract work" : "<strong>DOES NOT QUALIFY</strong> (missing requirement)",
          `Consecutive failures: ${s.cf || 0}${s.pz ? " · PAUSED" : ""}`
        )
      : auditRow("na", "03 · Contract Standing", "Not enrolled in contract dispatch", "–"),

    s.en
      ? auditRow(
          recentBad === 0 ? "ok" : recentBad === 1 ? "warn" : "bad",
          "04 · 30d Contract Window",
          recentHtml,
          `30d tally: ${s.g} good · ${s.b} bad (${recentBad === 1 ? "1 bad away from probation!" : "2/3 bad triggers probation"})`
        )
      : auditRow("na", "04 · 30d Contract Window", "–", "No contract history"),

    s.pu && Date.parse(s.pu) > refTime
      ? auditRow(
          "bad",
          "05 · Probation Status",
          `<strong>ON PROBATION UNTIL ${new Date(s.pu).toISOString().slice(0, 16).replace("T", " ")} UTC</strong>`,
          `${s.pn} total probations on record (penalty transfers with NFT)`
        )
      : auditRow(
          s.pn > 0 ? "warn" : s.en ? "ok" : "na",
          "05 · Probation Status",
          s.pn > 0 ? `Clear now · <strong>${s.pn} past probation${s.pn > 1 ? "s" : ""}</strong>` : s.en ? "<strong>NEVER ON PROBATION</strong> (0 record)" : "–",
          "Doubles 24h → 48h → 96h → 7d on repeat"
        ),

    auditRow(
      "warn",
      "06 · Past Rewards Rule",
      `Locked to seller wallet <code>${shortAddr(owner)}</code>`,
      "Buyer receives seat standing + future drops only"
    ),
  ].join("");

  $("audit-card").innerHTML = `
    <div class="audit-head">
      <div>
        <div class="audit-kicker">PRE-PURCHASE INSPECTION SLIP · IDENTITY.MD</div>
        <div class="audit-title-row">
          <h3 class="audit-title">Seat #${s.id}</h3>
          <span class="audit-agent-id">${s.agentId ? `AGENT #${esc(s.agentId)} · ` : ""}LAST WORK: ${esc(ago(s.lw)).toUpperCase()}</span>
        </div>
      </div>
      <div class="verdict-badge">
        <div class="stamp" data-v="${v.v}">${v.label}</div>
      </div>
    </div>
    <div class="audit-summary-banner">
      <strong>Verdict — ${v.label}:</strong> ${esc(v.why)}
    </div>
    <ul class="audit-checks">${rowsHtml}</ul>
    <div class="audit-foot">
      <a href="https://opensea.io/item/ethereum/${COLLECTION}/${s.id}" target="_blank" rel="noreferrer">
        <span>Bid / View on OpenSea</span><span>↗</span>
      </a>
      <a href="https://explorer.imd.fun/agents/${s.id}" target="_blank" rel="noreferrer">
        <span>Live IMD Agent Record</span><span>↗</span>
      </a>
      <a href="https://explorer.imd.fun/wallets/${owner}" target="_blank" rel="noreferrer">
        <span>Seller Wallet (${ownerSeatsCount} seat${ownerSeatsCount > 1 ? "s" : ""})</span><span>↗</span>
      </a>
    </div>
  `;

  // Highlight selected row in directory if visible
  document.querySelectorAll("#dir-tbody tr").forEach((tr) => {
    tr.classList.toggle("is-selected", Number(tr.dataset.id) === s.id);
  });
}

function handleLookupInput(raw) {
  const q = String(raw || "").trim().toLowerCase();
  if (!q) return;

  // Check if user pasted a 0x wallet address
  if (q.startsWith("0x") && q.length >= 6) {
    const match = snap.seats.find((s) => getOwnerTuple(s)[0].includes(q));
    if (match) {
      renderInspector(match.id);
      return;
    }
  }

  const num = Number(q.replace(/^#/, ""));
  if (Number.isInteger(num) && num >= 0 && num <= 1999) {
    renderInspector(num);
  } else {
    renderInspector(-1);
  }
}

// ============================================================================
// All 2,000 Seats Interactive Directory
// ============================================================================

function renderFilterCounts() {
  if (!snap) return;
  const counts = { all: snap.seats.length, clear: 0, working: 0, watch: 0, probation: 0, idle: 0 };
  for (const s of snap.seats) {
    const v = verdict(s).v;
    counts[v] = (counts[v] || 0) + 1;
    if (s.working) counts.working++;
  }
  const labels = {
    all: `All (${fmt(counts.all)})`,
    clear: `Clear (${fmt(counts.clear)})`,
    working: `Working Now (${fmt(counts.working)})`,
    watch: `Watch (${fmt(counts.watch)})`,
    probation: `Probation (${fmt(counts.probation)})`,
    idle: `Idle (${fmt(counts.idle)})`,
  };
  document.querySelectorAll("#dir-filters [data-filter]").forEach((btn) => {
    const k = btn.dataset.filter;
    if (labels[k]) btn.textContent = labels[k];
  });
}

function getFilteredSeats() {
  if (!snap) return [];
  const q = dirSearch.trim().toLowerCase();

  const filtered = snap.seats.filter((s) => {
    const v = verdict(s).v;
    if (dirFilter === "working" && !s.working) return false;
    if (dirFilter !== "all" && dirFilter !== "working" && v !== dirFilter) return false;

    if (!q) return true;
    const [owner] = getOwnerTuple(s);
    if (String(s.id) === q.replace(/^#/, "") || `#${s.id}`.includes(q)) return true;
    if (owner.includes(q)) return true;
    if ((s.m || "").toLowerCase().includes(q)) return true;
    return false;
  });

  filtered.sort((a, b) => {
    if (dirSort === "id-asc") return a.id - b.id;
    if (dirSort === "accepted-desc") return b.ok - a.ok || a.id - b.id;
    if (dirSort === "rate-desc") {
      const ra = a.ok + a.rj + a.fl >= 5 ? a.ok / (a.ok + a.rj + a.fl) : -1;
      const rb = b.ok + b.rj + b.fl >= 5 ? b.ok / (b.ok + b.rj + b.fl) : -1;
      return rb - ra || b.ok - a.ok;
    }
    if (dirSort === "recent-desc") {
      const ta = a.lw ? Date.parse(a.lw) : 0;
      const tb = b.lw ? Date.parse(b.lw) : 0;
      return tb - ta;
    }
    if (dirSort === "probation-desc") {
      const pa = (a.pu && Date.parse(a.pu) > refTime ? 1000 : 0) + (a.r.match(/b/g) || []).length * 100 + a.pn * 10;
      const pb = (b.pu && Date.parse(b.pu) > refTime ? 1000 : 0) + (b.r.match(/b/g) || []).length * 100 + b.pn * 10;
      return pb - pa || b.ok - a.ok;
    }
    return a.id - b.id;
  });

  return filtered;
}

function renderDirectory() {
  const list = getFilteredSeats();
  const total = list.length;
  const maxPage = Math.max(0, Math.ceil(total / DIR_PAGE_SIZE) - 1);
  if (dirPage > maxPage) dirPage = maxPage;

  const start = dirPage * DIR_PAGE_SIZE;
  const slice = list.slice(start, start + DIR_PAGE_SIZE);

  $("dir-count-meta").textContent = `${fmt(total)} MATCHING SEATS`;
  $("dir-page-info").textContent = total
    ? `Showing ${fmt(start + 1)}–${fmt(start + slice.length)} of ${fmt(total)} seats (click any row to inspect)`
    : "No seats match filter";
  $("dir-prev").disabled = dirPage <= 0;
  $("dir-next").disabled = dirPage >= maxPage;

  $("dir-tbody").innerHTML = slice
    .map((s) => {
      const v = verdict(s);
      const [owner, ownerCount] = getOwnerTuple(s);
      const judged = s.ok + s.rj + s.fl;
      const rateStr = judged ? pct(s.ok / judged, 1) : "–";
      const daemonHtml = s.working
        ? `<span style="color:var(--cyan);font-weight:600">● working</span>`
        : s.on
        ? `<span style="color:var(--ok)">● online</span>`
        : s.en
        ? `<span style="color:var(--caution)">○ offline</span>`
        : `<span style="color:var(--faint)">– idle</span>`;

      const recentStr = s.r
        ? s.r
            .split("")
            .map((c) =>
              c === "g"
                ? `<span style="color:var(--ok);font-weight:600">G</span>`
                : `<span style="color:var(--alarm);font-weight:700">B</span>`
            )
            .join("·")
        : "–";

      const probStr =
        s.pu && Date.parse(s.pu) > refTime
          ? `<span style="color:var(--alarm);font-weight:700">ACTIVE (${s.pn})</span>`
          : s.pn > 0
          ? `<span style="color:var(--caution)">${s.pn} past</span>`
          : "0";

      return `
        <tr data-id="${s.id}" class="${s.id === currentSeatId ? "is-selected" : ""}">
          <td><strong>#${s.id}</strong></td>
          <td><span class="mini-tag ${v.v}">${v.label}</span></td>
          <td>${daemonHtml}</td>
          <td>${esc(s.m || "–")}${s.t ? ` <span style="color:var(--faint)">(${s.t}t)</span>` : ""}</td>
          <td><strong>${fmt(s.ok)}</strong> <span style="color:var(--faint)">/ ${fmt(s.a)}</span></td>
          <td>${rateStr}</td>
          <td>${s.g}g/${s.b}b [${recentStr}]</td>
          <td>${probStr}</td>
          <td style="color:var(--dim)">${esc(ago(s.lw))}</td>
          <td><code>${shortAddr(owner)}</code> <span style="color:var(--faint)">(${ownerCount})</span></td>
        </tr>`;
    })
    .join("");

  document.querySelectorAll("#dir-tbody tr").forEach((tr) => {
    tr.addEventListener("click", () => {
      const id = Number(tr.dataset.id);
      renderInspector(id);
      $("inspector").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

// ============================================================================
// Study & Live Swarm Feed Rendering
// ============================================================================

function renderStudy() {
  if (!study) return;
  const L = study.launches;
  if (L) {
    $("f1-big").innerHTML = `${L.bucketsPct.notTraded}%<small>of ${fmt(L.mainnetTokens)} mainnet launches had 0 trades</small>`;
    $("f1-text").innerHTML = `Across all <strong>${fmt(
      L.mainnetTokens
    )}</strong> tokens launched on Ethereum mainnet, <strong>${fmt(
      L.buckets.notTraded
    )} (${L.bucketsPct.notTraded}%)</strong> never recorded a single trade. Only <strong>${
      L.volOver1kPct
    }%</strong> generated over $1,000 in volume. Because launchers earn 1% of swap volume, ~96.7% of launches fail to recoup their 0.5 IMD admission fee.`;

    const rows = [
      ["Never traded", L.buckets.notTraded, true],
      ["Cap < $20k", L.buckets.capUnder1k + L.buckets.cap1kTo20k, false],
      ["$20k – $50k", L.buckets.cap20kTo50k, false],
      ["$50k – $100k", L.buckets.cap50kTo100k, false],
      ["Over $100k", L.buckets.capOver100k, false],
    ];
    $("viz-outcomes").innerHTML = rows
      .map(([label, n, muted]) => {
        const p = n / L.mainnetTokens;
        return `
          <div class="bar-row">
            <span>${label}</span>
            <span class="bar-track"><span class="bar-fill ${muted ? "muted" : ""}" style="width:${Math.max(
          p * 100,
          1
        )}%"></span></span>
            <span class="bar-pct">${(p * 100).toFixed(1)}%</span>
          </div>`;
      })
      .join("");
  }

  const B = study.backtest;
  if (B) {
    $("f2-big").innerHTML = `${B.medianNetReturn45Pct}%<small>median net return (${B.winRateNet}% win rate across ${B.backtested} traded tokens)</small>`;
    $("f2-text").innerHTML = `Replaying minute-by-minute GeckoTerminal candles on the ${
      B.backtested
    } tokens that actually traded (entry at minute 2, exit at minute 45, 2.5% round-trip pool fee): only <strong>${
      B.winRateNet
    }%</strong> of trades were profitable. The mean (${B.meanNetReturn45Pct}%) is skewed by two outliers; miss them and blind sniping bleeds capital.`;

    const trades = [...B.trades].sort((a, b) => b.net45 - a.net45);
    $("viz-backtest").innerHTML = trades
      .map(
        (t) => `
        <div class="trade-chip ${t.net45 >= 0 ? "up" : "down"}">
          <b>$${esc(t.symbol)}</b>
          <span>${t.net45 >= 0 ? "+" : ""}${(t.net45 * 100).toFixed(0)}%</span>
        </div>`
      )
      .join("");

    const u = B.unlockEffect;
    $("viz-unlock").innerHTML = `${u.droppedBetweenMin45And65} / ${u.sample}<small>launches where price fell across the minute-60 unlock</small>`;
    $("f3-text").innerHTML = `The 10% seat reward allocation (8% online + 2% builders) unlocks 60 minutes after launch. In 1-minute candle replays between minute 45 and minute 65, price dropped in only <strong>${u.droppedBetweenMin45And65} of ${u.sample}</strong> cases (41%). Front-running the unlock is not a statistical edge.`;
  }

  const Y = study.seatYield;
  if (Y) {
    const passUsd = Math.round(Y.passiveOnline.avgLiquidCashUsdPerSeat);
    const actUsd = Math.round(Y.activeOperators.avgLiquidCashUsdPerSeat);
    const topUsd = Math.round(Y.topGrinders.avgLiquidCashUsdPerSeat);
    const maxUsd = Math.max(topUsd, 1);

    const yRows = [
      [`Passive Online (~$${fmt(passUsd)})`, passUsd],
      [`Active Builder (~$${fmt(actUsd)})`, actUsd],
      [`Top Grinder (~$${fmt(topUsd)})`, topUsd],
    ];
    $("viz-yield-summary").innerHTML =
      `<div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);margin-bottom:4px">MEASURED 30D LIQUID YIELD PER SEAT (SINGLE-SEAT WALLETS)</div>` +
      yRows
        .map(
          ([label, val]) => `
        <div class="bar-row" style="grid-template-columns:155px minmax(0,1fr) 54px">
          <span>${label}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${Math.max((val / maxUsd) * 100, 3)}%"></span></span>
          <span class="bar-pct">$${fmt(val)}</span>
        </div>`
        )
        .join("");
  }
}

function renderFeed() {
  const events = liveSwarm?.events || [];
  if (!events.length) return;
  $("feed-meta").textContent = `LIVE STREAM · ${events.length} RECENT SWARM EVENTS`;
  $("live-feed-box").innerHTML = events
    .slice(0, 10)
    .map((ev) => {
      const stateClass = ev.state === "completed" ? "clear" : ev.state === "executing" ? "watch" : "idle";
      const cleanObj = String(ev.objective || "Swarm job")
        .split("\n")[0]
        .slice(0, 140);
      return `
        <div class="feed-item">
          <span><span class="mini-tag ${stateClass}">${esc(ev.state || ev.kind)}</span></span>
          <a class="feed-obj" href="https://explorer.imd.fun/jobs/${encodeURIComponent(ev.jobId || "")}" target="_blank" rel="noreferrer" style="text-decoration:none">
            ${esc(cleanObj)}
          </a>
          <span class="feed-time">${esc(ago(ev.at))}</span>
        </div>`;
    })
    .join("");
}

// ============================================================================
// Initialization & Event Listeners
// ============================================================================

function applyLanguage() {
  const dict = I18N[lang] || I18N.en;
  $("hero-title").textContent = dict.heroTitle;
  $("hero-lede").innerHTML = dict.heroLede;
  $("sec-inspector").textContent = dict.secInspector;
  $("sec-directory").textContent = dict.secDirectory;
  $("sec-study").textContent = dict.secStudy;
  $("sec-econ").textContent = dict.secEcon;
  $("sec-feed").textContent = dict.secFeed;
  $("btn-inspect").textContent = dict.inspectBtn;
  $("btn-lang").textContent = lang.toUpperCase();
  if (snap) renderInspector(currentSeatId, false);
}

async function init() {
  // 1. Load static 2,000-seat snapshot + empirical study
  try {
    [snap, study] = await Promise.all([
      fetch("./data/seats.json").then((r) => r.json()),
      fetch("./data/study.json").then((r) => r.json()),
    ]);
  } catch {
    $("audit-card").innerHTML = `<div class="audit-head"><p>Snapshot missing. Run <code>node build-data.mjs</code></p></div>`;
    return;
  }

  refTime = Date.parse(snap.generatedAt) || Date.now();
  $("asof").textContent = `SNAPSHOT ${new Date(refTime).toISOString().slice(0, 16).replace("T", " ")} UTC`;

  renderKpis();
  renderStudy();
  renderFilterCounts();

  const initialHash = Number(location.hash.replace(/^#/, ""));
  const startId =
    location.hash.length > 1 && Number.isInteger(initialHash) && initialHash >= 0 && initialHash <= 1999
      ? initialHash
      : 923;

  renderInspector(startId, false);
  renderDirectory();

  // 3. Connect to live CORS swarm endpoint (api.imd.fun/swarm) immediately & every 30s
  syncLiveSwarm();
  setInterval(syncLiveSwarm, 30000);
}

// Lookup form
$("lookup-form").addEventListener("submit", (e) => {
  e.preventDefault();
  handleLookupInput($("seat-input").value);
});

// Quick pick chips
document.querySelectorAll(".quick-chips .chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!snap) return;
    if (btn.dataset.seat) {
      renderInspector(Number(btn.dataset.seat));
      return;
    }
    const pickType = btn.dataset.pick;
    let pool = [];
    if (pickType === "working") {
      pool = snap.seats.filter((s) => s.working);
      if (!pool.length) pool = snap.seats.filter((s) => verdict(s).v === "clear");
    } else if (pickType === "probation") {
      pool = snap.seats.filter((s) => verdict(s).v === "probation");
      if (!pool.length) pool = snap.seats.filter((s) => s.pn > 0);
    } else if (pickType === "watch") {
      pool = snap.seats.filter((s) => verdict(s).v === "watch" && (s.r.match(/b/g) || []).length >= 1);
    } else {
      pool = snap.seats.filter((s) => verdict(s).v === "idle");
    }
    if (pool.length) {
      const picked = pool[Math.floor(Math.random() * pool.length)];
      renderInspector(picked.id);
    }
  });
});

// Directory filters, search, sort, pagination
document.querySelectorAll("#dir-filters [data-filter]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#dir-filters [data-filter]").forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    dirFilter = btn.dataset.filter;
    dirPage = 0;
    renderDirectory();
  });
});

$("dir-search").addEventListener("input", (e) => {
  dirSearch = e.target.value;
  dirPage = 0;
  renderDirectory();
});

$("dir-sort").addEventListener("change", (e) => {
  dirSort = e.target.value;
  dirPage = 0;
  renderDirectory();
});

$("dir-prev").addEventListener("click", () => {
  if (dirPage > 0) {
    dirPage--;
    renderDirectory();
  }
});

$("dir-next").addEventListener("click", () => {
  dirPage++;
  renderDirectory();
});

// Theme toggle (Dark / Light)
$("btn-theme").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("imd-theme", next);
  } catch {}
});

// Language toggle (EN / FR)
$("btn-lang").addEventListener("click", () => {
  lang = lang === "en" ? "fr" : "en";
  applyLanguage();
});

// Manual live sync
$("btn-live-sync").addEventListener("click", () => {
  syncLiveSwarm();
});

// Nav active pill highlight
document.querySelectorAll(".nav .sites [data-nav]").forEach((a) => {
  a.addEventListener("click", () => {
    document.querySelectorAll(".nav .sites [data-nav]").forEach((x) => x.classList.remove("is-here"));
    a.classList.add("is-here");
  });
});

init();
