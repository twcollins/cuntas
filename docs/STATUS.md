# Cúntas: where we are

As of 2026-10-26. This file records the state of the build and the design. `docs/SPEC.md` stays the source of truth for rules and acceptance criteria; `docs/design/` holds snapshots of the design documents. For how the code fits together, read [ARCHITECTURE.md](ARCHITECTURE.md).

## Design documents

| File | What it is | Original |
| --- | --- | --- |
| [design/original-spec.md](design/original-spec.md) | The original IE/UK app spec (22 Oct 2026) | https://claude.ai/artifact/245bx7WUF7rpZY7dtPJiK8 |
| [design/design-and-working-doc.md](design/design-and-working-doc.md) | Design decisions, phases, backlog and decision log | https://claude.ai/artifact/SJ8AdQhQtPuiWSx67MDeQU |
| [design/website-brief.md](design/website-brief.md) | Brief for the marketing website | https://claude.ai/artifact/Rm7JtbC2Fzzt7JfibHG1nc |
| [design/ux-review.md](design/ux-review.md) | UX review of getting money in (manual entry, spending estimate, import, categorising) with a phased design (2026-10-25) | Repo only |
| [design/mobile-apps.md](design/mobile-apps.md) | iOS and Android apps: architecture, storage, files, app lock, notifications, sign-in, store submission, phases (2026-10-25) | Repo only |

The snapshots were exported on 2026-10-25. Date and mention chips became plain text, and the household-switcher diagram in the working doc is a placeholder. The website brief predates US support: its "USA planned" lines are out of date.

## What is built

| Area | State |
| --- | --- |
| v0.1 (phases 0 to 2) | IE and UK rules, engine, importers, ledger, providers, db, API, worker, web PWA |
| v0.2 | Features, households redesign, Guide, AIB import fix |
| Iteration 1 | Several households per device, Account & sync screen, Guide page, theme toggle in Settings |
| USA phase 1 | Country and currency as open sets, FX via EUR, rule files with a schema, Tax rules screen, check prompts |
| USA phase 2 | Federal tax 2026 (payroll, FICA, self-employment, child tax credit), retirement and HSA limits, quarterly estimated tax, r/personalfinance ladder, 10 US bank CSV presets, en-US wording, IE–US and UK–US what-if |
| USA phase 3 | All 50 states and D.C. have provisional 2026 packs with sources and golden tests. Local income taxes are out at launch, except Indiana's 92 county taxes |
| Guide | Covers US households, state packs and Indiana counties |
| UX phase 3 | Rough monthly spending estimate stands in for transactions until two months exist; fund targets use essential spending while no pay is recorded; first budget from the estimate |
| UX phase 2 | Quick add from any page (spent, received, moved, every month → bill), Cash wallet with untracked balance, hand-entered rows merged on import and deletable |
| UX phase 1 | Onboarding creates the first person with their residence; account countries follow currency; USD kept in OFX/CAMT/bank sync; Irish-only options and text hidden from others; empty chart states; sidebar trimmed with a More section |

Checks on 2026-10-26: 425 Vitest tests and 33 Playwright tests pass (3 skipped); lint and typecheck clean.

## Rule packs

- UK 2026-27 verified. IE 2026, IE 2027, UK 2027-28, Scotland, US federal 2026 and all 51 state packs are provisional.
- The user checks US figures each year and loads new ones from a file (Settings → Tax rules).
- US figures to check: California (2025 figures until late December), D.C. and Vermont deductions (2025), Kansas (statute only), Kansas and Oregon married-filing-separately amounts (half of joint, inferred), Missouri's federal tax deduction for 2026, Arizona rate, Idaho zero band, Utah draft credit figures, Virginia poverty guidelines, Boone County (IN) 2026 rate.

## Not modelled yet

- State earned income credits (needs the federal EITC).
- Child credits that depend on a child's age.
- Property-tax and renter credits that need household-income tables.
- Pension and Social Security subtractions.
- Local income taxes outside Indiana.

## Next

**Pick up here (2026-10-26):** UX phase 4, as designed in [design/ux-review.md](design/ux-review.md) §3 "Import that finishes the job": several files at once, drop anywhere, account matching, remembered mappings, a result screen, and the 60-day tracking rule. Items carried forward from phases 1 to 3, all listed under "Progress" in the review:
- The setup checklist (phase 6) should ask for date of birth (a placeholder until edited), pay and state.
- It should also offer the spending estimate where step 0 now offers only import.
- The phone's floating + button moves to the centre of the bottom tab bar when that is built.

1. UX phases 4-6 in [design/ux-review.md](design/ux-review.md): import that finishes the job, review queue, setup checklist. Phases 1 to 3 are done.
2. iOS and Android apps, phases 1-6 in [design/mobile-apps.md](design/mobile-apps.md); the US store launch follows phase 6.
3. USA phase 4: Social Security estimate, Roth notes, US–IE and US–UK cross-border cases (FBAR, FATCA, PFIC).
4. Verify provisional packs (P0 in the backlog).
5. Update the website brief for US support.
