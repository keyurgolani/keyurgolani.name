// Should be flagged: redefining formatDate and formatCompactNumber locally.

function formatDate(input: string): string {
  return new Date(input).toLocaleDateString();
}

const formatCompactNumber = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
};

export function helloDate(d: string) {
  return formatDate(d);
}

export function helloNum(n: number) {
  return formatCompactNumber(n);
}
