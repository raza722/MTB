import type { ComponentProps, ReactNode } from "react";
import { Icon, type IconName } from "../icons";
import { cx } from "../lib/cx";

export type FeeStatus = "paid" | "unpaid" | "overdue" | "cancelled";
export type AttendanceStatus = "present" | "absent" | "leave" | "late" | "holiday";
export type ResultStatus = "draft" | "declared";
/** MTB addition: approved and rejected (pending is in the design system). */
export type ApprovalStatus = "pending" | "approved" | "rejected";
/** MTB addition: sent and optedout (queued, delivered, failed are in the design system). */
export type SmsStatus = "queued" | "sent" | "delivered" | "failed" | "optedout";
export type SignalStatus = "success" | "warning" | "danger" | "info" | "neutral" | "brand";
export type Status = FeeStatus | AttendanceStatus | ResultStatus | ApprovalStatus | SmsStatus | SignalStatus;

export const STATUS_LABEL: Record<Status, string> = {
  paid: "Paid",
  unpaid: "Unpaid",
  overdue: "Overdue",
  cancelled: "Cancelled",
  present: "Present",
  absent: "Absent",
  leave: "Leave",
  late: "Late",
  holiday: "Holiday",
  draft: "Draft",
  declared: "Declared",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  queued: "Queued",
  sent: "Sent",
  delivered: "Delivered",
  failed: "Failed",
  optedout: "Opted out",
  success: "Success",
  warning: "Warning",
  danger: "Error",
  info: "Info",
  neutral: "—",
  brand: "",
};

/** Urdu labels for the statuses parents see in the portal. */
export const STATUS_LABEL_UR: Partial<Record<Status, string>> = {
  paid: "ادا شدہ",
  unpaid: "غیر ادا شدہ",
  overdue: "زائد المیعاد",
  cancelled: "منسوخ",
  present: "حاضر",
  absent: "غیر حاضر",
  leave: "رخصت",
  late: "تاخیر",
  holiday: "تعطیل",
  draft: "مسودہ",
  declared: "اعلان شدہ",
};

/** The attendance letters used in registers and calendars. */
export const ATTENDANCE_LETTER: Record<AttendanceStatus, string> = { present: "P", absent: "A", leave: "L", late: "LT", holiday: "H" };

const QUIET = new Set<Status>(["draft", "cancelled", "neutral", "holiday", "optedout"]);

export interface StatusBadgeProps extends Omit<ComponentProps<"span">, "children"> {
  status: Status;
  /** Overrides the status word. */
  children?: ReactNode;
  size?: "lg";
  /** Coloured dot before the word; omitted on quiet states. */
  dot?: boolean;
  /** MTB addition: an icon instead of the dot, e.g. lock on Declared. */
  icon?: IconName;
  /** "ur" shows the Urdu label, right-to-left. */
  lang?: "en" | "ur";
}

/** The one way to show a status. Never invent a colour for a status or use a badge as a button. */
export function StatusBadge({ status, children, size, dot = true, icon, lang, className, ...rest }: StatusBadgeProps) {
  const cls = status === "delivered" ? "success" : status;
  const label = children ?? (lang === "ur" ? STATUS_LABEL_UR[status] : undefined) ?? STATUS_LABEL[status];
  return (
    <span
      className={cx("mtb-badge", `mtb-badge-${cls}`, size === "lg" && "mtb-badge-lg", className)}
      lang={lang === "ur" ? "ur" : undefined}
      dir={lang === "ur" ? "rtl" : undefined}
      {...rest}
    >
      {icon ? <Icon name={icon} /> : dot && !QUIET.has(status) && <span className="mtb-badge-dot" aria-hidden="true" />}
      {label}
    </span>
  );
}
