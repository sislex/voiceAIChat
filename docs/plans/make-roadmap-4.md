# Make — roadmap 4 (after roadmap 3)

Statuses: ✅ completed · ⏸ waiting for an external resource · ✗ skipped with a reason.
Proceed numerically within groups A through G. Historical workflow: gate per item, verification on :8799, KB and commit, release every five items.

## A. Assistant and edit quality

| # | Item | Status |
|---|------|--------|
| 1 | Transactional multifile edits with make_apply_changes and rollback on compilation errors | ✅ |
| 2 | Targeted patches through make_edit_file fragment replacement | ✅ |
| 3 | Component tests in the story runner with panel results | ✅ `__tests__` runner with test/expect/render/click/type, test-count button, and fix action |
| 4 | Questions without edits: explain a file or element in a read-only turn | ✅ header question action temporarily enables Plan mode and restores the previous mode afterward |
| 5 | Compare the post-edit screenshot with the original request | ✅ comparison action on the before/after strip sends the after screenshot and request to the assistant; automatic checks within a turn ⏸ until server screenshots are available |
| 6 | Project memory in .make/notes.md for every turn | ✅ project memory dialog, make_remember, and promptContext block |
| 7 | Designer/developer assistant modes | ✅ `MAKE_MODE_HINTS` selected in project memory settings under .make/settings.json |
| 8 | Next-step chips after assistant responses | ✅ makeNextSteps prioritizes issues, accessibility, tokens, responsive layout, dark theme, and tests in a strip above the preview |

## B. Editor and code

| # | Item | Status |
|---|------|--------|
| 9 | Inline editor diff for a turn's changes | ✅ shared changedLines uses line LCS; Monaco highlights assistant-written lines, with a hide action |
| 10 | File multiselect and bulk operations | ✅ Ctrl/Cmd toggling and Shift ranges through @shared/makeSelection; move/delete/clear actions for the selection |
| 11 | Project search/replace with regex and preview | ✅ regex/case flags, make:replace with regex/dryRun, before/after lines, and $1 substitutions |
| 12 | JSX/TS diagnostics and basic CSS linting | ✅ lintMakeFile covers no-console/no-var/eqeqeq/img-alt/jsx-key and CSS !important, duplicates, invalid hex, and empty rules; warning markers do not roll back transactions |
| 13 | Automatic component imports when inserting library items | ✅ insertLibraryFiles adds kit imports to the entry point chosen by pickEntryFile; make:libraryInsert returns autoImported |
| 14 | CSS/HTML formatting on explicit save | ✅ existing prettierParserFor support for html/css; autosave deliberately skips formatting; formatCode.test.ts covers it |
| 15 | rfc, story, and token snippets | ✅ monacoSnippets.ts and CompletionItemProvider use VS Code snippet syntax |
| 16 | Editor zen mode and resizable code/preview split | ✅ side preview, draggable role=separator, persisted ratio, zen header/tree hiding, and Escape to exit |

## C. Preview and inspector

| # | Item | Status |
|---|------|--------|
| 17 | Edit text directly in previews and persist it | ✅ double-click enables contenteditable; Enter/blur sends vc-make.text; replaceUniqueText requires a unique source occurrence and reports ambiguity |
| 18 | Drag preview sections and persist markup order | ✅ Alt-drag between siblings sends vc-make.reorder with moved/target/position; reorderMarkup requires each fragment exactly once in one file |
| 19 | Element dimensions and rulers on hover | ✅ width/height badge and four parent-edge guides labeled in pixels |
| 20 | Emulate hover/focus/active, reduced motion, and slow mock networking | ✅ preview menu clones rules under .vc-force-*, supports reduced motion and 0/1.5/4-second mock delay through vc-make.env |
| 21 | Three synchronized preview widths | ✅ 1200/820/390 widths in one strip; vc-make.state is forwarded as vc-make.restore with a 300 ms echo-suppression window |
| 22 | One-click console-error fixes | ✅ existing showAutofix banner listens for eight seconds after edits; askFix sends the latest five errors, with an additional console-to-chat action |

## D. Components and design systems

| # | Item | Status |
|---|------|--------|
| 23 | Generate missing component stories | ✅ no-stories group uses generateStoriesSource and XProps to create Default plus stories for union-literal props |
| 24 | Visual story regression comparison | ✅ dependency-free lib/pixelDiff.ts adds a difference map and changed-pixel percentage to before/after comparison |
| 25 | WCAG token contrast | ✅ contrastPairs compares text/accent against backgrounds, reports AA/large-text AA/AAA, and recalculates from drafts |
| 26 | Import Figma Variables JSON files | ✅ parseFigmaTokens accepts Variables API, Tokens Studio/W3C, and flat maps, then applies setCssToken |
| 27 | Generate dark theme from light tokens | ✅ buildDarkThemeBlock adjusts HSL backgrounds, text, and accents and replaces the existing block without duplication |
| 28 | Public component showcase with search and usage code | ✅ __gallery__, including public /p and /s routes, searches by ?q= and exposes import/JSX snippets from storyUsageSnippets with copy actions |

## E. Data and backend mocks

| # | Item | Status |
|---|------|--------|
| 29 | Collection table editor | ✅ MakeMockTable supports object arrays in mock/*.json with editable cells, row/column creation, deletion, JSON switching, and normal saves |
| 30 | Generate mocks from assistant descriptions | ✅ Code-mode menu sends makeMockPrompt with mock/api/<slug>.json, record count, collection format, and fetch URL |
| 31 | JSON Schema form validation with 422 responses | ✅ collection $schema supports a subset of type/required/properties/enum/min*/max*/pattern/email/items; POST/PUT/PATCH return `{error:'validation', issues}`; model guidance updated |
| 32 | Cookie-session authentication mock | ✅ $auth supports users, require, and logout; login sets vc_mock_session, protected requests return 401 without it, and resolveMock receives request cookies |

## F. Publishing and collaboration

| # | Item | Status |
|---|------|--------|
| 33 | Custom publication domains | ⏸ requires wildcard DNS/certificate and a Caddy rule for *.make.<domain>; /s/<slug>/ is available; see deploy.md |
| 34 | Moderated external viewer comments | ✅ publication setting enables the widget; POST /p/<token>/__comments__ submits pending comments with a 10-per-10-minute IP limit; owners approve and GET returns approved comments |
| 35 | Owner notifications for new comments | ✅ make.changed with .comments.json triggers a toast and moderation count; email ⏸ without SMTP |
| 36 | Netlify/Vercel exports | ✅ export hosting selector adds netlify.toml/vercel.json for static or Vite hosting and DEPLOY.md with steps and mock limitations |
| 37 | Compare publication versions visually | ✅ historical __snapshot__/<id>/ preview with a base URL beside current state; html2canvas and pixelDiff produce the difference map |

## G. Operations and platform

| # | Item | Status |
|---|------|--------|
| 38 | Server-side Playwright screenshots | ⏸ server image lacks browsers, adding roughly 400 MB; client html2canvas covers current comparisons and story snapshots; browser installation would require a Dockerfile change |
| 39 | GitHub push and Figma import | ⏸ no GitHub PAT or Figma token; Figma JSON token import is implemented in item 26, and repository export uses ZIP/makeGit |
| 40 | Production disk monitoring and SSH hardening | ✅ AdminMakeStats.disk uses statfs, alerts below 10 GB, and exposes make_disk_* metrics; fail2ban/SSH changes ⏸ require explicit authorization for the production host |
