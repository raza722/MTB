import { ApiError } from "@mtb/api";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

/** Set by main.tsx once the router exists: sends the teacher to sign-in when the session has expired. */
export const sessionExpired = { handle: () => {} };

const onError = (error: unknown) => {
  if (error instanceof ApiError && error.status === 401) sessionExpired.handle();
};

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Offline, a screen keeps what it last showed (restored from the phone) and refreshes when back online.
      networkMode: "online",
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
    },
  },
});
