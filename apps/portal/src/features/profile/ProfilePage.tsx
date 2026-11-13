import { portalApi, portalQueries, type PortalLang, type PortalProfile } from "@mtb/api";
import { Avatar, Button, buttonClassName, Icon, KeyValue, Panel, Segmented, Skeleton, Urdu, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { setTheme, useTheme, type ThemeChoice } from "../../app/appearance";
import { ClockTime, Cls, DateL, DateTimeL, NONE, Phone, SessionL } from "../../app/format";
import { Ltr, useLang } from "../../app/i18n";
import { PageHeader, QueryState } from "../../app/shell/page";
import { useSignOut } from "../../app/shell/PortalShell";
import { useAccount, useChild, useSwitchChild } from "../../app/session";

function StudentPanel({ p }: { p: PortalProfile }) {
  const { t, pick, name, isUr } = useLang();
  const c = p.child;
  return (
    <Panel id="prof-student" title={t("prof.student")} rise={0}>
      <div className="mb-4 flex items-center gap-3">
        <Avatar name={c.name} size="lg" />
        <div className="grid min-w-0">
          <span className="text-title-2 text-ink">{name(c.name, c.nameUr)}</span>
          {isUr ? (
            <Ltr className="text-small text-ink-muted">{c.name}</Ltr>
          ) : (
            c.nameUr && (
              <Urdu size="small" className="text-ink-muted">
                {c.nameUr}
              </Urdu>
            )
          )}
        </div>
      </div>
      <KeyValue
        items={[
          [t("prof.gr"), <Ltr mono key="gr">{c.grNo}</Ltr>],
          [t("prof.class"), <Cls key="cls" value={c.classSection} />],
          [t("prof.roll"), c.rollNo > 0 ? <Ltr key="roll" className="tabular-nums">{c.rollNo}</Ltr> : NONE],
          ...(c.house ? ([[t("prof.house"), pick(c.house, c.houseUr)]] as Array<[string, string]>) : []),
          [t("prof.campus"), pick(c.campusName, c.campusNameUr)],
          [t("prof.session"), <SessionL key="s" value={c.session} />],
          [t("prof.dob"), <DateL key="dob" value={c.dob} />],
          [t("prof.admitted"), <DateL key="adm" value={c.admissionDate} />],
          [t("prof.father"), name(c.father, c.fatherUr)],
          ...(c.mother ? ([[t("prof.mother"), name(c.mother, c.motherUr)]] as Array<[string, ReactNode]>) : []),
        ]}
      />
    </Panel>
  );
}

function GuardianPanel({ p }: { p: PortalProfile }) {
  const { t, name, rich } = useLang();
  const g = p.guardian;
  return (
    <Panel id="prof-guardian" title={t("prof.guardian")} rise={1}>
      <KeyValue
        items={[
          [t("prof.name"), name(g.name, g.nameUr)],
          [t("prof.mobile"), <Phone key="m" value={g.mobile} />],
          [t("prof.address"), g.address ? name(g.address) : NONE],
        ]}
      />
      <p className="m-0 mt-4 flex items-start gap-2 text-small text-ink-muted">
        <Icon name="info" size={16} className="mt-1 shrink-0" />
        <span>{rich("prof.correct", { phone: <Phone value={p.school.phone} call /> })}</span>
      </p>
    </Panel>
  );
}

function SchoolPanel({ p }: { p: PortalProfile }) {
  const { t, pick, name, rich } = useLang();
  const s = p.school;
  return (
    <Panel id="prof-school" title={t("prof.school")} rise={2}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-sunken p-3">
        <div className="grid min-w-0">
          <span className="font-semibold text-ink">{t("prof.office")}</span>
          <span className="text-small text-ink-muted">{pick(s.address, s.addressUr) || NONE}</span>
          <Phone value={s.phone} />
        </div>
        {s.phone.replace(/\D/g, "") && (
          <a href={`tel:${s.phone.replace(/\D/g, "")}`} className={buttonClassName({ variant: "primary", size: "touch" })}>
            <Icon name="phone" size={18} />
            {t("prof.call")}
          </a>
        )}
      </div>
      <KeyValue
        items={[
          [t("prof.principal"), name(s.principal, s.principalUr)],
          [t("prof.classTeacher"), s.classTeacher ? name(s.classTeacher, s.classTeacherUr) : NONE],
          [
            t("prof.timings"),
            <span key="tm">
              {rich("prof.timingsValue", { from: <ClockTime value={s.dayStarts} />, to: <ClockTime value={s.dayEnds} /> })}
              <span className="block text-small text-ink-muted">{rich("prof.assembly", { time: <ClockTime value={s.assembly} /> })}</span>
            </span>,
          ],
          [t("prof.officeHours"), rich("prof.officeHoursValue", { from: <ClockTime value={s.officeOpens} />, to: <ClockTime value={s.officeCloses} /> })],
        ]}
      />
    </Panel>
  );
}

function SettingsPanel() {
  const account = useAccount();
  const { t, lang, setLang } = useLang();
  const { theme } = useTheme();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [sms, setSms] = useState<PortalLang>(account.smsLanguage);
  const save = useMutation({
    mutationFn: () => portalApi.savePreferences({ smsLanguage: sms }),
    onSuccess: (a) => {
      queryClient.setQueryData(portalQueries.session().queryKey, a);
      toast({ tone: "success", title: t("prof.smsSaved", { lang: sms === "ur" ? t("lang.ur") : t("lang.en") }) });
    },
  });
  return (
    <Panel id="prof-settings" title={t("prof.settings")} rise={3}>
      <div className="grid gap-5">
        <div className="grid gap-1.5">
          <span className="mtb-label">{t("lang.label")}</span>
          <Segmented
            touch
            aria-label={t("lang.label")}
            value={lang}
            onChange={(v) => setLang(v as PortalLang)}
            options={[
              { value: "en", label: <span lang="en" className="font-[family-name:var(--font-sans)]">English</span> },
              { value: "ur", label: <span lang="ur">اردو</span> },
            ]}
          />
        </div>
        <div className="grid gap-1.5">
          <span className="mtb-label">{t("theme.label")}</span>
          <Segmented
            touch
            aria-label={t("theme.label")}
            value={theme}
            onChange={(v) => setTheme(v as ThemeChoice)}
            options={[
              { value: "system", label: t("theme.system") },
              { value: "light", label: t("theme.light") },
              { value: "dark", label: t("theme.dark") },
            ]}
          />
        </div>
        <div className="grid gap-1.5">
          <span className="mtb-label">{t("prof.smsLang")}</span>
          {account.kind === "PARENT" ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Segmented
                  touch
                  aria-label={t("prof.smsLang")}
                  value={sms}
                  onChange={(v) => setSms(v as PortalLang)}
                  options={[
                    { value: "en", label: t("lang.en") },
                    { value: "ur", label: t("lang.ur") },
                  ]}
                />
                <Button variant="primary" size="touch" disabled={sms === account.smsLanguage} loading={save.isPending} loadingLabel={t("common.saving")} onClick={() => save.mutate()}>
                  {t("common.save")}
                </Button>
              </div>
              <span className="mtb-help">{t("prof.smsLangHelp")}</span>
              {save.isError && (
                <span className="mtb-error" role="alert">
                  {t("error.generic")}
                </span>
              )}
            </>
          ) : (
            <span className="mtb-help">{t("prof.smsParentOnly")}</span>
          )}
        </div>
      </div>
    </Panel>
  );
}

function AccountPanel() {
  const account = useAccount();
  const child = useChild();
  const switchTo = useSwitchChild();
  const signOut = useSignOut();
  const { t, name } = useLang();
  const role = account.kind === "STUDENT" ? t("role.STUDENT") : t(`role.${account.relation ?? "Guardian"}`);
  return (
    <Panel id="prof-account" title={t("prof.account")} rise={4}>
      <div className="grid gap-4">
        <div className="flex items-center gap-3">
          <Avatar name={account.name} tone={2} />
          <div className="grid">
            <span className="font-semibold text-ink">{name(account.name, account.nameUr)}</span>
            <span className="text-small text-ink-muted">
              {role} · <Phone value={account.mobile} />
            </span>
          </div>
        </div>
        {account.kind === "PARENT" && account.children.length > 1 && (
          <div className="grid gap-1">
            <span className="mtb-label">{t("prof.children")}</span>
            <ul className="m-0 grid list-none gap-1 p-0">
              {account.children.map((c) => (
                <li key={c.grNo}>
                  <button
                    type="button"
                    aria-pressed={c.grNo === child?.grNo}
                    onClick={() => switchTo(c.grNo)}
                    className="flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-start hover:bg-surface-hover aria-pressed:bg-brand-tint"
                  >
                    <Avatar name={c.name} size="sm" />
                    <span className="flex-1 font-medium text-ink">{name(c.name, c.nameUr)}</span>
                    <span className="text-small text-ink-muted">
                      <Cls value={c.classSection} /> · {name(c.campusName, c.campusNameUr)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="m-0 text-small text-ink-muted">
          {account.lastSignInAt ? (
            <>
              {t("prof.lastSignIn")}: <DateTimeL value={account.lastSignInAt} />
            </>
          ) : (
            t("prof.firstSignIn")
          )}
        </p>
        <div className="grid gap-1">
          <Button variant="danger-quiet" size="touch" icon="logout" loading={signOut.isPending} onClick={() => signOut.mutate()}>
            {t("shell.signOut")}
          </Button>
          <span className="mtb-help">{t("prof.signOutHelp")}</span>
        </div>
      </div>
    </Panel>
  );
}

/** Profile and contacts: the details the school holds, how to reach the campus, language and display, sign out. */
export function ProfilePage() {
  const child = useChild()!;
  const { t } = useLang();
  const profile = useQuery(portalQueries.profile(child.grNo));
  return (
    <div key={child.grNo}>
      <PageHeader title={t("prof.title")} description={t("prof.desc")} />
      <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
        <QueryState
          query={profile}
          skeleton={
            <>
              {[0, 1, 2].map((i) => (
                <div key={i} className="mtb-card grid gap-2 p-5" aria-busy="true">
                  <Skeleton width={140} />
                  {[0, 1, 2, 3].map((k) => (
                    <Skeleton key={k} width="85%" />
                  ))}
                </div>
              ))}
            </>
          }
        >
          {(p) => (
            <>
              <StudentPanel p={p} />
              <SchoolPanel p={p} />
              <GuardianPanel p={p} />
            </>
          )}
        </QueryState>
        <SettingsPanel />
        <AccountPanel />
      </div>
    </div>
  );
}
