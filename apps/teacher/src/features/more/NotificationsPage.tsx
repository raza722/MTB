import { teacherApi, teacherQueries, type TeacherNotification, type TeacherNotificationKind } from "@mtb/api";
import { formatDate, formatTime } from "@mtb/domain";
import { Button, EmptyState, Icon, Skeleton, cx, type IconName } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { useCtx } from "../../app/session";
import { QueryState } from "../../app/shell/QueryState";
import { Screen } from "../../app/shell/Screen";
import { useOnline } from "../../app/sync/network";

const KIND: Record<TeacherNotificationKind, { icon: IconName; cls: string; label: string }> = {
  ATTENDANCE: { icon: "attendance", cls: "bg-status-present-tint text-status-present-ink", label: "Attendance" },
  MARKS: { icon: "exams", cls: "bg-brand-tint text-brand-ink", label: "Marks" },
  CALENDAR: { icon: "calendar", cls: "bg-status-holiday-tint text-status-holiday-ink", label: "Calendar" },
  LEAVE: { icon: "user", cls: "bg-status-leave-tint text-status-leave-ink", label: "Leave" },
  NOTICE: { icon: "info", cls: "bg-info-tint text-info-ink", label: "Notice" },
};

export function NotificationsPage() {
  const ctx = useCtx();
  const q = useQuery(teacherQueries.notifications(ctx));
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const online = useOnline();
  const read = useMutation({
    mutationFn: (ids?: string[]) => teacherApi.markRead(ctx, ids),
    onMutate: (ids) => {
      queryClient.setQueryData(teacherQueries.notifications(ctx).queryKey, (list) => list?.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)));
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: teacherQueries.all(ctx) }),
  });
  const unread = q.data?.filter((n) => !n.read).length ?? 0;

  const open = (n: TeacherNotification) => {
    if (!n.read && online) read.mutate([n.id]);
    if (n.link) void navigate({ to: n.link as never });
  };

  return (
    <Screen
      title="Notifications"
      subtitle={unread ? `${unread} unread` : "All read"}
      documentTitle="Notifications"
      backTo="/more"
      actions={
        unread > 0 ? (
          <Button size="sm" variant="ghost" disabled={!online} onClick={() => read.mutate(undefined)}>
            Mark all read
          </Button>
        ) : undefined
      }
    >
      <QueryState
        query={q}
        skeleton={
          <div className="grid gap-2" aria-busy="true" aria-label="Loading notifications">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={84} className="rounded-lg" />
            ))}
          </div>
        }
      >
        {(list) =>
          list.length === 0 ? (
            <div className="mtb-card p-2">
              <EmptyState icon="bell" title="No notifications" description="Approvals, marks reminders and school notices appear here." />
            </div>
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {list.map((n, i) => {
                const k = KIND[n.kind];
                return (
                  <li key={n.id} className="mtb-slide-in" style={{ "--i": i } as CSSProperties}>
                    <button
                      type="button"
                      onClick={() => open(n)}
                      className={cx("mtb-card flex w-full items-start gap-3 p-4 text-start hover:border-border-strong", !n.read && "border-brand")}
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
          )
        }
      </QueryState>
    </Screen>
  );
}
