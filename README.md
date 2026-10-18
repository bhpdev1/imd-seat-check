# IMD Seat Check

**Live Tool:** [https://bhpdev1.github.io/imd-seat-check/](https://bhpdev1.github.io/imd-seat-check/)

Read-only pre-bid inspection slip and network directory for the 2,000 **[identity.md](https://imd.fun)** seats (`0x0000ec93127baa929e58e97dd0095a2bfb38ec1d`).

---

## Purpose

Secondary-market marketplaces (OpenSea, Blur) display a seat's SVG artwork and token ID, but none of its operational state on the `identity.md` swarm.

**IMD Seat Check** was built as a lightweight community contribution to make onboarding and secondary-market inspection transparent for both prospective operators and the network:

1. **Operational Readiness for New Operators**: Shows whether a seat is already enrolled as an ERC-8004 agent, whether a worker daemon is currently connected, which runtime/model it advertises, and its lifetime accepted/rejected task record.
2. **Standing & Probation Visibility**: Surfaces the rolling 3-contract qualification window (`good` / `bad`), consecutive failure count, and any active probation timer (`24h` doubling up to `7d`) that travels with the token ID.
3. **Clear Reward vs. Standing Mechanics**: Clarifies how the protocol separates **wallet-bound rewards** (historical launch Merkle drops stay with the wallet that earned them) from **token-bound standing** (enrollment and contract dispatch priority follow the NFT).
4. **Full 2,000-Seat Directory & Launch Base-Rates**: Filterable directory across all 2,000 seats (`Clear`, `Working Now`, `Watch`, `Probation`, `Idle`) alongside empirical mainnet launch distribution metrics.

---

## How It Works

* **Live Swarm Overlay (`CORS`)**: Connects directly to `https://api.imd.fun/swarm` and `https://explorer.imd.fun/api/earned` in the browser to overlay real-time online daemons, active jobs, holder balances, and recent swarm events every 30 seconds.
* **Automated Standing Snapshot (`data/seats.json`)**: Because per-seat standing endpoints (`/seats/:id/standing`) are queried across all enrolled seats, a scheduled GitHub Action ([`.github/workflows/refresh-snapshot.yml`](.github/workflows/refresh-snapshot.yml)) refreshes the full 2,000-seat dataset every 6 hours.
* **Zero Dependencies & Zero Wallet Connection**: Pure static HTML, CSS, and vanilla ES modules following the native `identity.md` design system (`IBM Plex Mono`, dark/light theme, EN/FR toggle). No wallet prompts, no analytics, no third-party scripts.

---

## Updating the Snapshot Locally

Requires Node.js 22+:

```bash
node build-data.mjs
```

This fetches the latest swarm, owner, worker, and standing records from `https://api.imd.fun` and writes updated `data/seats.json` and `data/study.json` files.

---

## Links

* **Live App**: [https://bhpdev1.github.io/imd-seat-check/](https://bhpdev1.github.io/imd-seat-check/)
* **Identity.md**: [https://imd.fun](https://imd.fun) · [https://explorer.imd.fun](https://explorer.imd.fun)
* **Collection**: [`0x0000ec93127baa929e58e97dd0095a2bfb38ec1d`](https://opensea.io/collection/identity-md)
