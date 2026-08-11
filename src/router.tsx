import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: typeof window === "undefined" ? createMemoryHistory() : undefined,
    origin: typeof window === "undefined" ? "https://events.echomarketing.agency" : undefined,
    scrollRestoration: typeof window !== "undefined",
    defaultPreloadStaleTime: 0,
  });

  return router;
};
