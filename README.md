# LToolkit

**English** · [简体中文](README.zh-CN.md)

A bundle of small editing, attachment, and appearance tweaks for [Obsidian](https://obsidian.md).

Every feature is a separate toggle in one settings tab. Seventeen of the twenty-four are on out of the box — everything under Editor and Attachments, plus five appearance tweaks. The rest, including anything tied to a specific theme, start off. Features that take parameters show them indented under their own switch.

<img src="docs/settings-en.svg" alt="The settings tab: one switch per feature, parameters indented underneath" width="720">

---

## Attachments

- **Attachment folder per note** — New attachments go into a folder that mirrors the note's own path, so `stocks/analysis.md` gets `assets/stocks/analysis/`. Works for paste, drag & drop and the built-in *Download attachments for current file*, because all of them funnel through one Vault method. Filenames are left alone; duplicates keep Obsidian's own ` 1`, ` 2` suffixes.
  <br>*Options:* attachment root · move the folder along when the note is renamed or moved (links are updated, emptied folders are pruned).

- **Unused attachment cleaner** — Lists attachments that no note or canvas references, with thumbnails and sizes, and deletes only the ones you leave ticked. Deletion goes through `fileManager.trashFile`, so it honours whatever you chose under *Files and links → Deleted files*.
  <br>Three layers of detection, biased toward keeping files: Obsidian's resolved links, canvas node files parsed separately (they don't always land in the link index), and a full-text sweep that catches HTML `<img src>`, frontmatter and templates. A bare filename only counts when it isn't preceded by `/`, so `assets/a/demo.gif` no longer protects an unrelated `assets/demo.gif`.
  <br>*Options:* folder to scan. *Also available as a command.*

## Editor

- **Progressive select** — Notion-style <kbd>Cmd/Ctrl</kbd>+<kbd>A</kbd>. First press selects the line's text without its leading markup — no list bullet, no heading hashes, no quote prefix. Second press takes the whole block: the paragraph, the list item including its children, the code block, the blockquote. Third press falls through to Obsidian's own select-all. Tables stop at one level and select the cell you're in. In Reading view it selects the rendered block under the caret.

- **Esc selects the block** — Esc switches from *typing inside a block* to *this block is selected*, the way it does in Notion. Passes through when an autocomplete, menu or modal is open, stays out of the way in Vim mode, and passes through again once the block is already selected.

- **Toggle task list** — The right-click *Paragraph → Task list* action as a bindable command. Flips the current line, or every selected line, between `- [ ] text` and a plain paragraph. Obsidian's built-in `editor:toggle-checklist-status` only ticks existing tasks; the two complement each other.

- **Insert line above / below** — Sublime's <kbd>Cmd</kbd>+<kbd>Enter</kbd> and <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd>: open a new line below or above the current one and move the caret there, wherever the caret happens to sit — the current line is never split. Obsidian has no equivalent command; `swap-line-up/down` moves a whole line rather than inserting one, and CodeMirror's `insertBlankLine` is shadowed by *Open link in new tab* on <kbd>Mod</kbd>+<kbd>Enter</kbd> and only ever inserts a bare line. Indentation, quote prefixes and list markers carry over (ordered lists take the next number, tasks come back unchecked, headings do not carry); inside a code block only the indentation does. Bind both commands yourself under Hotkeys.

- **Clear paragraph markers** — Strips heading hashes, list bullets, task checkboxes and indentation from the start of the current line or selection, leaving it a plain paragraph. Inline bold and code are untouched, which is where this differs from *Clear formatting*.

- **Convert to table** — Splits the current line, or the selected lines, on spaces and tabs into a Markdown table. The first row becomes the header; a single line is padded out to three rows. On an empty line it hands off to Obsidian's *Insert table*.

- **Line to note, and back** — Pulls the current line out into its own note in the same folder and leaves a link behind. Run it again on that link and it reverses: the note's content comes back inline and the note goes to the trash.

- **Remember scroll position** — Per-file scroll position, restored when you come back. Obsidian keeps that position on a *tab's navigation history* entry, so it only survives pressing Back — reopening the note from the file list starts at the top. Positions live in local storage keyed by vault, so sync plugins can't carry them between devices and overwrite each other.
  <br>*Options:* also restore the cursor and selection · restore delay for long notes.

- **No duplicate tabs** — When a file is already open in the same tab group, switch to that tab instead of opening a second copy. The tab you came from steps back to its previous note, or closes if it was created for this. Only ever within one tab group — split panes comparing the same note are left alone.

- **Toggle bookmark** — One command to add or remove the current note's bookmark, with no dialog. Obsidian's built-in *Bookmark* opens a dialog for an alias and a group, and un-bookmarking is a second command. Data still goes into Obsidian's own `bookmarks.json`.

## Canvas

- **Canvas mouse mode swap** — Figma-style canvas navigation: left-drag pans, the wheel zooms. Hold <kbd>Space</kbd> to get marquee select and normal scrolling back. *Desktop only.*

## Appearance

- **Unified sidebar background** — Makes the left and right sidebars share the editor's background instead of the theme's secondary colour, or any colour you pick. Scoped to the sidebar splits, so the editor and its own tab bar are untouched.
  <br>*Options:* follow the editor background (adapts to light and dark on its own) · custom colour.

- **Active line highlight shape** — Corner radius and horizontal bleed for the highlight your theme draws on the cursor's line. The bleed is painted with `box-shadow` rather than padding, so the text never shifts — and code block lines, whose background *is* the line's own background, keep their edges flush.
  <br>*Options:* radius · bleed in pixels · hug code block edges.

- **Code block top bleed** — In Live Preview a code block's background is painted line by line, so the block's top edge is exactly the first line of text and the code sits tight against it. This adds a few pixels of the same colour above, rounded to match `--code-radius`.
  <br>*Options:* size in pixels.

- **Code block filename & language** — Write the filename after the language and it shows in the code block's top-left corner:

  ````markdown
  ```python ~/sshd.conf
  ```
  ````

  Obsidian keeps only the first word of the info string, so the name is read back from the source. Works in both views: Reading view gets a header row, and in Live Preview — where Obsidian collapses the fence line while the cursor is elsewhere — the name is filled back in via a CodeMirror line decoration.
  <br>*Options:* also show the language label in Reading view, which normally only Live Preview has (it steps aside on hover so the copy button can take its place).

- **Flat code background** — Replaces the Border theme's dotted texture on code blocks, inline code, blockquotes and table headers with a flat fill. *Theme-specific.*

- **Body line height** — A line-height multiplier for both Reading view and the editor. Obsidian has no core setting for this and themes usually leave it to Style Settings; this keeps it with you when you change themes.
  <br>*Options:* multiplier (1–3).

- **Square, detached tabs** — Turns the main tab bar's browser-style connected tabs into separate square chips: radius flattened, the decorative curves that weld the active tab to the note removed, and the active background moved to the inner element so each tab sits clear of its neighbours and of the content below.
  <br>*Options:* derive the shade from the editor background — darker in light mode, lighter in dark mode — or pick a colour · shade depth.

- **Floating scrollbars** — Removes the scrollbar's track fill and the divider line beside the text, leaving only the thumb. On macOS the scrollbar is the native one, so the only lever is `scrollbar-color`; a transparent track drops the divider along with the fill, and shows whatever surface is behind it, which is correct in the editor and in both sidebars.

- **Fix caret on empty indented lines** — After pressing <kbd>Tab</kbd> on a line you haven't typed on yet, the caret sits about ten pixels left of where the character actually lands, then jumps right on the first keystroke. Those lines aren't yet treated as list continuations, so they miss the `tab-size` Obsidian gives list lines; restoring it fixes the offset. Code blocks are unaffected.

- **Hide the file explorer's tab bar** — After splitting a sidebar, the pane holding the file explorer gets a tab bar with a single icon in it, costing a row of height. This reclaims it. The *new file / sort* row and the sidebar collapse button stay. Only applies while the file explorer is the sole tab in its group, so dragging another pane in brings the bar back.

- **Fix folder expand animation** — In the Border theme, expanding a folder for the first time animates the height to a value that's too small and then snaps to the real one. *Theme-specific.*

---

## Install

**From the community plugin browser** — not yet; the submission is pending.

**Manually** — download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/lee112358/ltoolkit/releases/latest) into `<vault>/.obsidian/plugins/ltoolkit/`, then enable *LToolkit* under *Settings → Community plugins*.

**With [BRAT](https://github.com/TfTHacker/obsidian42-brat)** — add `lee112358/ltoolkit` as a beta plugin.

## Build from source

```bash
npm install
npm run build     # bundle and install into the vault at $OBSIDIAN_VAULT
npm run dev       # same, rebuilding on change
npm run dist      # bundle into dist/ for a release
npm run format    # prettier
```

`build.mjs` reads the install folder from `manifest.json`'s `id`, and takes the vault path from `OBSIDIAN_VAULT`.

Each feature is one entry in `src/features/index.js`: an id, a group, the settings copy, and either a `create()` returning a `Component` or just a `bodyClass` for the CSS-only ones. Adding a feature means adding an entry — the settings tab builds itself from that array.

## License

[MIT](LICENSE)
