export const RARITIES = [
  { id: 'common', name: '普通', colors: ['#9CA3AF'], order: 0 },
  { id: 'uncommon', name: '罕见', colors: ['#84CC16'], order: 1 },
  { id: 'fine', name: '精良', colors: ['#3B82F6'], order: 2 },
  { id: 'rare', name: '稀有', colors: ['#A855F7'], order: 3 },
  { id: 'epic', name: '史诗', colors: ['#EC4899'], order: 4 },
  { id: 'legendary', name: '传说', colors: ['#F59E0B'], order: 5 },
  { id: 'mythic', name: '神话', colors: ['#EF4444'], order: 6 },
  { id: 'exotic', name: '奇异', colors: ['#06B6D4', '#8B5CF6'], order: 7 },
  { id: 'arcane', name: '奥秘', colors: ['#A855F7', '#EC4899', '#F59E0B'], order: 8 },
] as const;

export const rarityById = (id: string) => RARITIES.find((r) => r.id === id) ?? RARITIES[0];

export const rarityStyle = (id: string): React.CSSProperties => {
  const r = rarityById(id);
  return {
    ['--catch-accent' as any]: r.colors[0],
    ['--catch-accent-secondary' as any]: r.colors.at(-1),
    ['--rarity-color' as any]: r.colors.length > 1 ? `linear-gradient(135deg, ${r.colors.join(', ')})` : r.colors[0],
    color: r.colors[0],
  };
};

export const fmt = (n: number | bigint | null | undefined): string =>
  Number(n ?? 0).toLocaleString('zh-CN');

export const fmtPct = (bp: number | null | undefined): string => {
  const v = (bp ?? 0) / 100;
  return `${v > 0 ? '+' : ''}${v.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%`;
};

export function useCountdown(target: string | null | undefined): string {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!target) return '--';
  const diff = new Date(target).getTime() - now;
  if (diff <= 0) return '00:00:00';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}`;
}

export function Countdown({ target, className }: { target: string | null | undefined; className?: string }) {
  const value = useCountdown(target);
  return <span className={className}>{value}</span>;
}

export function formatDuration(seconds: number): string {
  if (seconds >= 3600) return `${Math.round(seconds / 3600)} 小时`;
  if (seconds >= 60) return `${Math.round(seconds / 60)} 分钟`;
  return `${seconds} 秒`;
}

export const slotNames: Record<string, string> = {
  head: '头部', chest: '躯干', legs: '腿部', boots: '靴子', gloves: '手套',
  ring: '戒指', amulet: '护符', charm: '符咒',
};

export const statNames: Record<string, string> = {
  strength: '力量', intelligence: '智力', luck: '运气', endurance: '耐力',
};

import React from 'react';

export const biomeCode = (id: string): string => (id || '').replace(/^b_0*/, 'B');
