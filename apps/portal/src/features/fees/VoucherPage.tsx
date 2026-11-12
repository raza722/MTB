import { ApiError, portalQueries, type FeeVoucher } from "@mtb/api";
import { Banner, Button, buttonClassName, EmptyState, Icon, KeyValue, Panel, Skeleton } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { DateL, firstName, Money, Phone } from "../../app/format";
import { Ltr, useLang } from "../../app/i18n";
import { PageHeader, QueryState } from "../../app/shell/page";
import { useChild } from "../../app/session";
import { DocFrame, VoucherSheet } from "./documents";

/** The details a parent needs at the bank counter, readable on a phone. */
function Summary({ v }: { v: FeeVoucher }) {
  const { t, name } = useLang();
  return (
    <Panel id="voucher-summary" title={t("doc.voucherTitle")} rise={0}>
      <div className="grid gap-4 md:grid-cols-2">
        <KeyValue
          items={[
            [t("doc.voucherNo"), <Ltr mono key="no">{v.voucherNo}</Ltr>],
            [t("doc.amount"), <Money key="amt" value={v.payableByDue} className="font-semibold tabular-nums" />],
            [t("fees.colDue"), <DateL key="due" value={v.dueDate} />],
            [t("doc.validUntil"), <DateL key="valid" value={v.validUntil} />],
          ]}
        />
        <KeyValue
          items={[
            [t("doc.bank"), name(v.bank.bankName)],
            [t("doc.accountTitle"), name(v.bank.accountTitle)],
            [t("doc.accountNo"), <Ltr mono key="acc">{v.bank.accountNo}</Ltr>],
          ]}
        />
      </div>
      <div className="mt-4 grid gap-1">
        <h3 className="m-0 text-caption text-ink-subtle">{t("doc.ifLate")}</h3>
        <ul className="m-0 grid list-none grid-cols-2 gap-x-4 gap-y-1 p-0 text-small sm:grid-cols-4">
          {v.fineTable.slice(1).map((row, i) => (
            <li key={row.upTo} className="mtb-slide-in flex justify-between gap-2 rounded-md bg-surface-sunken px-2 py-1" style={{ "--i": i } as CSSProperties}>
              <DateL value={row.upTo} className="text-ink-muted" />
              <Money value={row.amount} className="font-medium tabular-nums" />
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

/** Download the fee voucher: the bank details on screen, and the three-copy A4 voucher to save as PDF and print. */
export function VoucherPage() {
  const child = useChild()!;
  const { t, rich, pick } = useLang();
  const voucher = useQuery(portalQueries.voucher(child.grNo));
  const code = voucher.error instanceof ApiError ? voucher.error.code : null;
  const noDues = code === "NO_DUES";
  // Dues are open but the office has not issued this month's voucher (C2): the portal never issues one itself.
  const noVoucher = code === "NO_VOUCHER";
  // The campus office's phone for the "no voucher yet" message (the profile page's figure, cached).
  const phone = useQuery({ ...portalQueries.profile(child.grNo), enabled: noVoucher }).data?.school.phone;
  const v = voucher.data;
  return (
    <div key={child.grNo}>
      <PageHeader
        title={t("doc.voucherTitle")}
        description={v ? rich("doc.voucherDesc", { amount: <Money value={v.payableByDue} className="font-semibold text-ink tabular-nums" />, date: <DateL value={v.dueDate} className="font-semibold text-ink" /> }) : undefined}
        actions={
          <>
            <Link to="/fees" className={buttonClassName({ variant: "secondary", size: "touch" })}>
              <Icon name="arrowLeft" size={18} className="portal-flip" />
              {t("doc.backToFees")}
            </Link>
            {!noDues && !noVoucher && (
              <Button variant="primary" size="touch" icon="download" disabled={!v} onClick={() => window.print()}>
                {t("doc.save")}
              </Button>
            )}
          </>
        }
      />
      {noDues ? (
        <div className="mtb-card">
          <EmptyState icon="checkCircle" title={t("doc.noVoucher")} description={t("doc.noVoucherDesc", { child: firstName(pick(child.name, child.nameUr)) })} />
        </div>
      ) : noVoucher ? (
        <div className="mtb-card">
          <EmptyState
            icon="receipt"
            title={t("doc.noVoucherYet")}
            description={
              <>
                {t("doc.noVoucherYetDesc")} {phone ? rich("doc.noVoucherYetCall", { phone: <Phone value={phone} call /> }) : null}
              </>
            }
          />
        </div>
      ) : (
        <QueryState
          query={voucher}
          skeleton={
            <div className="mtb-card grid gap-3 p-5" aria-busy="true">
              <Skeleton width={160} />
              <Skeleton width="70%" />
              <Skeleton width="100%" height={200} />
            </div>
          }
        >
          {(data) => (
            <div className="grid gap-4">
              <Summary v={data} />
              <Banner tone="info" className="portal-no-print">
                {t("doc.voucherHint")} {t("doc.pdfHint")}
              </Banner>
              <section className="portal-print portal-print-voucher" aria-label={t("doc.preview")}>
                <DocFrame widthPx={1060}>
                  <VoucherSheet voucher={data} />
                </DocFrame>
              </section>
            </div>
          )}
        </QueryState>
      )}
    </div>
  );
}
