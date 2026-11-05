import { HR_CATEGORY_LABEL, HR_DOCUMENT_LABEL, HR_EMPLOYMENT_LABEL, HR_PAYMENT_LABEL, hrApi, hrMonthLabel, hrQueries, type HrDocumentKind, type HrStaffProfile } from "@mtb/api";
import { formatCnic, formatDate, formatDateTime, formatMobile, formatRs } from "@mtb/domain";
import {
  AttendanceCalendar,
  Avatar,
  Banner,
  Button,
  ConfirmDialog,
  DatePicker,
  EmptyState,
  IconButton,
  KeyValue,
  Menu,
  MenuItem,
  Panel,
  Select,
  Skeleton,
  Sparkline,
  StatusBadge,
  Tabs,
  Textarea,
  Timeline,
  Urdu,
  useToast,
  buttonClassName,
} from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useRef, useState, type ReactNode } from "react";
import { RequirePermission } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { AppointmentLetterDoc, IdCardDoc, PayslipDoc, ProfileDoc } from "./print";
import { AddPostingPanel, EditPersonalPanel, EndPostingPanel, PayPanel, QualificationsPanel, TeachingPanel, useHrSettings } from "./StaffPanels";
import { errorText, HrShell, LoadError, LoanBadge, Ltr, RunBadge, slide, StaffStatusBadge, THIS_MONTH, TODAY, usePayAccess, usePrint, years } from "./shared";

export type ProfileTab = "overview" | "employment" | "qualifications" | "pay" | "leave" | "documents" | "history";

type Editing = null | "personal" | "posting" | "qualifications" | "teaching" | "pay" | { end: string };

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 text-title-3">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

/** One staff member's file: personal, postings at every campus, qualifications, pay, leave, documents and history. */
export function StaffProfilePage({ staffId, tab, setTab }: { staffId: string; tab: ProfileTab; setTab: (t: ProfileTab) => void }) {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const canManage = useCan("hr.manage");
  const canPayroll = useCan("payroll.manage");
  const payAccess = usePayAccess();
  const q = useQuery(hrQueries.profile(ctx, staffId));
  const settings = useHrSettings();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { print, area } = usePrint();
  const [editing, setEditing] = useState<Editing>(null);
  const [leaving, setLeaving] = useState(false);
  const [leftDate, setLeftDate] = useState<string | null>(TODAY);
  const [leftReason, setLeftReason] = useState("");
  const [docKind, setDocKind] = useState<HrDocumentKind>("OTHER");
  const fileRef = useRef<HTMLInputElement>(null);
  const s = q.data;
  const edit = canManage && !readOnly && s?.status === "ACTIVE";

  const markLeft = useMutation({
    mutationFn: () => hrApi.markLeft(staffId, { date: leftDate ?? "", reason: leftReason }),
    onSuccess: (r) => {
      toast({ title: `${r.name} marked as left`, message: `Last working day ${formatDate(r.leavingDate ?? TODAY)}. The record stays for reports and history.` });
      setLeaving(false);
      void queryClient.invalidateQueries({ queryKey: ["hr"] });
    },
  });
  const upload = useMutation({
    mutationFn: (file: File) => hrApi.addDocument(staffId, { kind: docKind, title: HR_DOCUMENT_LABEL[docKind], fileName: file.name, sizeKb: Math.round(file.size / 1024) }),
    onSuccess: () => {
      toast({ title: "Document uploaded", message: HR_DOCUMENT_LABEL[docKind] });
      void queryClient.invalidateQueries({ queryKey: ["hr"] });
    },
    onError: (e) => toast({ tone: "danger", title: "Upload failed", message: errorText(e) }),
  });
  const removeDoc = useMutation({
    mutationFn: (docId: string) => hrApi.removeDocument(staffId, docId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["hr"] }),
  });

  if (q.isError)
    return (
      <RequirePermission permission="hr.view" page="Staff profile">
        <HrShell title="Staff profile">
          <LoadError what="This staff record" error={q.error} onRetry={() => void q.refetch()} />
          <Link to="/hr" className={buttonClassName({ size: "sm", className: "justify-self-start" })}>
            Back to all staff
          </Link>
        </HrShell>
      </RequirePermission>
    );

  const primary = s?.postings.find((p) => p.primary) ?? s?.postings[0];
  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "employment", label: "Postings", count: s?.postings.length },
    { id: "qualifications", label: "Qualifications" },
    ...(payAccess ? [{ id: "pay", label: "Pay" }] : []),
    { id: "leave", label: "Leave and attendance" },
    { id: "documents", label: "Documents", ...(s && s.missingDocuments ? { count: s.missingDocuments } : {}) },
    { id: "history", label: "History" },
  ];

  return (
    <RequirePermission permission="hr.view" page="Staff profile">
      <HrShell
        title={s?.name ?? "Staff profile"}
        context={s ? `${s.employeeNo} · ${s.designation} · ${s.campusName}` : undefined}
        meta={s ? <StaffStatusBadge s={s} /> : undefined}
        actions={
          s && (
            <>
              <Link to="/hr" className={buttonClassName({ variant: "ghost", size: "sm" })}>
                All staff
              </Link>
              <Menu
                trigger={
                  <Button icon="printer" iconRight="chevronDown">
                    Print
                  </Button>
                }
              >
                <MenuItem icon="file" onSelect={() => print(<ProfileDoc s={s} />, "A4")}>
                  Staff profile (A4)
                </MenuItem>
                <MenuItem icon="file" onSelect={() => print(<AppointmentLetterDoc s={s} principal={primary?.campus === "KC" ? "Mrs Sadia Rehman" : "Principal"} />, "A4")}>
                  Appointment letter (A4)
                </MenuItem>
                <MenuItem icon="idCard" onSelect={() => print(<IdCardDoc s={s} />, "CARD")}>
                  Staff ID card
                </MenuItem>
              </Menu>
              {edit && (
                <Button icon="edit" onClick={() => setEditing("personal")}>
                  Edit details
                </Button>
              )}
              {edit && (
                <Button variant="danger-quiet" icon="logout" onClick={() => setLeaving(true)}>
                  Mark as left
                </Button>
              )}
            </>
          )
        }
      >
        {!s ? (
          <div className="mtb-card grid gap-4 p-6">
            <Skeleton width="40%" height={28} />
            <Skeleton height={120} />
          </div>
        ) : (
          <>
            <section className="mtb-card mtb-rise p-5" aria-label="Summary">
              <div className="hr-hero">
                <Avatar name={s.name.replace(/^(Mr|Ms|Mrs|Dr|Qari)\s+/, "")} size="xl" />
                <div className="grid min-w-0 gap-1">
                  <div className="flex flex-wrap items-baseline gap-3">
                    <span className="text-title-2">{s.name}</span>
                    {s.nameUrdu && <Urdu size="body">{s.nameUrdu}</Urdu>}
                  </div>
                  <div className="hr-hero-meta">
                    <span>
                      {s.designation} · {s.department}
                    </span>
                    <span>{HR_CATEGORY_LABEL[s.category]}</span>
                    <span>{HR_EMPLOYMENT_LABEL[s.employmentType]}</span>
                    <span>Joined {formatDate(s.joiningDate)}</span>
                    <span>{years(s.serviceYears)} service</span>
                    {s.classTeacherOf && <span>Class teacher {s.classTeacherOf}</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {s.postings
                      .filter((p) => !p.endDate)
                      .map((p) => (
                        <StatusBadge key={p.id} status={p.primary ? "brand" : "info"} dot={false} icon="building">
                          {p.campusName}
                          {p.primary ? " · main" : ` · ${p.daysPerWeek ?? ""} days a week`}
                        </StatusBadge>
                      ))}
                    {s.userName && (
                      <StatusBadge status="neutral" dot={false} icon="user">
                        Signs in as {s.userName}
                      </StatusBadge>
                    )}
                  </div>
                </div>
              </div>
              {s.status === "LEFT" && (
                <Banner tone="neutral" className="mt-4" title={`Left on ${formatDate(s.leavingDate ?? TODAY)}`}>
                  {s.leavingReason}. The record is kept for history, reports and experience letters.
                </Banner>
              )}
              {s.probationEnds && s.status === "ACTIVE" && <Banner tone="info" className="mt-4">On probation until {formatDate(s.probationEnds)}. Confirm the appointment in writing before then.</Banner>}
            </section>

            <Tabs aria-label="Staff file" idPrefix="hr-p-" tabs={tabs} value={tab} onChange={(t) => setTab(t as ProfileTab)} />

            {tab === "overview" && (
              <div className="hr-split">
                <Panel id="personal" title="Personal and contact" rise={1} actions={edit ? <Button size="sm" variant="quiet" icon="edit" onClick={() => setEditing("personal")}>Edit</Button> : undefined}>
                  <KeyValue
                    items={[
                      [s.relation === "w/o" ? "Husband" : "Father", s.guardianName],
                      ["CNIC", <Ltr>{formatCnic(s.cnic)}</Ltr>],
                      ["Date of birth", formatDate(s.dob)],
                      ["Blood group", s.bloodGroup],
                      ["Marital status", s.maritalStatus.charAt(0) + s.maritalStatus.slice(1).toLowerCase()],
                      ["Mobile", <Ltr>{formatMobile(s.mobile)}{s.mobile2 ? ` · ${formatMobile(s.mobile2)}` : ""}</Ltr>],
                      ["Email", s.email ?? "—"],
                      ["Address", `${s.address}${s.city && !s.address.includes(s.city) ? `, ${s.city}` : ""}`],
                      ["Emergency contact", `${s.emergency.name} (${s.emergency.relation}) · ${formatMobile(s.emergency.mobile)}`],
                      ...(s.reference ? ([["Reference", s.reference]] as Array<[string, string]>) : []),
                      ...(s.caste ? ([["Caste", s.caste]] as Array<[string, string]>) : []),
                    ]}
                  />
                </Panel>
                <div className="grid gap-6">
                  <Panel id="teaching" title="Teaching" description="Levels and subjects; the timetable suggests teachers from this." rise={2} actions={edit ? <Button size="sm" variant="quiet" icon="edit" onClick={() => setEditing("teaching")}>Edit</Button> : undefined}>
                    {s.teachingLevels.length || s.subjects.length ? (
                      <KeyValue
                        items={[
                          ["Levels", s.teachingLevels.join(", ") || "—"],
                          ["Subjects", s.subjects.join(", ") || "—"],
                          ["Class teacher", s.classTeacherOf ?? "—"],
                        ]}
                      />
                    ) : (
                      <p className="m-0 text-small text-ink-muted">Doesn't teach.</p>
                    )}
                  </Panel>
                  <Panel id="this-month" title="Attendance" description={`${hrMonthLabel(s.attendance.month)}${s.attendance.month === THIS_MONTH ? " so far" : ""}`} rise={3}>
                    <dl className="m-0 grid grid-cols-4 gap-3 text-center">
                      {[
                        ["Present", s.attendance.present],
                        ["Late", s.attendance.late],
                        ["Absent", s.attendance.absent],
                        ["Leave", s.attendance.leave],
                      ].map(([k, v]) => (
                        <div key={k as string} className="rounded-md bg-surface-sunken p-2">
                          <dt className="text-small text-ink-muted">{k}</dt>
                          <dd className="m-0 text-title-3 tabular-nums">{v}</dd>
                        </div>
                      ))}
                    </dl>
                    <p className="m-0 mt-3 text-small text-ink-muted">
                      Leave left: {s.leave.filter((b) => b.left !== null && b.entitled && b.entitled <= 14).map((b) => `${b.typeName.replace(" leave", "")} ${b.left}`).join(" · ")}
                    </p>
                  </Panel>
                </div>
              </div>
            )}

            {tab === "employment" && (
              <Panel
                id="postings"
                title="Postings"
                description="Every campus this person has worked at. The main posting pays the salary and keeps the file."
                rise={1}
                actions={edit ? <Button size="sm" icon="plus" onClick={() => setEditing("posting")}>Add posting at another campus</Button> : undefined}
              >
                <ul className="m-0 grid list-none gap-3 p-0">
                  {s.postings.map((p, i) => (
                    <li key={p.id} className="mtb-slide-in grid gap-2 rounded-md border border-border p-4 sm:grid-cols-[1fr_auto]" style={slide(i)}>
                      <div className="grid gap-1">
                        <span className="flex flex-wrap items-center gap-2 font-medium">
                          {p.campusName}
                          {p.primary && <StatusBadge status="brand" dot={false}>Main posting</StatusBadge>}
                          {p.endDate ? <StatusBadge status="cancelled">Ended {formatDate(p.endDate)}</StatusBadge> : <StatusBadge status="success">Current</StatusBadge>}
                        </span>
                        <span className="text-small text-ink-muted">
                          {p.designation} · {p.department} · {HR_EMPLOYMENT_LABEL[p.employmentType]}
                          {p.payScale ? ` · scale ${p.payScale}` : ""}
                          {p.daysPerWeek ? ` · ${p.daysPerWeek} days a week` : ""}
                        </span>
                        <span className="text-small text-ink-muted">
                          From {formatDate(p.startDate)}
                          {p.endDate ? ` to ${formatDate(p.endDate)}${p.endReason ? ` · ${p.endReason}` : ""}` : ""}
                          {p.deviceEnrolNo ? ` · fingerprint machine no. ${p.deviceEnrolNo}` : " · not on the fingerprint machine yet"}
                        </span>
                      </div>
                      {edit && !p.primary && !p.endDate && (
                        <Button size="sm" variant="danger-quiet" onClick={() => setEditing({ end: p.id })}>
                          End posting
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            {tab === "qualifications" && (
              <Panel id="quals" title="Qualifications and experience" rise={1} actions={edit ? <Button size="sm" variant="quiet" icon="edit" onClick={() => setEditing("qualifications")}>Edit</Button> : undefined}>
                <div className="grid gap-6">
                  <Section title="Qualifications">
                    {s.qualifications.length ? (
                      <ul className="m-0 grid list-none gap-2 p-0">
                        {s.qualifications.map((x, i) => (
                          <li key={x.id} className="mtb-slide-in flex flex-wrap items-baseline justify-between gap-2 rounded-md bg-surface-sunken px-3 py-2" style={slide(i)}>
                            <span>
                              <span className="font-medium">{x.degree}</span> <span className="text-ink-muted">· {x.institution}</span>
                            </span>
                            <span className="text-small text-ink-muted">
                              {x.year} · {x.result}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="m-0 text-small text-ink-muted">No qualifications recorded.</p>
                    )}
                  </Section>
                  <Section title="Experience before MTB">
                    {s.experience.length ? (
                      <ul className="m-0 grid list-none gap-2 p-0">
                        {s.experience.map((x) => (
                          <li key={x.id} className="flex flex-wrap justify-between gap-2 rounded-md bg-surface-sunken px-3 py-2">
                            <span>
                              <span className="font-medium">{x.organisation}</span> <span className="text-ink-muted">· {x.role}</span>
                            </span>
                            <span className="text-small text-ink-muted">
                              {formatDate(x.from)} – {formatDate(x.to)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="m-0 text-small text-ink-muted">None recorded.</p>
                    )}
                    <p className="m-0 text-small text-ink-muted">
                      Service for increments: {years(s.serviceYears)}
                      {s.priorServiceYears ? `, including ${years(s.priorServiceYears)} earlier MTB service` : ""}.
                    </p>
                  </Section>
                </div>
              </Panel>
            )}

            {tab === "pay" && payAccess && (
              <PayTab s={s} canEdit={canPayroll && !readOnly && s.status === "ACTIVE"} onEdit={() => setEditing("pay")} onPrintSlip={(runId) => void printSlip(runId)} />
            )}

            {tab === "leave" && (
              <div className="hr-split">
                <Panel id="calendar" title={`Attendance · ${hrMonthLabel(s.attendance.month)}`} description="From the fingerprint machine and the office register." rise={1}>
                  <AttendanceCalendar year={Number(s.attendance.month.slice(0, 4))} month={Number(s.attendance.month.slice(5, 7)) - 1} days={s.attendance.days} holidayNames={s.attendance.holidays} today={TODAY} />
                </Panel>
                <Panel id="balances" title="Leave this session" description="Days allowed, taken and left (2026–27)." rise={2}>
                  <ul className="m-0 grid list-none gap-3 p-0">
                    {s.leave.map((b, i) => (
                      <li key={b.typeId} className="mtb-slide-in grid gap-1" style={slide(i)}>
                        <span className="flex justify-between text-small">
                          <span>{b.typeName}</span>
                          <span className="tabular-nums text-ink-muted">{b.entitled === null ? `${b.taken} taken` : `${b.left} of ${b.entitled} left${b.pending ? ` · ${b.pending} waiting` : ""}`}</span>
                        </span>
                        {b.entitled !== null && (
                          <span className={`hr-meter${b.left !== null && b.left <= 2 ? " is-low" : ""}`} role="progressbar" aria-valuenow={b.taken} aria-valuemin={0} aria-valuemax={b.entitled} aria-label={`${b.typeName}: ${b.taken} of ${b.entitled} days taken`}>
                            <span style={{ width: `${Math.min(100, (b.taken / Math.max(1, b.entitled)) * 100)}%` }} />
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <Link to="/hr/leave" className={buttonClassName({ size: "sm", variant: "quiet", className: "mt-3" })}>
                    Leave requests
                  </Link>
                </Panel>
              </div>
            )}

            {tab === "documents" && (
              <Panel id="docs" title="Documents on file" description="Scanned copies kept with the record. Required documents are marked." rise={1}>
                {s.documents.length === 0 ? (
                  <EmptyState icon="folder" title="No documents" />
                ) : (
                  <ul className="m-0 grid list-none gap-2 p-0">
                    {s.documents.map((d, i) => (
                      <li key={d.id} className="mtb-slide-in flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5" style={slide(i)}>
                        <span className="grid min-w-0">
                          <span className="flex items-center gap-2 font-medium">
                            {d.title}
                            {d.required && <span className="text-small font-normal text-ink-muted">· required</span>}
                          </span>
                          <span className="text-small text-ink-muted">{d.fileName ? `${d.fileName} · ${d.sizeKb} KB · ${d.uploadedBy}${d.uploadedAt ? `, ${formatDate(d.uploadedAt)}` : ""}` : "Not on file yet"}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          {d.status === "ON_FILE" ? <StatusBadge status="success" icon="check">On file</StatusBadge> : <StatusBadge status="warning">Missing</StatusBadge>}
                          {edit && d.status === "ON_FILE" && <IconButton icon="trash" label={`Remove ${d.title}`} onClick={() => removeDoc.mutate(d.id)} />}
                          {edit && d.status === "MISSING" && (
                            <Button
                              size="sm"
                              icon="upload"
                              onClick={() => {
                                setDocKind(d.kind);
                                fileRef.current?.click();
                              }}
                            >
                              Upload
                            </Button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {edit && (
                  <div className="mt-4 flex flex-wrap items-end gap-3">
                    <div className="w-60">
                      <Select label="Add another document" value={docKind} onChange={(e) => setDocKind(e.target.value as HrDocumentKind)} options={(Object.keys(HR_DOCUMENT_LABEL) as HrDocumentKind[]).map((k) => ({ value: k, label: HR_DOCUMENT_LABEL[k] }))} />
                    </div>
                    <Button icon="upload" loading={upload.isPending} onClick={() => fileRef.current?.click()}>
                      Choose file
                    </Button>
                    <span className="text-small text-ink-muted">PDF, JPG or PNG, up to 5 MB.</span>
                  </div>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) upload.mutate(file);
                    e.target.value = "";
                  }}
                />
              </Panel>
            )}

            {tab === "history" && (
              <Panel id="history" title="History" description="Every change to this record, newest first." rise={1}>
                <Timeline label="Record history" items={s.history.map((h) => ({ id: h.id, date: h.at.slice(0, 10), title: h.text, description: `${h.by} · ${formatDateTime(h.at)}${h.detail ? ` · ${h.detail}` : ""}` }))} />
              </Panel>
            )}

            {editing === "personal" && <EditPersonalPanel s={s} onClose={() => setEditing(null)} />}
            {editing === "posting" && settings.data && <AddPostingPanel s={s} settings={settings.data} onClose={() => setEditing(null)} />}
            {editing === "qualifications" && <QualificationsPanel s={s} onClose={() => setEditing(null)} />}
            {editing === "teaching" && settings.data && <TeachingPanel s={s} settings={settings.data} onClose={() => setEditing(null)} />}
            {editing === "pay" && settings.data && s.pay && <PayPanel s={s} settings={settings.data} onClose={() => setEditing(null)} />}
            {editing && typeof editing === "object" && <EndPostingPanel s={s} postingId={editing.end} onClose={() => setEditing(null)} />}

            <ConfirmDialog
              open={leaving}
              onClose={() => setLeaving(false)}
              onConfirm={() => markLeft.mutate()}
              tone="danger"
              icon="logout"
              title={`Mark ${s.name} as left?`}
              message="Their postings end on the last working day. The record, salary history and documents are kept; they drop out of attendance and future salary sheets."
              confirmLabel="Mark as left"
              loading={markLeft.isPending}
              loadingLabel="Saving…"
              error={markLeft.error ? errorText(markLeft.error) : undefined}
            >
              <div className="mt-3 grid gap-3">
                <DatePicker label="Last working day" required value={leftDate} onValueChange={setLeftDate} today={TODAY} />
                <Textarea label="Reason" required rows={2} value={leftReason} onChange={(e) => setLeftReason(e.target.value)} placeholder="Resigned; one month's notice served" />
              </div>
            </ConfirmDialog>
          </>
        )}
        {area}
      </HrShell>
    </RequirePermission>
  );

  async function printSlip(runId: string) {
    try {
      const run = await queryClient.fetchQuery(hrQueries.payrollRun(runId));
      const slip = run.lines.find((l) => l.staffId === staffId);
      if (slip) print(<PayslipDoc run={run} slip={slip} first />, "A5");
    } catch (e) {
      toast({ tone: "danger", title: "Slip couldn't be loaded", message: errorText(e) });
    }
  }
}

function PayTab({ s, canEdit, onEdit, onPrintSlip }: { s: HrStaffProfile; canEdit: boolean; onEdit: () => void; onPrintSlip: (runId: string) => void }) {
  const p = s.pay;
  if (!p) return <Banner tone="info">Pay details are visible to the accountant and the principal.</Banner>;
  const hist = [...p.history].reverse();
  return (
    <div className="hr-split">
      <div className="grid gap-6">
        <Panel id="structure" title="Salary structure" description={p.basic ? "A full month, before absences, loans and child fees." : "No salary set yet."} rise={1} actions={canEdit ? <Button size="sm" icon="edit" onClick={onEdit}>Change pay</Button> : undefined}>
          {p.payrollNote && <Banner tone="info" className="mb-4">{p.payrollNote}</Banner>}
          {p.nextChange && (
            <Banner tone="success" className="mb-4" title={`${p.nextChange.reason === "INCREMENT" ? "Increment" : "New pay"} from ${formatDate(p.nextChange.effectiveFrom)}`}>
              Basic {formatRs(p.nextChange.basic)} ({p.nextChange.change >= 0 ? "+" : ""}
              {formatRs(p.nextChange.change)}) · {p.nextChange.note}
            </Banner>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <table className="w-full text-small">
              <tbody>
                <tr>
                  <td className="py-1">Basic pay{p.payScale ? ` (scale ${p.payScale})` : ""}</td>
                  <td className="py-1 text-right tabular-nums">{formatRs(p.basic)}</td>
                </tr>
                {p.allowances.map((a) => (
                  <tr key={a.code}>
                    <td className="py-1">
                      {a.label}
                      {a.basis && <span className="text-ink-muted"> · {a.basis}</span>}
                    </td>
                    <td className="py-1 text-right tabular-nums">{formatRs(a.amount)}</td>
                  </tr>
                ))}
                <tr className="border-t border-border font-semibold">
                  <td className="py-1">Gross</td>
                  <td className="py-1 text-right tabular-nums">{formatRs(p.gross)}</td>
                </tr>
              </tbody>
            </table>
            <table className="w-full text-small">
              <tbody>
                {p.deductions.map((d) => (
                  <tr key={d.code}>
                    <td className="py-1">
                      {d.label}
                      {d.basis && <span className="text-ink-muted"> · {d.basis}</span>}
                    </td>
                    <td className="py-1 text-right tabular-nums">− {formatRs(d.amount)}</td>
                  </tr>
                ))}
                <tr className="border-t border-border font-semibold">
                  <td className="py-1">Take-home (usual month)</td>
                  <td className="py-1 text-right tabular-nums">{formatRs(p.net)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-4">
            <KeyValue
              items={[
                ["Paid by", `${HR_PAYMENT_LABEL[p.paymentMethod]}${p.bank ? ` · ${p.bank.bankName}, ${p.bank.branch} · ${p.bank.accountTitle} ${p.bank.accountNoMasked}` : ""}`],
                ["EOBI and provident fund", `${p.eobi ? "EOBI" : "No EOBI"} · ${p.providentFund ? "Provident fund" : "No provident fund"}`],
              ]}
            />
          </div>
        </Panel>
        <Panel id="salary-history" title="Salary history" description="Every change to basic pay, with the reason. Increments come from approved increment runs." rise={2}>
          {hist.length > 1 && <Sparkline values={hist.map((h) => h.basic)} label={`Basic pay from ${formatRs(hist[0]!.basic)} to ${formatRs(hist.at(-1)!.basic)}`} height={40} />}
          <ul className="m-0 mt-3 grid list-none gap-1.5 p-0 text-small">
            {p.history.map((h, i) => (
              <li key={h.id} className="mtb-slide-in flex flex-wrap justify-between gap-2" style={slide(i)}>
                <span>
                  {formatDate(h.effectiveFrom)} · {h.note}
                  <span className="text-ink-muted"> · {h.by}</span>
                </span>
                <span className="tabular-nums">
                  {formatRs(h.basic)}
                  {h.change > 0 && <span className="text-success-ink"> (+{formatRs(h.change)})</span>}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <div className="grid gap-6">
        <Panel id="slips" title="Salary slips" description="Last months' slips from the salary sheets." rise={3}>
          {p.recentSlips.length === 0 ? (
            <p className="m-0 text-small text-ink-muted">No salary sheets yet.</p>
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {p.recentSlips.map((r, i) => (
                <li key={r.runId} className="mtb-slide-in flex items-center justify-between gap-2" style={slide(i)}>
                  <span className="grid">
                    <span className="font-medium">{hrMonthLabel(r.month)}</span>
                    <span className="text-small text-ink-muted tabular-nums">{formatRs(r.net)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <RunBadge status={r.status} />
                    <IconButton icon="printer" label={`Print ${hrMonthLabel(r.month)} slip`} onClick={() => onPrintSlip(r.runId)} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel id="loans" title="Loans and advances" rise={4} actions={<Link to="/hr/loans" className={buttonClassName({ size: "sm", variant: "quiet" })}>All loans</Link>}>
          {p.loans.length === 0 ? (
            <p className="m-0 text-small text-ink-muted">No loans or advances.</p>
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {p.loans.map((l) => (
                <li key={l.id} className="grid gap-1 rounded-md bg-surface-sunken px-3 py-2">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {l.loanNo} · {l.typeName}
                    </span>
                    <LoanBadge status={l.status} />
                  </span>
                  <span className="text-small text-ink-muted">
                    {formatRs(l.principal)} · {l.installments} × {formatRs(l.installment)} · {formatRs(l.balance)} left
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        {p.children.length > 0 && (
          <Panel id="children" title="Children at MTB" description="Their monthly fee can be taken from salary instead of paid at the counter." rise={5}>
            <ul className="m-0 grid list-none gap-2 p-0 text-small">
              {p.children.map((c) => (
                <li key={c.grNo} className="flex items-center justify-between gap-2">
                  <span>
                    <span className="font-medium">{c.name}</span> · {c.grNo} · {c.classSection}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums">{formatRs(c.monthlyFee)}</span>
                    {c.adjustAgainstSalary ? <StatusBadge status="info">From salary</StatusBadge> : <StatusBadge status="neutral">At the counter</StatusBadge>}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </div>
  );
}

