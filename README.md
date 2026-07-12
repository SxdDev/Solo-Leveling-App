# Solo Leveling

Single-user, offline-first, iPhone-installed PWA. Tasks earn XP, XP drives a level, and an 11-axis radar shows what you're actually feeding. Built to the plan in `PLAN.md`; every deviation is listed below.

**85 tests, all passing.** `npm test` (and `npm run test:tz` to re-run the date math under `America/New_York`, where DST actually bites).

---

## Run it

```bash
npm install          # only the Netlify function has deps; the client has none
npm test             # 85 tests: xp, dates, stats, streaks, quests, store, UI, backup
npx netlify dev      # http://localhost:8888
```

Phases 0–5 work with no keys and no network. Only the AI reviewer (Phase 6) needs setup.

## Deploy

1. Push to a Git repo, connect it in Netlify. No build command — `netlify.toml` publishes `public/` as-is.
2. **Before the AI works**, set two env vars in Netlify → Site settings → Environment:
   - `ANTHROPIC_API_KEY` — a key used by **nothing else**.
   - `ALLOWED_ORIGIN` — `https://your-site.netlify.app,http://localhost:8888`
3. **Set a hard spend cap on that key in the Anthropic console. Do this before you deploy, not after.** The endpoint is public (R-3). The four defence layers cap the damage at pocket change; they do not eliminate it.
4. On iPhone: open in Safari → Share → **Add to Home Screen**. It must be installed, not a tab — installed PWAs are exempt from Safari's 7-day storage eviction rule.

## Ship one thing on day one

Open the You tab and hit **Export** once. It costs five seconds and it's the only thing standing between you and total loss if Safari evicts the origin. The app nags you every 14 days for the same reason.

---

## Corrections to the plan

Three places where the spec was internally inconsistent. I implemented what it *meant*, and flagged each one in the code where you'll trip over it.

**1. §5.3 — the saturation curve's calibration numbers are wrong.**
The formula `100 × (1 − e^(−P/900))` and the anchors beside it describe different curves. With the constant at 900, the real values are:

| stated in plan | actually |
|---|---|
| ~90 pts → 10 | ✅ ~95 pts → 10 |
| ~2,070 pts → 50 | ❌ that's **90**. 50 arrives at ~624. |
| ~4,140 pts → 75 | ❌ that's **99**. 75 arrives at ~1,248. |

The 50/75 anchors imply a constant of ~2,986, not 900. I shipped **900** — the formula is the decision, the parenthetical was commentary, and 900 is the one that matches the stated goal of "a year-plus to push past 80" (80 lands at ~1,448 points). But this is now the single number most worth tuning in Phase 2. It lives in one place: `SATURATION` in `game/stats.js`.

**2. §5.4 — a level-1 player could be handed an impossible quest.**
The difficulty window `[1, min(5, 1 + floor(level/8))]` evaluates to `[1,1]` at level 1 — and half the stat pools contain no difficulty-1 quest at all, so the first quest a new player ever sees fell straight through the cap. Changed the floor to 2 (`2 + floor(level/8)`), added a difficulty-2 Health quest so every pool can serve a beginner, and made the last-resort fallback pick a stat's *easiest* quest rather than a random one. Level 1 lasts about six hours anyway.

**3. §5.2 — stat points had the same exploit XP didn't.**
The plan applies the anti-grind decay to XP but defines stat points as `baseXP × weight ÷ 10` — no decay. So checking "drink water" ten times would earn 18 XP but pump the radar ten times over. The decay now applies to both. Tested.

## One decision you should look at

**Journal text does not go to the AI by default.** Q-2 left this open; I defaulted `sendJournalToAI` to **off**, so the daily review sees word count and mood but not what you wrote. There's a toggle in Settings that says plainly what flipping it costs ("that text leaves your phone"). Weekly and above never send journal text at all, regardless of the setting.

## Still open (from §10)

- **Q-1** Rollover is 04:00. Change it in Settings if that's wrong for your sleep.
- **Q-3** The 11 stat definitions in `game/stats.js` are **mine, not yours**. Rewrite them in your own words before Phase 2 or task-mapping goes mushy — that's the whole point of the exercise.
- **Q-5** The six starter habits (`STARTER_HABITS` in `store.js`) are placeholders. Edit them to your actual routine before you rely on day one.
- **R-1** The name. Fine on your own phone. Rename before you share a URL with anyone.

---

## What's here

| Phase | Status |
|---|---|
| 0 — Shell, DB, SW, install | ✅ |
| 1 — Today, XP core, **backup** | ✅ |
| 2 — Stats, radar, Potential | ✅ |
| 3 — Journal, streaks, freeze tokens | ✅ |
| 4 — Quests, reroll, reboot screen | ✅ |
| 5 — Growth, milestones, Hall of Records | ✅ |
| 6 — AI layer (needs your API key) | ✅ |
| 7 — Polish, push notifications (Q-4) | deferred |

**Fonts:** the plan called for self-hosted Space Grotesk + JetBrains Mono. I used the platform mono stack (`ui-monospace`/SF Mono) instead — nothing to download, nothing to cache, nothing to FOUT, and on an iPhone SF Mono is what those faces are imitating anyway. If you want the real thing, drop the woff2 subsets in `public/fonts/`, add the `@font-face` rules to `tokens.css`, and add the files to the `SHELL` array in `sw.js`.

## Layout

```
public/js/game/     pure functions, fully tested, no DOM imports — ever
public/js/store.js  the ONLY module that writes to the database
public/js/ui/       one module per tab, each exports render(root, ctx)
netlify/functions/  the AI proxy — the only server code in the repo
tests/              node:test. Run them before you touch game math.
```

The rule that keeps rebalancing safe: **all game math lives in `game/` as pure functions with unit tests.** If you change an XP constant, `npm test` tells you what you broke.

The rule that keeps history honest: **`completions` is append-only.** XP and stat points are frozen onto each row at completion time, so rebalancing `xp.js` in v1.2 can never silently rewrite your past. Un-checking a task tombstones it (`revoked: true`); nothing is ever deleted. Level, stats, and streaks are *derived* — `recomputeDerived()` replays the log and is the actual spec; `sl.derived` is only a cache of its output. There's a test that corrupts the cache and proves the log wins.

## R-4, which is the one that will actually get you

You are both the designer and the only player. When motivation dips, you will be tempted to bump the XP constants. That's the one change that destroys the game's meaning, and no test can catch it.

Rule: balance changes only via editing `xp.js` constants **plus a journal entry saying why**.
