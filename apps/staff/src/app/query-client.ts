import { ApiError } from "@mtb/api";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

/** Set by main.tsx once the router exists: sends the user to sign-in when a session expires. */
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
      // Don't retry client errors (403, 404, 422); retry network blips once.
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
    },
  },
});
