// Screen → Hook → Service → Mock 데이터 흐름의 공통 비동기 상태 훅.
// 모든 화면이 loading / success / empty / error 4-상태를 동일하게 처리한다.
import { useFocusEffect } from 'expo-router';
import { DependencyList, useCallback, useRef, useState } from 'react';

export type AsyncStatus = 'loading' | 'success' | 'empty' | 'error';

export interface AsyncState<T> {
  status: AsyncStatus;
  data: T | null;
  error: string | null;
  reload: () => void;
}

export interface UseAsyncOptions<T> {
  /** true를 반환하면 success 대신 empty 상태 (기본: null/빈 배열) */
  isEmpty?: (data: T) => boolean;
  /** 화면 재진입(focus) 시마다 다시 불러오기 — 편집 후 복귀 반영용 */
  reloadOnFocus?: boolean;
}

function defaultIsEmpty(data: unknown): boolean {
  return data == null || (Array.isArray(data) && data.length === 0);
}

export function useAsync<T>(
  load: () => Promise<T>,
  deps: DependencyList,
  options: UseAsyncOptions<T> = {},
): AsyncState<T> {
  const { isEmpty = defaultIsEmpty, reloadOnFocus = false } = options;
  const [state, setState] = useState<Omit<AsyncState<T>, 'reload'>>({
    status: 'loading',
    data: null,
    error: null,
  });
  const [reloadKey, setReloadKey] = useState(0);
  // focus 재조회 시 로딩 플래시 없이 갱신하도록 최초 로드만 loading 표시
  const loadedOnce = useRef(false);

  const run = useCallback(() => {
    let alive = true;
    if (!loadedOnce.current) {
      setState({ status: 'loading', data: null, error: null });
    }
    load()
      .then(data => {
        if (!alive) return;
        loadedOnce.current = true;
        setState({ status: isEmpty(data) ? 'empty' : 'success', data, error: null });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setState({
          status: 'error',
          data: null,
          error: e instanceof Error ? e.message : '데이터를 불러오지 못했습니다.',
        });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadKey]);

  useFocusEffect(
    useCallback(() => {
      if (!reloadOnFocus && loadedOnce.current) return undefined;
      return run();
    }, [run, reloadOnFocus]),
  );

  const reload = useCallback(() => {
    loadedOnce.current = false;
    setReloadKey(k => k + 1);
  }, []);

  return { ...state, reload };
}
