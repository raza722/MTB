import { notificationsApi, notificationsQueries } from "@mtb/api";
import { MenuItem, MenuLabel } from "@mtb/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

/**
 * The staff bell's report items (GET /notifications, polled every 15 s): "… is ready", "… could not be prepared",
 * "Scheduled report sent: …". Only for users who may open reports (`enabled`); nobody else gets report notifications.
 * Kept apart from the report centre's pages so the shell does not load their styles.
 */
export function ReportNotificationItems({ enabled }: { enabled: boolean }) {
  const q = useQuery({ ...notificationsQueries.list(), enabled });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = (q.data ?? []).slice(0, 5);
  if (!enabled || !list.length) return null;
  return (
    <>
      <MenuLabel>Reports</MenuLabel>
      {list.map((n) => (
        <MenuItem
          key={n.id}
          icon={n.kind === "REPORT_FAILED" ? "alertCircle" : "download"}
          onSelect={() => {
            if (!n.read) void notificationsApi.markRead(n.id).then(() => queryClient.invalidateQueries({ queryKey: notificationsQueries.list().queryKey }));
            // The link may carry a query ("/reports/fee-receipt-register?job=12"): navigate by href so it is parsed.
            if (n.link) void navigate({ href: n.link } as never);
          }}
        >
          {n.read ? n.title : <b>{n.title}</b>}
        </MenuItem>
      ))}
      <MenuItem icon="download" onSelect={() => void navigate({ to: "/reports/jobs" } as never)}>
        All downloads
      </MenuItem>
    </>
  );
}

/** Unread report notifications, for the bell's badge (0 when `enabled` is false). */
export function useReportNotificationCount(enabled: boolean): number {
  const q = useQuery({ ...notificationsQueries.list(), enabled });
  return enabled ? (q.data ?? []).filter((n) => !n.read).length : 0;
}
