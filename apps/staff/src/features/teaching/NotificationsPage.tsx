import { teacherApi, teacherQueries, type TeacherNotification, type TeacherNotificationKind } from "@mtb/api";
import { formatDate, formatTime } from "@mtb/domain";
import { Button, EmptyState, Icon, Panel, Skeleton, cx, useToast, type IconName } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { useCtx } from "../../app/session";
import { Page, PageHeader } from "../../app/shell/page";
import { errorText, QueryState, teachingPath } from "./shared";

const KIND: Record<TeacherNotificationKind, { icon: IconName; cls: string; label: string }> = {
  ATTENDANCE: { icon: "attendance", cls: "bg-status-present-tint text-status-present-ink", label: "Attendance" },
  MARKS: { icon: "exams", cls: "bg-brand-tint text-brand-ink", label: "Marks" },
  CALENDAR: { icon: "calendar", cls: "bg-status-holiday-tint text-status-holiday-ink", label: "Calendar" },
  LEAVE: { icon: "user", cls: "bg-status-leave-tint text-status-leave-ink", label: "Leave" },
  NOTICE: { icon: "info", cls: "bg-info-tint text-info-ink", label: "Notice" },
};

/** /teaching/notifications — approvals, marks reminders, calendar changes, leave decisions and school notices. */
export function NotificationsPage() {
  const ctx = useCtx();
  const q = useQuery(teacherQueries.notifications(ctx));
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const read = useMutation({
    mutationFn: (ids?: string[]) => teacherApi.markRead(ctx, ids),
    onMutate: (ids) => {
      queryClient.setQueryData(teacherQueries.notifications(ctx).queryKey, (list) => list?.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)));
    },
    onError: (e) => toast({ tone: "danger", title: "Not marked as read", message: errorText(e) }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: teacherQueries.all(ctx) }),
  });
  const unread = q.data?.filter((n) => !n.read).length ?? 0;

  const open = (n: TeacherNotification) => {
    if (!n.read) read.mutate([n.id]);
    if (n.link) void navigate({ to: teachingPath(n.link) as never });
  };

  return (
    <Page>
      <PageHeader
        title="Notifications"
        {...(q.data ? { meta: <span className="text-small text-ink-muted">{unread ? `${unread} unread` : "All read"}</span> } : {})}
        {...(unread > 0
          ? {
              actions: (
                <Button icon="checkCircle" onClick={() => read.mutate(undefined)}>
                  Mark all read
                </Button>
              ),
            }
          : {})}
      />
      <QueryState
        query={q}
        what="Notifications"
        skeleton={
          <div className="grid gap-2" aria-busy="true" aria-label="Loading notifications">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={72} className="rounded-lg" />
            ))}
          </div>
        }
      >
        {(list) =>
          list.length === 0 ? (
            <div className="mtb-card">
              <EmptyState icon="bell" title="No notifications" description="Approvals, marks reminders and school notices appear here." />
            </div>
          ) : (
            <Panel id="teacher-notifications" title="Latest first" flush>
              <ul className="m-0 grid list-none p-0">
                {list.map((n, i) => {
                  const k = KIND[n.kind];
                  return (
                    <li key={n.id} className="mtb-slide-in border-t border-border first:border-t-0" style={{ "--i": i } as CSSProperties}>
                      <button
                        type="button"
                        onClick={() => open(n)}
                        className={cx("flex w-full items-start gap-3 px-5 py-3 text-start hover:bg-surface-hover")}
                        aria-label={`${n.read ? "" : "Unread. "}${k.label}: ${n.title}. ${n.body ?? ""}`}
                      >
                        <span className={cx("grid size-10 shrink-0 place-items-center rounded-md", k.cls)}>
                          <Icon name={k.icon} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-start gap-2">
                            <span className={cx("min-w-0 flex-1 text-ink", n.read ? "font-medium" : "font-semibold")}>{n.title}</span>
                            {!n.read && <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />}
                          </span>
                          {n.body && <span className="mt-0.5 block text-small text-ink-muted">{n.body}</span>}
                          <span className="mt-1 block text-caption text-ink-muted">
                            {k.label} · <bdi dir="ltr">{formatDate(n.at)}</bdi>, <bdi dir="ltr">{formatTime(n.at)}</bdi>
                          </span>
                        </span>
                        {n.link && <Icon name="chevronRight" size={18} className="mt-2 shrink-0 text-ink-muted" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )
        }
      </QueryState>
    </Page>
  );
}
