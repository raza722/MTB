# Test-run fixes, 18-19 Nov 2026: instructions for the developer

The whole system test (`MTB Test Run.md`, 853 rows) was run on the testing PC's copy of MTB_Central with the dev servers. **Result: 845 pass, 2 fail, 6 skipped, 170 findings.** The fixes made during the run are on two branches with the same name:

| Repository | Branch | What |
|---|---|---|
| `MTB_Backend` | `test-run-fixes-2026-11-19` | SQL views and procedures, a few Python services, one new puller step, one spec note |
| `MTB` (frontend) | `test-run-fixes-2026-11-19` | staff app, portal, shared packages (ui, api, domain, i18n) |

The detailed findings (`findings.md`, `progress.md`, `MTB Test Run - Results.md`) stay on the testing PC under `MTB_handover/testing`. They quote real students and staff from the copy, so they are not in either repository; ask for them if you need a finding's full story. Findings are referred to below by number (F-nnn).

Merge the **backend first**: the frontend reads fields the changed procedures send (for example `hasPhoto` on the student list, `fines` on the fee counter, `smsPaused` on defaulters).

## 1. Backend

1. Pull the branch, then from `MTB_Backend`:

   ```powershell
   .venv\Scripts\python -m seed.seeder --dry-run
   ```

   It should list the changed files under `seed/03_views`, `04_functions`, `05_procedures` and `06_data` (24 files). Then run it for real:

   ```powershell
   .venv\Scripts\python -m seed.seeder
   ```

2. **If you apply a file by hand with sqlcmd, always pass `-f 65001`** (and `-I`):

   ```powershell
   sqlcmd -S localhost -E -No -I -f 65001 -d MTB_Central -b -i seed\05_procedures\comm\0673_comm_Audience.sql
   ```

   Without `-f 65001`, sqlcmd reads the UTF-8 files in the console code page and silently stores "—", "·", "–" and Urdu as `â€”`-style garbage inside the procedures (it happened once during the run and was repaired). Check after a manual apply; only `comm.fn_SmsParts*` may match (their GSM table):

   ```sql
   SELECT OBJECT_NAME(object_id) FROM sys.sql_modules
   WHERE definition LIKE N'%' + NCHAR(226) + NCHAR(8364) + N'%' AND OBJECT_NAME(object_id) NOT LIKE 'fn_SmsParts%';
   ```

   The seeder reads the files itself and is not affected.

3. **Restart the API** (Python changed):
   - `main.py`, `utils/config.py`: the plan warm-up now runs in **one worker per machine** (an OS file lock; the next worker takes over if that one stops). With `--workers 4` every worker used to warm every 5 minutes at once and timed out real requests (F-029). New setting `PLAN_WARM_UP_SECONDS` (default 300; 0 switches the warm-up off).
   - `models/students.py`, `services/students/*`: fee figures (balance, fee status, family fees) are left out for an account without `fees.view` at the student's campus; the student list says `hasPhoto`; address 300 and city 120 characters are refused when longer instead of being cut.

4. **One-off data repair on an existing database** (the seeder does not do this). Some sections had no subject teacher although the timetable names one, so exams credited their papers to nobody (F-062; at Khalid Campus 20 class-subject pairs, all nine subjects of one Class 10 section). Run once per database; it only adds missing pairs, for the current session, when the timetable teacher has a posting open today at that campus:

   ```sql
   SET XACT_ABORT ON;
   DECLARE @S smallint = (SELECT SessionID FROM core.vw_AcademicSessionData WHERE Status = 'CURRENT');
   DECLARE @Mig int = (SELECT UserID FROM sec.UserAccount WHERE Username = 'system.migration');
   WITH p AS (
       SELECT s.CampusID, s.ClassOfferingID, s.SubjectID, s.StaffID, COUNT(*) AS Slots
       FROM tt.vw_LiveSlot s
       WHERE s.SessionID = @S AND s.StaffID IS NOT NULL AND s.SubjectID IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM acad.SubjectTeacher t WHERE t.ClassOfferingID = s.ClassOfferingID AND t.SubjectID = s.SubjectID)
       GROUP BY s.CampusID, s.ClassOfferingID, s.SubjectID, s.StaffID),
   r AS (SELECT p.*, ROW_NUMBER() OVER (PARTITION BY p.ClassOfferingID, p.SubjectID ORDER BY p.Slots DESC, p.StaffID) AS rn FROM p)
   INSERT acad.SubjectTeacher (ClassOfferingID, SubjectID, StaffID, CampusID, ModifiedBy)
   OUTPUT inserted.ClassOfferingID, inserted.SubjectID, inserted.StaffID
   SELECT r.ClassOfferingID, r.SubjectID, r.StaffID, r.CampusID, @Mig
   FROM r
   WHERE r.rn = 1 AND EXISTS (SELECT 1 FROM hr.vw_StaffCampusToday t WHERE t.StaffID = r.StaffID AND t.CampusID = r.CampusID);
   ```

   On the testing PC's copy this added 14 rows. The 6 pairs left are Islamiat lessons the live timetable still gives to a teacher whose posting ended in September 2026 (F-170): the school must hand those periods to a current teacher first.

5. **New puller step** `puller/modules/08_timetable/43_load_subject_teachers.sql` does the same during a migration load (after the lessons; current session only; written as `system.migration`, so the Setup purge removes the rows with the offerings). A first draft that also filled earlier sessions would have added about 11,700 rows at Khalid Campus and was cut back. It was dry-run on the copy inside a rolled-back transaction: it re-created exactly the 14 rows.

6. **Report exam lists** now list class tests of the last **62** days (the run's decision 13b Q10), not 14 (`06_data/0699_rpt_Settings.sql` changes the seeded default unless an admin already set a value; spec note Y4 updated in `docs/modules/13_reports.md`). At Khalid Campus the report catalogue grew from 50 KB to 564 KB and loads in about 1 s warm (0.3-0.7 s before); the first call after the procedure recompiles can take up to 20 s. To go back, set `reports.examOptionDays` in `core.SettingValue` (no code change).

### Changed SQL files

| File | Change (finding) |
|---|---|
| `03_views/0368_acad_vw_StudentTimeline.sql` | A promotion run's date is used only within 120 days of the day it takes effect; migrated runs (stamped the day they were loaded) date the promotion by its effective date, so the history reads newest first (F-013). |
| `03_views/0456_adm_vw_ApplicationAudience.sql`, `04_functions/0443_comm_vw_Delivery.sql` | `AppliedOn` for the admission-candidates SMS filter (F-135). |
| `04_functions/0431_act_vw_More.sql` | `act.vw_TestDoc`: no trailing " ·" after an exam that has no class of its own (F-107). |
| `04_functions/0482_rpt_fn_Base.sql` | `rpt.fn_FilterPart` names an exam by its title in report headers (F-149). |
| `05_procedures/acad/0537_acad_SectionBoard.sql` | `acad.usp_Placement_Move`: a move dated the day the current placement began corrects that placement (moving back to yesterday's section reopens it), so a wrong move can be undone the same day (F-128). |
| `05_procedures/act/0665_act_Test.sql` | `act.usp_Test_Json` reads an exam's results in two steps for merit lists from exam results (over 5 min to 7 s for a 479-candidate exam, F-106). |
| `05_procedures/adm/0587_adm_Admit.sql` | A replayed admission reports the welcome SMS the first call queued; a timeout says the admission may already be saved (F-029). |
| `05_procedures/att/0590_att_Common.sql` | `att.usp_TeacherRegister_Row` uses its own temp table, so submitting a register no longer fails after the commit (F-044). |
| `05_procedures/comm/0673_comm_Audience.sql` | Candidates filtered by applied date (F-135); students who left: one message per student, and a student restored after leaving or expulsion is left out (F-136, F-165: 12 restored students would have got an expulsion notice); exam results through `exam.usp_ResultAudience_Fill`, `{result}` from the chosen exam (F-138); `{tests_summary}` built (F-139); English messages get "-" for the en dash in an exam's name (2 SMS parts instead of 3). Clones are re-made by the file's own `act.usp_Proc_Clone` calls. |
| `05_procedures/exam/0600_exam_Common.sql`, `exam/0603_exam_Declare.sql` | New `exam.usp_ResultAudience_Fill` (about 0.1 s for 479 candidates; `exam.vw_ResultAudience` took over 90 s); the declaration notices use it (F-138). |
| `05_procedures/fin/0623_fin_Charge.sql` | The counter's late fines from `fin.fn_LateFine` (F-036). |
| `05_procedures/fin/0625_fin_Ledger.sql` | The ledger names the concession on a re-priced charge (F-034). |
| `05_procedures/fin/0630_fin_Defaulter.sql` | `smsPaused` from the SMS kill switch (F-140). |
| `05_procedures/fin/0632_fin_Report.sql` | Collection lines leave out allocations that were reversed (F-153); clones re-made by the file. |
| `05_procedures/gl/0649_gl_Period.sql` | A campus without a bank account can close a month (the bank check summed NULL). |
| `05_procedures/home/0750_home_DashParts.sql` | Singular wording for one ("1 receipt", F-039). |
| `05_procedures/hr/0563_hr_StaffEdit.sql` | `hr.usp_StaffTeaching_Set` temp tables renamed so the nested profile procedure no longer clashes (F-129). |
| `05_procedures/rpt/0730_rpt_Catalogue.sql` | Exam options fall back to 62 days (F-150). |
| `05_procedures/rpt/0744_rpt_R_Students.sql` | Students who left or were expelled: "· restored on {date}" when the exit was later undone (F-163). |
| `05_procedures/rpt/0746_rpt_R_Exams.sql` | A board exam's sections are last session's offerings: use the exam's own section of the same name (F-151). |
| `05_procedures/trn/0703_trn_Route.sql` | "1 rider still uses …" (F-131). |
| `06_data/0699_rpt_Settings.sql` | `reports.examOptionDays` default 62, also for a database seeded earlier (F-150). |

## 2. Frontend

1. Pull the branch, then in `mtb`: `pnpm install` (no new packages), and type-check:

   ```powershell
   cd apps\staff; npx tsc --noEmit -p .
   ```

   ```powershell
   cd apps\portal; npx tsc --noEmit -p .
   ```

   Both were clean on the testing PC. Restart the dev servers or rebuild.

2. New files:
   - `apps/staff/src/app/idempotency.ts`: `useIdempotencyKey(...inputs)` gives a new key whenever the inputs change (marked `"use no memo"` so the React Compiler doesn't cache it). It replaced 34 `useMemo(() => newIdempotencyKey(), [...])` calls: a second sale from the same counter reused the first sale's key and was refused (F-078).
   - `apps/staff/src/app/search.ts`, `apps/staff/src/features/students/useStudentSearch.ts`: student pickers (documents, fines, concessions, status changes) search the server as you type instead of loading every student (F-100, F-117: the fines page froze with 27,763 students in one list).
   - `apps/staff/src/features/warehouse/money.ts`: warehouse amounts with paise from the migrated data are rounded before the shared formatter, which threw on them and took Suppliers and Goods received down (F-077).

3. Shared packages:
   - `packages/ui/src/components/special-inputs.tsx`: the Combobox filter matches whole typed words in the label and hint (`comboboxFilter`), not cmdk's fuzzy letters or the internal id (F-141).
   - `packages/ui` DataTable and Tabs; `packages/domain` money and dates; `packages/api` exams, fees, students types; `packages/i18n` new key `fees.dayOverdue` ("1 day late", F-168).
   - Report filters: a select with more than 40 options is drawn as a searchable Combobox (exam filters, fee head, group, room, supplier; F-150).

4. Main screen changes in the staff app: SMS Compose (live date and range errors, chosen class's exams, click a recipient to preview their message, F-135/F-138/F-166); Notices on All campuses read-only with "Choose a campus to use notices" (F-097); Timetable teacher week counted on the teacher's own timings (F-148); staff Monthly sheet says "so far" only for the current month (F-162); an empty report no longer repeats its note (F-161); a report without filters can be run (F-155, F-167); plus many smaller wording and plural fixes across fees, exams, library, warehouse, transport and setup. The portal treats a voucher whose fees changed after issue as out of date (F-085).

## 3. Still open for the backend owner or the client

Decisions:
- **F-066**: a scholarship's monthly figure is worked out on the class fee (spec 09 D3), while Fees takes the percentage off the student's own (migrated) charge; pick one rule.
- **F-091**: does "New admissions" count students admitted at the office?
- **F-049, F-052, F-098, F-101, F-160**: daily period maximum; clash checks across bell timings; 2025-26 / 2026-27 register boundaries; money on documents for accounts without fee rights; 41 "Vendor" records counted as staff.

Backend:
- **F-097**: notice writes on All campuses should answer CAMPUS_REQUIRED; record routes get no campus context today (API design).
- **F-089**: report job start should be idempotent under a slow database (one job per request).
- **F-063, F-057** (and F-003/F-008/F-009): API waits of 10-300 s while SQL is fast: worker, thread or connection waits.
- **F-117**: page the fines API on the server (9,322 fines, 2.4 MB in one reply).
- **F-138**: `exam.vw_DeclaredResult` is slow (12-16 s a student) for "latest declared result".
- **F-047, F-070, F-077, F-080, F-082, F-083, F-085, F-086, F-092, F-095, F-105, F-106, F-112, F-119, F-120, F-152, F-154**: see `findings.md` on the testing PC.

Data / migration:
- **F-170**: six Islamiat class-subject pairs at Khalid Campus are timetabled to a teacher who has left.
- **F-021, F-037, F-125, F-145, F-158**: dates of birth after joining dates, installment due dates, Urdu text lost in migration, a duplicate enrolment and a placement in a legacy section.

## 4. Records made on the testing PC's copy

Only fictional test records were created (test students, a test applicant admitted as a new Prep student, test merit lists and scholarship tests, test vouchers and receipts, held SMS). Nothing was sent: SMS stayed paused throughout. Data changed directly on that copy that you may also want elsewhere: the 14 subject teachers of step 1.4, and the `reports.examOptionDays` default (step 1.6, now in the seed).
