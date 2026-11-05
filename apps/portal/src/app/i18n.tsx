import { createLangStore, dirOf, messageParts, monthName, pluralKey, t as translate, weekdayName, type Lang, type MessageKey, type Vars } from "@mtb/i18n";
import { cx } from "@mtb/ui";
import { Fragment, useSyncExternalStore, type ReactNode } from "react";

/** The portal's language, saved on this device and applied to <html lang dir> (index.html applies it before paint). */
export const langStore = createLangStore("mtb.portal.lang", "en");

type PluralBase<K extends string> = K extends `${infer B}.one` ? B : never;
export type PluralKey = PluralBase<MessageKey>;

/**
 * Left-to-right piece inside Urdu (or English) text: amounts, dates, CNICs, phone numbers, G.R. numbers, class names.
 * They keep Western digits and read left to right (brief §7.13).
 */
export function Ltr({ children, className, mono }: { children: ReactNode; className?: string; mono?: boolean }) {
  return (
    <bdi dir="ltr" className={cx("portal-ltr", mono && "portal-mono", className)}>
      {children}
    </bdi>
  );
}

export interface I18n {
  lang: Lang;
  dir: "ltr" | "rtl";
  isUr: boolean;
  setLang: (lang: Lang) => void;
  /** Plain text: titles, labels, aria-labels. */
  t: (key: MessageKey, vars?: Vars) => string;
  /** One/other plural with {n} filled. */
  tp: (base: PluralKey, n: number, vars?: Vars) => string;
  /** A message with React pieces in its {slots}, e.g. rich("home.payBy", { date: <DateL value={…} /> }). */
  rich: (key: MessageKey, slots: Record<string, ReactNode>) => ReactNode;
  /** The Urdu form when reading Urdu and there is one; otherwise English. */
  pick: (en: string, ur?: string | null) => string;
  /** Like pick, for names and places on screen: English shown inside Urdu text stays a left-to-right piece. */
  name: (en: string, ur?: string | null) => ReactNode;
  month: (month0: number, short?: boolean) => string;
  weekday: (isoDate: string) => string;
}

function richText(lang: Lang, key: MessageKey, slots: Record<string, ReactNode>): ReactNode {
  return (
    <>
      {messageParts(lang, key).map((p, i) => (
        <Fragment key={i}>{"text" in p ? p.text : (slots[p.slot] ?? `{${p.slot}}`)}</Fragment>
      ))}
    </>
  );
}

export function i18nFor(lang: Lang): I18n {
  return {
    lang,
    dir: dirOf(lang),
    isUr: lang === "ur",
    setLang: langStore.set,
    t: (key, vars) => translate(lang, key, vars),
    tp: (base, n, vars) => translate(lang, pluralKey(base, n) as MessageKey, { n, ...vars }),
    rich: (key, slots) => richText(lang, key, slots),
    pick: (en, ur) => (lang === "ur" && ur ? ur : en),
    name: (en, ur) => (lang !== "ur" ? en : ur ? ur : <Ltr>{en}</Ltr>),
    month: (m, short) => monthName(lang, m, short),
    weekday: (iso) => weekdayName(lang, iso),
  };
}

/** The current language and its helpers. Re-renders when the reader switches English ↔ اردو. */
export function useLang(): I18n {
  const lang = useSyncExternalStore(langStore.subscribe, langStore.get, () => "en" as Lang);
  return i18nFor(lang);
}
