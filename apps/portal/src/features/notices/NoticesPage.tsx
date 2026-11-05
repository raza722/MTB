import { portalApi, portalQueries, type PortalNotice, type PortalNotices } from "@mtb/api";
import { Button, cx, EmptyState, Icon, Segmented, Skeleton, StatusBadge, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { DateL } from "../../app/format";
import { Ltr, useLang } from "../../app/i18n";
import { PageHeader, QueryState } from "../../app/shell/page";
import { useChild } from "../../app/session";

/** Dates, amounts, times and numbers inside a notice keep reading left to right in Urdu text. */
const LTR_PIECE = /(\d{1,2}-[A-Z][a-z]{2}-\d{4}|Rs\.? ?[\d,]+|\d{1,2}:\d{2}(?: ?[AP]M)?|\d{4}-\d{7}|[A-Z]{2}-\d{3,6}|\d+(?:[-–]\d+)*)/g;

export function isolateLtr(text: string): ReactNode {
  const parts = text.split(LTR_PIECE);
  return parts.map((p, i) => (i % 2 === 1 ? <Ltr key={i}>{p}</Ltr> : <Fragment key={i}>{p}</Fragment>));
}

function NoticeCard({ n, i, open, onToggle }: { n: PortalNotice; i: number; open: boolean; onToggle: () => void }) {
  const { t, rich, pick, name, isUr } = useLang();
  const title = pick(n.title, n.titleUr);
  const body = pick(n.body, n.bodyUr);
  return (
    <li id={n.id} className="mtb-slide-in scroll-mt-24" style={{ "--i": i } as CSSProperties}>
      <article className={cx("mtb-card grid gap-2 p-4 lg:p-5", !n.read && "border-brand/40")} aria-labelledby={`${n.id}-title`}>
        <div className="flex items-start gap-3">
          <span className={cx("mt-2.5", n.read ? "size-2" : "portal-unread-dot")} aria-hidden="true" />
          <div className="grid min-w-0 flex-1 gap-1">
            <div className="flex flex-wrap items-center gap-2">
              {!n.read && <StatusBadge status="brand">{t("not.new")}</StatusBadge>}
              {n.pinned && (
                <StatusBadge status="neutral" icon="star">
                  {t("not.pinned")}
                </StatusBadge>
              )}
              <StatusBadge status="info" dot={false}>
                {t(`not.cat.${n.category}`)}
              </StatusBadge>
            </div>
            <h2 id={`${n.id}-title`} className={cx("m-0 text-title-3 text-ink", n.read && "font-medium")}>
              {isUr ? isolateLtr(title) : title}
            </h2>
            <p className="m-0 flex flex-wrap gap-x-3 text-small text-ink-muted">
              <span className="inline-flex items-center gap-1">
                <Icon name="calendar" size={14} />
                {rich("not.about", { date: <DateL value={n.date} /> })}
              </span>
              <span>{rich("not.posted", { date: <DateL value={n.publishedAt} />, by: name(n.publishedBy, n.publishedByUr) })}</span>
            </p>
          </div>
        </div>
        <div className="ps-5">
          <p id={`${n.id}-body`} className={cx("m-0 text-ink", !open && "line-clamp-2")}>
            {isUr ? isolateLtr(body) : body}
          </p>
          <Button variant="quiet" size="sm" className="-ms-2 mt-1" aria-expanded={open} aria-controls={`${n.id}-body`} onClick={onToggle}>
            {open ? t("not.less") : t("not.read")}
          </Button>
        </div>
      </article>
    </li>
  );
}

function NoticesBody({ data, grNo }: { data: PortalNotices; grNo: string }) {
  const { t, pick } = useLang();
  const queryClient = useQueryClient();
  const toast = useToast();
  const location = useLocation();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [open, setOpen] = useState<string | null>(() => (location.hash ? location.hash.replace(/^#/, "") : null));

  const setRead = (ids: string[] | "all") =>
    queryClient.setQueryData<PortalNotices>(portalQueries.notices(grNo).queryKey, (prev) =>
      prev ? { ...prev, notices: prev.notices.map((n) => (ids === "all" || ids.includes(n.id) ? { ...n, read: true } : n)), unread: ids === "all" ? 0 : prev.notices.filter((n) => !n.read && !ids.includes(n.id)).length } : prev,
    );

  const markOne = useMutation({
    mutationFn: (id: string) => portalApi.markNoticeRead(grNo, id),
    onMutate: (id) => setRead([id]),
    onSettled: () => queryClient.invalidateQueries({ queryKey: portalQueries.child(grNo) }),
  });
  const markAll = useMutation({
    mutationFn: () => portalApi.markAllNoticesRead(grNo),
    onSuccess: () => {
      setRead("all");
      toast({ tone: "success", title: t("not.markedAll") });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: portalQueries.child(grNo) }),
  });

  // Opened from a link on Home (#notice-id): scroll to it and count it as read.
  useEffect(() => {
    if (!open) return;
    document.getElementById(open)?.scrollIntoView({ block: "start" });
    const n = data.notices.find((x) => x.id === open);
    if (n && !n.read) markOne.mutate(n.id);
  }, []); // only on arrival

  const shown = filter === "unread" ? data.notices.filter((n) => !n.read) : data.notices;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          touch
          aria-label={t("not.title")}
          value={filter}
          onChange={(v) => setFilter(v as "all" | "unread")}
          options={[
            { value: "all", label: t("not.all") },
            {
              value: "unread",
              label: (
                <>
                  {t("not.unread")} <Ltr className="tabular-nums">({data.unread})</Ltr>
                </>
              ),
            },
          ]}
        />
        {data.unread > 0 && (
          <Button variant="secondary" size="touch" icon="checkSquare" loading={markAll.isPending} onClick={() => markAll.mutate()}>
            {t("not.markAll")}
          </Button>
        )}
      </div>
      {shown.length === 0 ? (
        <div className="mtb-card">
          <EmptyState
            icon={filter === "unread" ? "checkCircle" : "bell"}
            title={filter === "unread" ? t("not.noneUnread") : t("not.none")}
            {...(filter === "all" ? { description: t("not.noneDesc", { child: pick(data.child.name, data.child.nameUr) }) } : {})}
          />
        </div>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 lg:max-w-[820px]">
          {shown.map((n, i) => (
            <NoticeCard
              key={n.id}
              n={n}
              i={i}
              open={open === n.id}
              onToggle={() => {
                const next = open === n.id ? null : n.id;
                setOpen(next);
                if (next && !n.read) markOne.mutate(n.id);
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Notices from the child's campus for the child's class: published ones only, newest first, unread marked. */
export function NoticesPage() {
  const child = useChild()!;
  const { t, rich, pick } = useLang();
  const notices = useQuery(portalQueries.notices(child.grNo));
  return (
    <div key={child.grNo}>
      <PageHeader title={t("not.title")} description={rich("not.desc", { campus: pick(child.campusName, child.campusNameUr), child: pick(child.name, child.nameUr) })} />
      <QueryState
        query={notices}
        skeleton={
          <div className="grid gap-3" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="mtb-card grid gap-2 p-5">
                <Skeleton width={120} />
                <Skeleton width="70%" height={18} />
                <Skeleton width="95%" />
              </div>
            ))}
          </div>
        }
      >
        {(data) => <NoticesBody data={data} grNo={child.grNo} />}
      </QueryState>
    </div>
  );
}
