# Rust Dojo

An Obsidian plugin that turns a curriculum note into a full day of Rust practice. For each day it asks Claude for a short concept refresher, 20 small `fn main()` exercises with one-click Rust Playground links, and 10 Anki flashcards (in the `START/Basic/END` format the [Obsidian_to_Anki](https://github.com/Pseudonium/Obsidian_to_Anki) plugin reads).

## Install

1. Build the plugin (see below) or copy the prebuilt files.
2. Copy `main.js`, `manifest.json`, and (if present) `styles.css` into your vault at:

   ```
   <your-vault>/.obsidian/plugins/rust-dojo/
   ```

3. In Obsidian, open **Settings → Community plugins**, refresh the installed list, and enable **Rust Dojo**.
4. Open the plugin's **Settings** tab and paste your Anthropic API key.

## Build from source

```bash
npm install
npm run build
```

`npm run dev` runs esbuild in watch mode.

## Usage

1. Run the command **Rust Dojo: Generate Daily Exercises** from the command palette.
2. On first run, `Rust Dojo/curriculum.md` is created with a 20-week beginner curriculum (100 days). All days start as `pending`.
3. Each run picks up the next `in-progress` day, or — if none — the first `pending` day. It generates 20 exercises, writes them to `Rust Dojo/Daily/YYYY-MM-DD.md`, and marks that day `in-progress` in the curriculum.
4. Work the exercises in the Rust Playground via the inline links. Check them off in the daily note as you go. When you finish a day, edit `curriculum.md` and change its status to `complete` (and optionally add a `notes:` line).

## Daily-notes widget

Add this fenced code block anywhere in a note — typically in your daily-notes template — to render an interactive practice widget:

````markdown
```rust-dojo
```
````

The widget shows:

- A `HH:MM:SS` stopwatch with **Start** / **Pause** / **Resume** and **Reset**.
- A compact two-column checklist of today's 20 exercises (number + short title + ▶ Playground link).
- Checkboxes are bound to the underlying `Rust Dojo/Daily/YYYY-MM-DD.md` note, so ticking one in the widget updates the source-of-truth file (and the `Progress: X / N` line) — and vice versa.

If today's daily note hasn't been generated yet, the widget shows a hint pointing to the **Rust Dojo: Generate Daily Exercises** command.

## Curriculum format

```markdown
# Rust Dojo Curriculum

current-project-week: 1
current-project-day: 3
current-project-theme: Bit Inspector — variables, types, formatting, bitwise operations

## Day 1
- topic: variables and mutability
- status: complete
- notes: struggled with shadowing

## Day 2
- topic: basic data types and type inference
- status: in-progress

## Day 3
- topic: functions and return values
- status: pending
```

Valid statuses: `pending`, `in-progress`, `complete`. The plugin only writes to the `status:` line when generating a day — your `topic:` and `notes:` lines are left alone, so you can freely edit the curriculum.

### Project context fields

The three `current-project-*:` lines at the top tell the generator what weekly project you're building so it can bias ~4 of the daily Anki cards toward project-relevant concepts.

- `current-project-week` — 1–20, the project arc maps to a 20-week curriculum baked into the plugin.
- `current-project-day` — 1–5, your day within that week's project.
- `current-project-theme` — short name plus the concepts the project touches.

If all three are missing, all 10 Anki cards focus on the daily topic only. The plugin reads these from `curriculum.md` first and falls back to the matching fields in the settings tab.

### Daily note structure

```markdown
# Rust Dojo — Day N: [Topic]

## Today's Concepts
[2–3 paragraphs refreshing today's Rust concepts]

---

## Exercises (0 / 20 complete)
- [ ] **Exercise 1: ...** — ... → [▶ Open in Playground](...)
...

---

## Anki Cards

START
Basic
Front: Why does Rust distinguish between String and &str?
Back: String owns its data on the heap; &str is a borrowed view...
Tags: rust-dojo day-01 strings ownership
END

...

---

## Notes
```

## Commands

- **Rust Dojo: Generate Daily Exercises** — runs the generator. Picks the next pending (or in-progress) day, calls Claude once, and writes the full daily note.
- **Rust Dojo: Advance Project Day** — increments the project day in `curriculum.md` (and settings). On day 6 it rolls over to week N+1 and swaps the theme to the next entry in the built-in 20-week project arc. Run this at the end of each project session.

## Settings

- **Anthropic API key** — stored in `data.json` inside the plugin folder, not in the vault.
- **Vault folder** — where the curriculum and daily notes live (default: `Rust Dojo`).
- **Auto-open generated note** — open the new daily note after generation (default: on).
- **Weekly Project Context** — fallback values for `current-project-week`, `current-project-day`, `current-project-theme` when `curriculum.md` doesn't set them. Editing these here also writes through to `curriculum.md` if it exists.

## Notes

- The plugin calls `https://api.anthropic.com/v1/messages` directly using Obsidian's network layer.
- The model is asked for raw JSON; output is parsed defensively (markdown fences are stripped if present).
- If generation fails, an Obsidian notice surfaces the error and nothing is written.
