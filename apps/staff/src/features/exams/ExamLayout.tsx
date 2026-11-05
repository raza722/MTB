import { ApiError, EXAMS_CATEGORY_LABEL, examsApi, examsQueries, type ExamDetail } from "@mtb/api";
import { formatCount, formatDateTime, formatSession } from "@mtb/domain";
import { Banner, Button, Checkbox, ConfirmDialog, EmptyState, Modal, Skeleton, Textarea, Tooltip, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { campusLabel } from "../../app/shell/campus";
import { Page, PageHeader } from "../../app/shell/page";
import { SubNav } from "../../app/shell/SubNav";
import { useCan, useReadOnly } from "../../app/session";
import { ResultMessagesModal } from "./ResultMessages";
import { errorText, ExamProvider, ExamStatus, examTitle, LoadError } from "./shared";

/** /exams/$examId — the exam's header, declare and reopen actions, and its sub-pages. */
export function ExamLayout({ examId }: { examId: string }) {
  const navigate = useNavigate();
  const detail = useQuery(examsQueries.detail(examId));
  const back = () => void navigate({ to: "/exams" } as never);

  if (detail.isLoading) {
    return (
      <Page>
        <div className="grid gap-2" aria-busy="true">
          <Skeleton width={360} height={30} />
          <Skeleton width={280} />
        </div>
        <Skeleton height={40} />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={110} />
          ))}
        </div>
        <Skeleton height={320} />
      </Page>
    );
  }
  if (!detail.data) {
    const notFound = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <Page>
        {notFound ? (
          <div className="mtb-card">
            <EmptyState icon="exams" title="This exam couldn't be opened" description="It may have been removed, or the link is wrong." action={<Button onClick={back}>Back to exams</Button>} />
          </div>
        ) : (
          <LoadError what="This exam" error={detail.error} onRetry={() => void detail.refetch()} />
        )}
      </Page>
    );
  }
  return <ExamFrame exam={detail.data} />;
}

function ExamFrame({ exam }: { exam: ExamDetail }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const readOnly = useReadOnly();
  const canDeclare = useCan("exams.declare");
  const canSms = useCan("sms.send");
  const [messaging, setMessaging] = useState(false);
  const canDecideReopen = useCan("settings.manage");
  const [confirming, setConfirming] = useState(false);
  const [notify, setNotify] = useState(true);
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);

  const onSaved = (data: ExamDetail) => {
    queryClient.setQueryData(examsQueries.detail(exam.id).queryKey, data);
    void queryClient.invalidateQueries({ queryKey: ["exams"], refetchType: "active" });
    void queryClient.invalidateQueries({ queryKey: ["students", "results"] });
  };

  const declare = useMutation({
    mutationFn: () => examsApi.declare(exam.id, { notifyParents: notify }),
    onSuccess: (data) => {
      onSaved(data);
      setConfirming(false);
      toast({ title: "Results declared", message: `${data.name} · ${data.classes.join(", ")} · now visible in the parent portal${notify && data.category !== "ENTRANCE" ? ". Result messages are queued." : "."}` });
    },
  });
  const requestReopen = useMutation({
    mutationFn: () => examsApi.requestReopen(exam.id, reason),
    onSuccess: (data) => {
      onSaved(data);
      setReopening(false);
      setReason("");
      setTried(false);
      toast({ title: "Reopen requested", message: "An admin has to approve it. The request is logged." });
    },
  });
  const decideReopen = useMutation({
    mutationFn: (decision: "APPROVE" | "REJECT") => examsApi.decideReopen(exam.id, decision),
    onSuccess: (data, decision) => {
      onSaved(data);
      toast(decision === "APPROVE" ? { title: "Results reopened", message: `${data.name} is back to draft. Marks can be corrected and declared again.` } : { tone: "info", title: "Reopen rejected", message: "The results stay declared." });
    },
  });

  const declared = exam.status === "DECLARED";
  const reopenPending = exam.reopen?.status === "PENDING";
  const candidate = exam.candidateLabel ?? "Student";
  const unchecked = (exam.papers ?? []).filter((p) => p.status !== "CHECKED").length;
  const withheld = exam.rows.filter((r) => r.withheld).length;
  const declareBlocked =
    exam.missingMarks > 0 ? `${formatCount(exam.missingMarks)} ${exam.missingMarks === 1 ? "mark is" : "marks are"} missing. The exam office must complete them first.` : readOnly ? "Past sessions are read-only." : null;
  const base = `/exams/${exam.id}`;

  return (
    <ExamProvider exam={exam}>
      <Page>
        <div>
          <Link to="/exams" className="inline-flex items-center gap-1 text-small font-medium text-brand-ink underline-offset-2 hover:underline">
            ← All exams
          </Link>
        </div>
        <PageHeader
          title={examTitle(exam)}
          context={`${campusLabel(exam.campus)} · Session ${formatSession(exam.session)} · ${exam.typeName ?? EXAMS_CATEGORY_LABEL[exam.category]} · ${exam.classes.join(", ")}`}
          meta={<ExamStatus exam={exam} />}
          actions={
            <>
              {declared && canSms && !readOnly && exam.category !== "ENTRANCE" && !exam.programmeId && (
                <Button icon="send" onClick={() => setMessaging(true)}>
                  Send result messages
                </Button>
              )}
              {declared && canDeclare && !reopenPending && !readOnly && (
                <Button icon="unlock" onClick={() => setReopening(true)}>
                  Request reopen
                </Button>
              )}
              {reopenPending && canDecideReopen && !readOnly && (
                <>
                  <Button variant="danger-quiet" loading={decideReopen.isPending && decideReopen.variables === "REJECT"} onClick={() => decideReopen.mutate("REJECT")}>
                    Reject reopen
                  </Button>
                  <Button variant="primary" icon="unlock" loading={decideReopen.isPending && decideReopen.variables === "APPROVE"} onClick={() => decideReopen.mutate("APPROVE")}>
                    Approve reopen
                  </Button>
                </>
              )}
              {!declared &&
                canDeclare &&
                (declareBlocked ? (
                  <Tooltip content={declareBlocked}>
                    {/* A focusable wrapper so the reason is reachable by keyboard while the button is disabled. */}
                    <span tabIndex={0} className="inline-flex rounded-md" aria-label={`Declare results — not available: ${declareBlocked}`}>
                      <Button variant="primary" icon="lock" disabled tabIndex={-1}>
                        Declare results
                      </Button>
                    </span>
                  </Tooltip>
                ) : (
                  <Button variant="primary" icon="lock" onClick={() => setConfirming(true)}>
                    Declare results
                  </Button>
                ))}
            </>
          }
        />
        <SubNav
          label="This exam"
          items={[
            { to: base, label: "Overview", icon: "dashboard", exact: true },
            { to: `${base}/marks`, label: "Marks entry", icon: "edit" },
            { to: `${base}/results`, label: "Results", icon: "listChecks" },
            { to: `${base}/analysis`, label: "Analysis", icon: "trendUp" },
            { to: `${base}/print`, label: "Print", icon: "printer" },
          ]}
        />

        {reopenPending && exam.reopen && (
          <Banner tone="warning" title="Reopen requested — waiting for admin approval.">
            {exam.reopen.requestedBy} on <span className="mtb-num">{formatDateTime(exam.reopen.requestedAt)}</span>: “{exam.reopen.reason}”
          </Banner>
        )}
        {(decideReopen.isError || declare.isError) && !confirming && <Banner tone="danger">{errorText(decideReopen.error ?? declare.error)}</Banner>}

        <Outlet />

        {messaging && <ResultMessagesModal exam={exam} onClose={() => setMessaging(false)} />}

        <ConfirmDialog
          open={confirming}
          onClose={() => {
            if (!declare.isPending) setConfirming(false);
          }}
          onConfirm={() => declare.mutate()}
          title={`Declare ${exam.name} results?`}
          message="Results become read-only and appear in the parent portal. Grades and positions are frozen. Reopening needs admin approval and is logged."
          details={[
            ["Exam", `${exam.name} · ${exam.typeName ?? EXAMS_CATEGORY_LABEL[exam.category]}`],
            ["Classes", exam.classes.join(", ")],
            [`${candidate}s`, formatCount(exam.students)],
            ["Missing marks", formatCount(exam.missingMarks)],
            ...(withheld ? ([["Withheld results", formatCount(withheld)]] as Array<[string, string]>) : []),
          ]}
          warning={unchecked > 0 ? `${unchecked} ${unchecked === 1 ? "paper has" : "papers have"} not been ticked as checked by the exam office yet. You can still declare.` : undefined}
          confirmLabel="Declare results"
          requireText="DECLARE"
          loading={declare.isPending}
          loadingLabel="Declaring…"
          error={declare.isError ? errorText(declare.error) : undefined}
        >
          {exam.category !== "ENTRANCE" && <Checkbox label="Also send each family a result message (SMS and app notification)" checked={notify} onChange={(e) => setNotify(e.target.checked)} />}
        </ConfirmDialog>

        <Modal
          open={reopening}
          onClose={() => {
            if (!requestReopen.isPending) setReopening(false);
          }}
          title="Request to reopen results"
          description={`${exam.name} · ${exam.classes.join(", ")}`}
          footer={
            <>
              <Button onClick={() => setReopening(false)} disabled={requestReopen.isPending}>
                Cancel
              </Button>
              <Button
                variant="primary"
                icon="send"
                loading={requestReopen.isPending}
                onClick={() => {
                  setTried(true);
                  if (reason.trim().length >= 10) requestReopen.mutate();
                }}
              >
                Send request
              </Button>
            </>
          }
        >
          <div className="grid gap-4">
            <p className="m-0 text-ink-muted">Declared results stay visible to parents until an admin approves the request. The request and the decision are logged.</p>
            <Textarea
              label="Why do the results need to be reopened?"
              required
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="For example: Science marks for 8-B were entered out of 75 instead of 100."
              error={tried && reason.trim().length < 10 ? "Say in a sentence what is wrong (at least 10 characters)." : requestReopen.isError ? errorText(requestReopen.error) : undefined}
            />
          </div>
        </Modal>
      </Page>
    </ExamProvider>
  );
}
