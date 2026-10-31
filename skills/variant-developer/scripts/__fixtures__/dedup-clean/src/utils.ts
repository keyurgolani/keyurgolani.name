import { formatDate, formatCompactNumber } from '@portfolio/kit';

export function helloDate(d: string) {
  return formatDate(d);
}

export function helloNum(n: number) {
  return formatCompactNumber(n);
}
