import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";

export function useEnvironmentSnapshot(environmentId: string) {
  return useQuery({
    queryKey: ["environment-snapshot", environmentId],
    queryFn: () => api.getEnvironmentSnapshot(environmentId),
    retry: false,
    staleTime: environmentId === "local" ? 10_000 : 20_000,
    gcTime: 5 * 60_000,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
    refetchInterval: environmentId === "local" ? false : 60_000,
  });
}
