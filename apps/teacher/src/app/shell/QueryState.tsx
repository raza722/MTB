import { ApiError } from "@mtb/api";
import { Banner, Button, EmptyState } from "@mtb/ui";
import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";

/** Plain-English text for a failed request. */
export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isNetwork) return "Can't reach the school server. Check the phone's connection and try again.";
    return error.message;
  }
  return "Something went wrong. Try again.";
}

/**
 * The four states of a screen's data: shown (with a quiet note if a refresh failed), loading skeleton, offline with
 * nothing saved on the phone yet, and an error with Try again.
 */
export function QueryState<T>({ query, skeleton, children }: { query: UseQueryResult<T>; skeleton: ReactNode; children: (data: T) => ReactNode }) {
  if (query.data !== undefined) {
    return (
      <>
        {query.isError && (
          <Banner tone="warning" className="mb-3" title="Showing what was saved on this phone." actions={<Button size="sm" onClick={() => void query.refetch()}>Refresh</Button>}>
            {errorText(query.error)}
          </Banner>
        )}
        {children(query.data)}
      </>
    );
  }
  if (query.isError) {
    const forbidden = query.error instanceof ApiError && query.error.status === 403;
    return (
      <Banner
        tone={forbidden ? "warning" : "danger"}
        title={forbidden ? "Not available to you." : "This screen didn't load."}
        actions={
          forbidden ? undefined : (
            <Button size="sm" onClick={() => void query.refetch()}>
              Try again
            </Button>
          )
        }
      >
        {errorText(query.error)}
      </Banner>
    );
  }
  if (query.fetchStatus === "paused") {
    return (
      <EmptyState
        icon="cloudOff"
        title="You're offline"
        description="This screen hasn't been opened on this phone yet, so there is nothing saved to show. It loads as soon as the connection is back."
      />
    );
  }
  return <>{skeleton}</>;
}
