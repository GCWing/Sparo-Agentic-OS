import { useCallback, useEffect, useRef, useState } from 'react';

interface CachedResource<T> {
  value: T;
  updatedAt: number;
}

interface HubPreviewResourceState<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  refresh: () => void;
}

interface InternalResourceState<T> {
  cacheKey: string;
  data: T | null;
  error: unknown;
  loading: boolean;
}

const resourceCache = new Map<string, CachedResource<unknown>>();

export function useHubPreviewResource<T>(
  cacheKey: string,
  loader: () => Promise<T>,
  options: { ttlMs?: number } = {},
): HubPreviewResourceState<T> {
  const ttlMs = options.ttlMs ?? 30_000;
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const cached = resourceCache.get(cacheKey) as CachedResource<T> | undefined;
  const cacheIsFresh = cached ? Date.now() - cached.updatedAt < ttlMs : false;
  const [state, setState] = useState<InternalResourceState<T>>({
    cacheKey,
    data: cached?.value ?? null,
    error: null,
    loading: !cacheIsFresh,
  });
  const [revision, setRevision] = useState(0);

  const visibleState = state.cacheKey === cacheKey
    ? state
    : {
        cacheKey,
        data: cached?.value ?? null,
        error: null,
        loading: !cacheIsFresh,
      };

  const refresh = useCallback(() => {
    resourceCache.delete(cacheKey);
    setState((current) => ({
      cacheKey,
      data: current.cacheKey === cacheKey ? current.data : null,
      error: null,
      loading: true,
    }));
    setRevision((value) => value + 1);
  }, [cacheKey]);

  useEffect(() => {
    const current = resourceCache.get(cacheKey) as CachedResource<T> | undefined;
    if (current && Date.now() - current.updatedAt < ttlMs) {
      setState({ cacheKey, data: current.value, error: null, loading: false });
      return undefined;
    }

    let cancelled = false;
    setState((previous) => ({
      cacheKey,
      data: previous.cacheKey === cacheKey ? previous.data : current?.value ?? null,
      error: null,
      loading: true,
    }));

    void loaderRef.current()
      .then((value) => {
        if (cancelled) return;
        resourceCache.set(cacheKey, { value, updatedAt: Date.now() });
        setState({ cacheKey, data: value, error: null, loading: false });
      })
      .catch((resourceError: unknown) => {
        if (cancelled) return;
        setState((previous) => ({
          cacheKey,
          data: previous.cacheKey === cacheKey ? previous.data : null,
          error: resourceError,
          loading: false,
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, revision, ttlMs]);

  return {
    data: visibleState.data,
    error: visibleState.error,
    loading: visibleState.loading,
    refresh,
  };
}
