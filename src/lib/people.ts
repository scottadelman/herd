import type { Member } from './types';

/** Stamp colors for household members. Kept in sync with supabase/schema.sql. */
export const MEMBER_COLORS = ['#3A6EA5', '#E4572E', '#1F8A70', '#8E4A9E', '#C98A12', '#D1477A'];

export function initials(name: string): string {
  // "Maria (sitter)" stamps as MA, not M(.
  const parts = name.replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function memberById(members: Member[], id: string | null | undefined): Member | undefined {
  return id ? members.find((m) => m.user_id === id) : undefined;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}
