The design system for MTB's school and college management system: one visual language for the **staff web app** (desktop, data-dense), the **teacher app** (mobile-first, ~390px) and the **student/parent portal** (mobile and desktop). It replaces a Windows desktop application, so it is calm, institutional and unhurried — closer to banking or healthcare software than to consumer edtech. Non-technical office staff must find every screen obvious.

## Content fundamentals

- Write in plain, direct English. Sentence case everywhere, including buttons and headings: "Post receipt", "Declare results", "Request change".
- Address the user as *you*; refer to the institution as *MTB* and to a campus by its name ("Khalid Campus"), never by a code.
- Buttons start with a verb and name the object: "Post receipt", not "Submit"; "Cancel receipt", not "Delete". The one exception is "Cancel" on a dialog, which always means *close without doing anything*.
- Irreversible actions (posting a receipt, cancelling a receipt, declaring results, pausing all SMS, merging two people) always go through `ConfirmDialog`, which restates what will happen and the key figures.
- Money is always `Rs 12,500`: the prefix *Rs*, a space, thousands separators, no decimals. Set every amount in `numeric` (tabular figures) and right-align it in tables. Never type an amount into a cell that the system can calculate — arrears, late fines and balances are always computed.
- Dates are `04-Nov-2026`; the academic session is `2026–27` (en dash). Relative time ("6 days overdue") always sits beside the absolute date, never instead of it.
- Identifiers that must be read digit by digit — receipt numbers (`KC-2627-000418`), G.R. numbers, CNICs (`12345-1234567-1`), voucher numbers — are set in `mono`.
- Urdu appears wherever a parent or guardian will read it: a student's name beside the English name, SMS templates, the parent portal when Urdu is selected. Urdu text is always `dir="rtl" lang="ur"` in the `urdu-*` styles; an Urdu field in a form is an `Input` with `urdu`.
- No emoji, no exclamation marks, no jokes. Empty states say what would appear and offer the one action that fills them. Error messages say what to do: "Enter all 13 digits: 12345-1234567-1".
- All example data in this system is fictional: Ayesha Khan, Muhammad Bilal, Multan and Lahore addresses, CNICs in the `12345-1234567-1` pattern.

## Colour

- Grounds: `surface` is the page; `surface-raised` is every card, table, panel, modal and the top bar; `surface-sunken` is table headers, keypad wells and read-only inputs. Separate surfaces with `border`, not with shadow.
- Text: `ink` for body and headings, `ink-muted` for labels and secondary lines (4.5:1 on every ground in both themes), `ink-subtle` only for placeholders.
- One brand colour, the MTB green `brand`: primary buttons (text `on-brand`), the active sidebar item (`brand-tint` with `brand-ink`), links, the selected tab underline and the campus pill. Use it for the single most important action on a view and nowhere decorative.
- Every page states its campus and session; the campus pill is `brand-tint` / `brand-ink`.
- Status vocabularies are fixed and reached only through their semantic tokens so meaning stays consistent across all three apps:
  - Fees: **Paid** `status-paid`, **Unpaid** `status-unpaid`, **Overdue** `status-overdue`, **Cancelled** `status-cancelled` (plus strikethrough on the amount).
  - Attendance: **Present** `status-present`, **Absent** `status-absent`, **Leave** `status-leave`, **Late** `status-late`, **Holiday** `status-holiday`.
  - Results: **Draft** `status-draft` (dashed border), **Declared** `status-declared`.
  - Each has `-tint` (fill) and `-ink` (text) companions; every badge also carries its word, so colour is never the only signal. Success green and danger red differ in lightness as well as hue.
- Signals: `info`, `warning`, `danger`, `success` with their `-tint` and `-ink` for banners, toasts and inline validation. A destructive button is `danger` with `on-danger`; the SMS kill switch is the only switch that uses `danger`.
- Dark mode (staff app only): the same tokens re-valued. `brand` becomes a lighter green with dark `on-brand` text; never put literal white on it. Shadows deepen (`shadow-*`) because surfaces sit close in value.
- Focus: every focusable control shows `focus-ring`, 2px solid, offset 2px, so the ring sits on the surrounding surface and meets 3:1 everywhere. Never remove it.
- Charts: series in `chart-1`…`chart-5` in order; `chart-track` for the unfilled part of a meter; targets in `chart-2`.

## Type

- English and all numerals: Inter (`sans`). Urdu: Noto Nastaliq Urdu (`urdu`). Identifiers: JetBrains Mono (`mono`). All three are hosted Google Fonts; load Inter 400/500/600 and Noto Nastaliq Urdu 400/500.
- Scale: `display` 28/36 for the one hero figure on a view; `title-1` 22/28 page titles; `title-2` 18/24 card and modal titles; `title-3` 15/20 sub-sections; `body` 14/20 is the desktop default; `body-large` 16/24 is the mobile default; `small` 13/18 secondary lines; `caption` 12/16 uppercase labels and column headers; `numeric` and `numeric-large` for money and counts.
- Urdu styles carry much taller line heights (`urdu-body` 15/34, `urdu-title` 20/44) because nastaliq descends far below the baseline. Never tighten them and never mix Urdu into an English line without `unicode-bidi: isolate`.
- Headings and `display` use −0.01em tracking; `caption` uses +0.02em.

## Spacing, radius, elevation

- A 4px grid. Desktop controls are 40px tall (`space-10`); on the teacher app and parent portal every tap target is at least 44px (`space-11`) — buttons, list rows, keypad keys, segmented options.
- Page padding `space-6`; card padding `space-5` (desktop) or `space-4` (mobile); gap between cards `space-6`; between sections `space-8`.
- Table cells: `space-2` vertical, `space-3` horizontal; `dense` for long ledgers, `roomy` for the fee counter where cashiers click rows.
- Radii: `radius-sm` badges and checkboxes; `radius-md` buttons, inputs, tabs; `radius-lg` cards, panels, modals, toasts; `radius-full` avatars and pills.
- Elevation: `shadow-sm` on cards and the top bar, `shadow-md` on menus and search results, `shadow-lg` on modals, panels and toasts. Nothing else casts a shadow.

## Layout

- Staff app: a 240px left sidebar with, in this order, Dashboard, Students, Admissions, Attendance, Exams, Fees, Accounts, Warehouse, SMS, HR, Settings. A 48px top bar holds the campus switcher (All campuses, Khalid Campus and the four others), the session switcher, global search (name, G.R. number, father's CNIC or receipt number), notifications and the user menu. Every page title is followed by the campus and session being viewed.
- Teacher app and parent portal: a single column at 390px with a sticky bottom action bar (`space-12` tall) for the one primary action; registers and keypads are thumb-reachable.
- Pages are read top-left to bottom-right: stats first, then the table or form, with the primary action at the top right of the page header on desktop and in the sticky bar on mobile.

## States

- Loading: `Skeleton` in the shape of what will appear (`DataTable` and `StatCard` have it built in); never a spinner on a whole page.
- Empty: `EmptyState` with an icon, a one-line title and the one action that fills it.
- Validation: inline under the field in `danger-ink`, with the field border in `danger`; the first invalid field receives focus on submit.
- Success: a `Toast` that carries the record number ("Receipt KC-2627-000418 posted"); it never blocks the next action.
- Confirmation: `ConfirmDialog` before anything irreversible, restating the figures.
- Permission denied: an `EmptyState` with the `lock` icon that names the role the user has at this campus and who can grant more.
- Offline (teacher app): a `Banner` in `info` while syncing and `warning` while offline, with the count of registers waiting to sync.

## Iconography

- The system's own stroke icons (`Icon`, 24-unit grid, 1.75px stroke, round joins), drawn for MTB: one per sidebar section, plus the status, navigation and action glyphs used in the components. Use them at 18px in buttons and 20px elsewhere; always with a text label or an `aria-label`.
- No emoji, no filled icons, no illustration. A student with no photo gets `Avatar` initials.

## Logo

MTB's own mark was not supplied; the name is set in plain type (`title-1`) in the sidebar header and on the receipt. Drop the official logo into the Logos asset group when available.
