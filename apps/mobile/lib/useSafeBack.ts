// 뒤로 가기 안전 처리 — 딥링크로 직접 진입해 스택이 없으면 fallback으로 이동.
// (GO_BACK not handled 경고 방지)
import { Href, useRouter } from 'expo-router';
import { useCallback } from 'react';

export function useSafeBack(fallback: Href) {
  const router = useRouter();
  return useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(fallback);
  }, [router, fallback]);
}
