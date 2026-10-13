'use client';
import { useEffect } from 'react';
export default function Motion({
  mode,
  paused,
  view,
}: {
  mode: string;
  paused: boolean;
  view: string;
}) {
  useEffect(() => {
    const root = document.documentElement,
      reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      root.dataset.motion = reduce.matches || paused ? 'off' : mode;
    };
    apply();
    reduce.addEventListener('change', apply);
    if (mode === 'off' || paused || reduce.matches)
      return () => reduce.removeEventListener('change', apply);
    const seen = new WeakSet<Element>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            e.target.classList.add('scroll-visible');
            observer.unobserve(e.target);
          }
      },
      { threshold: 0.04, rootMargin: '0px 0px -12px 0px' },
    );
    const scan = () =>
      document
        .querySelectorAll(
          '.background-app .panel,.background-app .week-scene,.background-app .section-heading,.background-app .timeline-item,.background-app .project-card,.background-app .habit-row,.background-app .thought-card',
        )
        .forEach((el) => {
          if (seen.has(el)) return;
          seen.add(el);
          const rect = el.getBoundingClientRect();
          if (rect.top >= window.innerHeight) {
            el.classList.add('scroll-reveal');
            observer.observe(el);
          }
        });
    scan();
    const changes = new MutationObserver(scan);
    const main = document.querySelector('main');
    if (main) changes.observe(main, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      changes.disconnect();
      reduce.removeEventListener('change', apply);
      document
        .querySelectorAll('.scroll-reveal')
        .forEach((el) => el.classList.add('scroll-visible'));
    };
  }, [mode, paused, view]);
  return null;
}
