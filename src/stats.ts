// Small stats helpers, written out so there's nothing hidden (no dependencies).

/** Mulberry32: a tiny seeded random number generator, so bootstrap intervals are the same every run. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/** 95% percentile bootstrap interval for the mean, resampling the given units (e.g. per-question values). */
export function bootstrap(xs: number[], n = 2000, seed = 1): [number, number] {
  if (!xs.length) return [NaN, NaN];
  const r = rng(seed);
  const ms: number[] = [];
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < xs.length; j++) s += xs[Math.floor(r() * xs.length)];
    ms.push(s / xs.length);
  }
  ms.sort((a, b) => a - b);
  return [ms[Math.floor(0.025 * n)], ms[Math.ceil(0.975 * n) - 1]];
}

/** Exact two-sided sign test p-value: of the questions where two variants differ, does one win more often than chance? */
export function signTest(wins: number, losses: number): number {
  const n = wins + losses;
  if (!n) return 1;
  const k = Math.min(wins, losses);
  let p = 0;
  let c = 1; // C(n, 0)
  for (let i = 0; i <= k; i++) {
    p += c;
    c = (c * (n - i)) / (i + 1);
  }
  return Math.min(1, (2 * p) / 2 ** n);
}
