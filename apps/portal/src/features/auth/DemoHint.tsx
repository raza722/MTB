import { portalQueries, type PortalAccountKind } from "@mtb/api";
import { formatMobile } from "@mtb/domain";
import { useQuery } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { Ltr, useLang } from "../../app/i18n";

/** Mock mode only: the fictional families and students, and the one-time code, from the mock server's fixtures. */
export default function DemoHint({ onPick }: { onPick: (kind: PortalAccountKind, value: string) => void }) {
  const { t, rich } = useLang();
  const demo = useQuery(portalQueries.demo()).data;
  if (!demo) return null;
  return (
    <section className="mtb-card mtb-rise grid gap-3 p-4" style={{ "--i": 2 } as CSSProperties} aria-labelledby="demo-accounts">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="demo-accounts" className="m-0 text-title-3">
          {t("demo.title")}
        </h2>
        <span className="text-small text-ink-muted">{rich("demo.code", { code: <Ltr mono className="text-ink">{demo.code}</Ltr> })}</span>
      </div>
      <div className="grid gap-1">
        <h3 className="m-0 text-caption text-ink-subtle uppercase">{t("demo.parents")}</h3>
        <ul className="m-0 grid list-none gap-1 p-0">
          {demo.parents.map((p) => (
            <li key={p.mobile}>
              <button type="button" onClick={() => onPick("PARENT", formatMobile(p.mobile))} className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-start hover:bg-surface-hover">
                <span className="grid min-w-0">
                  <span className="font-medium text-ink">{p.name}</span>
                  <span className="truncate text-small text-ink-muted">{p.children.join(" · ")}</span>
                </span>
                <Ltr mono className="text-small text-ink-muted">
                  {formatMobile(p.mobile)}
                </Ltr>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="grid gap-1">
        <h3 className="m-0 text-caption text-ink-subtle uppercase">{t("demo.students")}</h3>
        <ul className="m-0 grid list-none gap-1 p-0">
          {demo.students.map((s) => (
            <li key={s.grNo}>
              <button type="button" onClick={() => onPick("STUDENT", s.grNo)} className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-start hover:bg-surface-hover">
                <span className="grid min-w-0">
                  <span className="font-medium text-ink">{s.name}</span>
                  <span className="truncate text-small text-ink-muted">
                    <Ltr>{s.classSection}</Ltr> · {s.campusName}
                  </span>
                </span>
                <Ltr mono className="text-small text-ink-muted">
                  {s.grNo}
                </Ltr>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <p className="m-0 text-small text-ink-muted">{t("demo.note")}</p>
    </section>
  );
}
