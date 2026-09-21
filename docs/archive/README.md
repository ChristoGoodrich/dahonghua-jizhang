# Archived planning documents

These are historical planning and spec documents from the 2026-07 improvement
rounds. They are kept for the design rationale they record.

**Their checkboxes are not a status board.** Every box in every file is
unchecked, but most of the work described was implemented — see the git history
(`git log --oneline`) for what actually landed. Do not read an unchecked box
here as an open task.

Two more live here because they are rationale rather than instructions:

- `ui-framework-probes.md` — the Slint and Dioxus prototypes measured against
  the three things the UI could not do without, and why Flutter was chosen.
  It was `rust/proto/FINDINGS.md`; the prototypes are at the `rn-final` tag.
- `DATA_MODEL_assets.md` — how transfers, credit accounts and net worth relate.
  The file names in it are the React Native ones; the model is the one
  `core::networth` and `core::accounts` still implement.
