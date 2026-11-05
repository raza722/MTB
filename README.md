# MTB — school and college management system (web)

Replacement for the legacy WinForms desktop app (see `../docs`). One pnpm + Turborepo monorepo; the clickable demo is the real app, running on fictional data.

```
apps/staff/          staff web app: every office module (Vite + React 19 + TanStack Router + TanStack Query)
apps/teacher/        teacher app for phones: today, registers, marks entry, timetable, leave (works offline)
apps/portal/         parent and student portal: attendance, results, fees, vouchers, receipts, notices (English / Urdu)
packages/ui/         MTB Campus design system in React: tokens, components, icons, charts, motion
packages/domain/     pure TypeScript rules: money, dates, CNIC, late fine, amount in words, attendance %
packages/api/        typed API client, one file per module (types, xxxApi, xxxQueries)
packages/mocks/      MSW mock server and fictional fixtures (the demo's "database")
packages/i18n/       English and Urdu strings for the portal
packages/config/     shared tsconfig
```

## Run

| App | Port | Start it with | Opens at |
|---|---|---|---|
| Staff | 5173 | `pnpm dev` | http://localhost:5173 (goes to the dashboard after sign-in) |
| Teacher | 5174 | `pnpm dev:teacher` | http://localhost:5174 |
| Parent & student portal | 5175 | `pnpm dev:portal` | http://localhost:5175 |

```bash
pnpm install
pnpm dev:all          # all three apps at once
pnpm test             # domain rules + token contrast checks
pnpm typecheck        # every package and app
pnpm build            # production builds of the three apps (dist/)
```

The design-system page is at http://localhost:5173/design-system (also in the account menu).

## Demo (fictional data, mock server in the browser)

`VITE_USE_MOCKS=true` (each app's `.env`) makes MSW answer `/api/*` in the browser with the brief's cast. All names,
numbers and CNICs are fictional; none come from the legacy screenshots.

**Demo data is kept per app and per browser tab.** Each app stores its demo data in `sessionStorage`, which belongs to one
origin (port) and one tab: it survives a reload, a new tab starts fresh, and **Demo → Reset demo data** (staff app) puts
everything back. The three apps run on different ports, so they do not share data in the demo. For example, a change request
a teacher sends from the teacher app does not appear in the principal's approvals on the staff dashboard, and a receipt
posted at the staff fee counter does not appear in the portal. Inside the staff app every module shares one store, so the
cross-module flows below work end to end. On the real server all three apps read the same database.

### Staff app (port 5173)

Every account uses the demo password and the two-step code in `packages/mocks/src/fixtures/users.ts`. The sign-in page lists
the accounts, and the **Demo** button (bottom left) signs in as anyone in one click, makes the next receipt post fail, or
resets the data.

| Account | Role | Use it for |
|---|---|---|
| usman.ali | Cashier — Khalid Campus | Flow 1: search Ayesha → profile → Collect fee → select 2 overdue charges → Cash Rs 13,000 → Review → Post → A5 receipt; cancel a receipt |
| sadia.rehman | Principal — Khalid Campus | Approve the receipt cancellation and attendance changes on the dashboard; declare results (Exams → First Term · Class 8, type DECLARE); Setup → Users, Roles, Audit log; her own campus's sections and teacher allotment (Setup → Classes, Teachers) and school-day times (Timetable → Bell timings; Setup → Campuses shows them) |
| nadia.shah | Accountant — All campuses | Accounts → open the draft that is Rs 1,500 out of balance → change Gas to 21,500 → Post |
| kamran.yousaf | Admin — All campuses | SMS → Pause all SMS (type PAUSE); the banner shows on every page. Setup: campuses, sessions, classes, users, roles, settings |
| hina.javed | Teacher — Khalid Campus | First sign-in forces a password reset; opening Accounts shows permission denied |
| farah.naz | Office staff — Khalid Campus | Admissions, mark a register the teacher could not (Attendance → Prep-B), library desk, warehouse, transport |
| saima.akram | Exam office (custom role) — Khalid Campus | Marks entry, result sheets and results SMS: the legacy "Staff" and no-role users of the Exam tab |
| rehana.kausar | Office admin (custom role) — Khalid Campus | The legacy office Admin: front office plus result sheets, houses, timetables, staff records and staff attendance, and the read-only student fee card |

Sign-in reads **Setup → Users and Roles**. Disabling or locking an account there stops it signing in, five wrong passwords lock
it (the attempts show in the account's sign-in history and the audit log), "must change password" and two-step follow the
account, and a role's ticks in the roles matrix apply from the user's next page. Custom roles (Exam office, Office admin, or
one you make) work at sign-in like the system roles.

Flows that cross modules in the staff app:

- **Attendance → dashboard.** Office staff mark today's missing Prep-B register or request a change on a submitted register;
  the change appears in the principal's approvals on the dashboard. Approving it updates the register, the student's profile
  and the dashboard's attendance figure. "Absent today" messages go to SMS → Outbox and the delivery report.
- **Fee counter → receipt → cancellation → dashboard approval → ledger and accounts.**
- **Students → fee counter.** A student who has left, was struck off or expelled opens at the counter with "collect
  outstanding dues only".
- **Exams → student profile and portal.** Declared results show on the student profile's Results tab.
- **Fees → Setup.** Campus settings show each campus's late-fine rule from Fees → Fine rules.

Presenter note (409 "changed by someone else" demo): the first save of Sugar Mill Campus details, Ms Sana Tariq's account,
the Exam office role and Ubaid Campus settings in Setup each meets a change by someone else once and shows the "changed by …
Reload" banner; after Reload the save works.

### Teacher app (port 5174)

Sign in with **hina.javed** (Ms Hina Javed, class teacher of 7-B at Khalid Campus) and the demo password from
`packages/mocks/src/fixtures/users.ts`. The sign-in page has a **Demo account** card that fills the form. The first sign-in
asks for a new password (8 to 72 characters with a letter and a number, not containing the username). usman.ali shows the
"no teacher app" screen. Today shows the day's periods (with any cover period), the 7-B register and the marks still to
enter (Monthly Test – October 2026 · Mathematics · 7-B).

### Parent and student portal (port 5175)

Families sign in with the mobile number the school holds and a one-time code; students sign in with their G.R. number. The
fictional families (Imran Khan with Ayesha KC-14823, Hamza KC-15102 and Mariam UC-08831; Tariq Mahmood with Muhammad Bilal
KC-14650) and the demo one-time code are in `packages/mocks/src/fixtures/portal.ts`. In mock mode the sign-in page shows them
in a demo card. English and Urdu can be switched in the portal (top bar and Profile).

## Modules and routes (staff app)

| Module | Routes |
|---|---|
| Dashboard | `/dashboard` |
| Students | `/students`, `/students/$grNo` (tabs via `?tab=`), `/students/families`, `/students/families/$familyId`, `/students/sections`, `/students/promotion`, `/students/leaving`, `/students/documents` |
| Admissions | `/admissions`, `/admissions/enquiries`, `/admissions/new`, `/admissions/tests`, `/admissions/merit`, `/admissions/offers`, `/admissions/duplicates` |
| Attendance | `/attendance`, `/attendance/register/$classSection`, `/attendance/monthly`, `/attendance/students`, `/attendance/absentees`, `/attendance/calendar`, `/attendance/summary` |
| Timetable | `/timetable`, `/timetable/teachers`, `/timetable/substitutions`, `/timetable/weekly`, `/timetable/periods` |
| Exams | `/exams`, `/exams/new`, `/exams/$examId` (+ `/marks`, `/results`, `/analysis`, `/print`), `/exams/combined`, `/exams/merit`, `/exams/history`, `/exams/teachers`, `/exams/university`, `/exams/types`, `/exams/grading` |
| Scholarships & activities | `/activities`, `/activities/scholarships`, `/activities/tests`, `/activities/tests/$testId`, `/activities/schemes`, `/activities/houses`, `/activities/events`, `/activities/events/$eventId`, `/activities/certificates`, `/activities/records` |
| Fees | `/fees`, `/fees/counter`, `/fees/receipts/$receiptNo`, `/fees/structure`, `/fees/concessions`, `/fees/fines`, `/fees/defaulters`, `/fees/candidates`, `/fees/vouchers`, `/fees/vouchers/new`, `/fees/vouchers/print`, `/fees/reports` (+ `/collection`, `/monthly`, `/arrears`) |
| Accounts | `/accounts`, `/accounts/vouchers`, `/accounts/vouchers/$voucherId`, `/accounts/ledger`, `/accounts/trial-balance`, `/accounts/statements`, `/accounts/bank`, `/accounts/fee-posting`, `/accounts/chart`, `/accounts/periods` |
| Staff & payroll | `/hr`, `/hr/new`, `/hr/staff/$staffId`, `/hr/attendance`, `/hr/leave`, `/hr/loans`, `/hr/payroll`, `/hr/increments`, `/hr/reports`, `/hr/settings` |
| Library | `/library`, `/library/desk`, `/library/catalogue`, `/library/loans`, `/library/overdue`, `/library/members`, `/library/counts`, `/library/counts/$countId`, `/library/setup` |
| Warehouse & shop | `/warehouse`, `/warehouse/items`, `/warehouse/stock`, `/warehouse/receive`, `/warehouse/issue`, `/warehouse/shop`, `/warehouse/suppliers`, `/warehouse/counts`, `/warehouse/counts/$countId` |
| Transport | `/transport`, `/transport/routes`, `/transport/vehicles`, `/transport/riders`, `/transport/logbook` |
| SMS & notices | `/sms`, `/sms/compose`, `/sms/outbox`, `/sms/delivery`, `/sms/templates`, `/sms/notices`, `/sms/opt-outs`, `/sms/settings` |
| Reports | `/reports`, `/reports/$reportId`, `/reports/jobs`, `/reports/scheduled` |
| Setup | `/setup`, `/setup/campuses`, `/setup/sessions`, `/setup/classes`, `/setup/subjects`, `/setup/teachers`, `/setup/users`, `/setup/roles`, `/setup/campus-settings`, `/setup/audit` |
| Settings | `/settings` (theme, your account, open decisions, links into Setup) |
| Sign-in | `/login`, `/login/mfa`, `/login/reset-password` |

Teacher app: `/login` (+ `/mfa`, `/reset-password`), `/today`, `/registers`, `/registers/$classSection`, `/marks`,
`/marks/$examId/$classSection/$subjectId`, `/timetable`, `/more`, `/more/classes`, `/more/classes/$classSection`,
`/more/leave`, `/more/notifications`.

Portal: `/sign-in`, `/sign-in/verify`, `/home`, `/attendance`, `/results`, `/fees`, `/fees/voucher`,
`/fees/receipts/$receiptNo`, `/notices`, `/profile`.

Each module's API client is `packages/api/src/<module>.ts` and its mock server is `packages/mocks/src/handlers/<module>.ts`;
both are registered in `packages/api/src/index.ts` and `packages/mocks/src/handlers/index.ts`.

## Design system

The visual source of truth is the **MTB Campus** design-system artifact (https://claude.ai/artifact/JvLZ3QNmMk1yn8rgkwKTpc).
Its files are copied unchanged into `packages/ui`:

| From the design system | In code | Notes |
|---|---|---|
| `tokens.json` | `packages/ui/src/tokens/tokens.json` | `pnpm --filter @mtb/ui tokens` regenerates `tokens.css` and `theme.css` (Tailwind mapping) |
| `components/bundle.css` | `packages/ui/design-system-source/bundle.css` | imported as-is into the `components` layer |
| icon set in `components/bundle.js` | `packages/ui/src/icons.tsx` | `pnpm --filter @mtb/ui icons` regenerates |
| `components/index.d.ts` | React components in `packages/ui/src/components` | same names and props |

Names match one-to-one: token `status-overdue-tint` → CSS `var(--status-overdue-tint)` → Tailwind `bg-status-overdue-tint`;
component `Button · primary · touch` → `<Button variant="primary" size="touch">` → `.mtb-btn-primary.mtb-btn-touch`.

Additions that are not in the design system yet live in `packages/ui/src/styles/components-ext.css` and are marked "MTB addition" in code.
The navy brand alternative (`data-accent="navy"`) is for management's comparison only (`src/tokens/alternatives.json`).

`src/tokens/tokens.test.ts` checks every text/background pair the design system promises against WCAG 2.2 AA in light, dark, green and navy.
