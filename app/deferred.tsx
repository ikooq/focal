'use client';
import { lazy, Suspense, type ComponentProps } from 'react';
const StudioPanel = lazy(() => import('./studio'));
const FinancePanel = lazy(() => import('./forecast-panel'));
export function Studio(props: ComponentProps<typeof StudioPanel>) {
  return (
    <Suspense fallback={<p className="muted">Открываем помощник…</p>}>
      <StudioPanel {...props} />
    </Suspense>
  );
}
export function ForecastPanel(props: ComponentProps<typeof FinancePanel>) {
  return (
    <Suspense fallback={<p className="muted">Открываем прогноз…</p>}>
      <FinancePanel {...props} />
    </Suspense>
  );
}
