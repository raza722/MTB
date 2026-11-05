import type { PortalChild } from "@mtb/api";
import { Avatar, BottomSheet, cx, Icon, StatusBadge } from "@mtb/ui";
import { useState, type CSSProperties } from "react";
import { Cls, Money } from "../format";
import { useLang } from "../i18n";
import { useAccount, useChild, useSwitchChild } from "../session";

function ChildLine({ c }: { c: PortalChild }) {
  const { pick, rich } = useLang();
  return (
    <span className="truncate text-small text-ink-muted">
      {rich("common.class", { cls: <Cls value={c.classSection} /> })} · {pick(c.campusName, c.campusNameUr)}
    </span>
  );
}

function DueBadge({ c }: { c: PortalChild }) {
  const { rich, t, lang } = useLang();
  return c.due > 0 ? (
    <StatusBadge status={c.feeStatus === "overdue" ? "overdue" : "unpaid"}>{rich("shell.childDue", { amount: <Money value={c.due} /> })}</StatusBadge>
  ) : (
    <StatusBadge status="paid" lang={lang}>
      {t("shell.childClear")}
    </StatusBadge>
  );
}

/**
 * The child at the top of every page. A parent with several children switches here (a bottom sheet on a phone, a row
 * of chips on a computer); a student, or a parent with one child, just sees the name.
 */
export function ChildSwitcher() {
  const account = useAccount();
  const child = useChild();
  const switchTo = useSwitchChild();
  const { t, pick, name } = useLang();
  const [open, setOpen] = useState(false);
  if (!child) return null;
  const many = account.children.length > 1;

  const current = (
    <>
      <Avatar name={child.name} size="sm" />
      <span className="grid min-w-0 text-start">
        <span className="truncate font-semibold text-ink">{name(child.name, child.nameUr)}</span>
        <ChildLine c={child} />
      </span>
    </>
  );

  return (
    <>
      {/* Phone (and a computer with one child): the current child, tap to switch. */}
      {many ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label={`${t("shell.switchChild")}: ${pick(child.name, child.nameUr)}`}
          className="flex min-h-11 min-w-0 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-surface-hover lg:hidden"
        >
          {current}
          <Icon name="chevronDown" size={18} className="shrink-0 text-ink-muted" />
        </button>
      ) : (
        <div className="flex min-w-0 items-center gap-2 px-1.5">{current}</div>
      )}

      {/* Computer: every child as a chip. */}
      {many && (
        <div role="group" aria-label={t("shell.childrenLabel")} className="hidden min-w-0 items-center gap-2 lg:flex">
          {account.children.map((c) => {
            const active = c.grNo === child.grNo;
            return (
              <button
                key={c.grNo}
                type="button"
                aria-pressed={active}
                onClick={() => switchTo(c.grNo)}
                className={cx(
                  "flex min-h-11 items-center gap-2 rounded-full border px-2 py-1 pe-3 transition-colors",
                  active ? "border-brand bg-brand-tint text-brand-ink" : "border-border bg-surface-raised text-ink hover:bg-surface-hover",
                )}
              >
                <Avatar name={c.name} size="sm" />
                <span className="grid text-start leading-tight">
                  <span className="font-semibold">{name(c.name, c.nameUr)}</span>
                  <span className="text-caption text-ink-muted">
                    <Cls value={c.classSection} /> · {pick(c.campusName, c.campusNameUr)}
                  </span>
                </span>
                {c.due > 0 && <span className={cx("size-2 rounded-full", c.feeStatus === "overdue" ? "bg-status-overdue" : "bg-status-unpaid")} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}

      <BottomSheet open={open} onClose={() => setOpen(false)} title={t("shell.chooseChild")} description={t("shell.chooseChildDesc")}>
        <ul className="m-0 grid list-none gap-2 p-0">
          {account.children.map((c, i) => {
            const active = c.grNo === child.grNo;
            return (
              <li key={c.grNo} className="mtb-slide-in" style={{ "--i": i } as CSSProperties}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    switchTo(c.grNo);
                    setOpen(false);
                  }}
                  className={cx(
                    "flex w-full items-center gap-3 rounded-lg border p-3 text-start transition-colors",
                    active ? "border-brand bg-brand-tint" : "border-border bg-surface-raised hover:bg-surface-hover",
                  )}
                >
                  <Avatar name={c.name} />
                  <span className="grid min-w-0 flex-1 gap-1">
                    <span className="truncate font-semibold text-ink">{name(c.name, c.nameUr)}</span>
                    <ChildLine c={c} />
                    <span>
                      <DueBadge c={c} />
                    </span>
                  </span>
                  {active && <Icon name="checkCircle" size={22} className="shrink-0 text-brand-ink" />}
                </button>
              </li>
            );
          })}
        </ul>
      </BottomSheet>
    </>
  );
}
