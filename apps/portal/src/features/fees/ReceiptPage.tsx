import { portalQueries } from "@mtb/api";
import { Banner, Button, buttonClassName, Icon, Skeleton } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useLang } from "../../app/i18n";
import { PageHeader, QueryState } from "../../app/shell/page";
import { useChild } from "../../app/session";
import { DocFrame, ReceiptA5 } from "./documents";

/** One receipt as the counter printed it (A5). "Save as PDF" opens the browser's print window. */
export function ReceiptPage({ receiptNo }: { receiptNo: string }) {
  const child = useChild()!;
  const { t } = useLang();
  const receipt = useQuery(portalQueries.receipt(child.grNo, receiptNo));
  return (
    <div>
      <PageHeader
        title={t("doc.receiptTitle", { no: receiptNo })}
        actions={
          <>
            <Link to="/fees" className={buttonClassName({ variant: "secondary", size: "touch" })}>
              <Icon name="arrowLeft" size={18} className="portal-flip" />
              {t("doc.backToFees")}
            </Link>
            <Button variant="primary" size="touch" icon="download" disabled={!receipt.data} onClick={() => window.print()}>
              {t("doc.save")}
            </Button>
          </>
        }
      />
      <Banner tone="info" className="portal-no-print mb-4">
        {t("doc.receiptHint")}
      </Banner>
      <QueryState
        query={receipt}
        skeleton={
          <div className="portal-doc-desk grid justify-items-center gap-3 p-6" aria-busy="true">
            <Skeleton width={360} height={420} />
          </div>
        }
      >
        {(r) => (
          <div className="portal-print">
            <DocFrame widthPx={560}>
              <ReceiptA5 receipt={r} />
            </DocFrame>
          </div>
        )}
      </QueryState>
    </div>
  );
}
