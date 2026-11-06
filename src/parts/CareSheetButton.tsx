import { useState, type ReactNode } from 'react';
import { careSheetName, makeCareSheet, shareFile } from '../lib/careSheet';
import type { Pet } from '../lib/types';
import { useApp } from '../state';
import { Icons, useToast } from '../ui';

/** Makes a PDF care sheet for these pets and opens the share sheet (or downloads it). */
export function CareSheetButton({ pets, className = 'btn btn-quiet btn-small', children }: { pets: Pet[]; className?: string; children?: ReactNode }) {
  const { snapshot } = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function go() {
    if (!pets.length) return;
    setBusy(true);
    try {
      const blob = await makeCareSheet({
        householdName: snapshot.household.name,
        pets,
        routines: snapshot.routines,
        members: snapshot.members,
        places: snapshot.places,
      });
      const res = await shareFile(blob, careSheetName(pets, snapshot.household.name));
      if (res === 'downloaded') toast('Care sheet saved to your downloads.');
    } catch (e) {
      toast(`Couldn’t make the care sheet. ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className={className} onClick={go} disabled={busy || !pets.length}>
      {Icons.file}
      {busy ? 'Making PDF…' : children ?? 'Care sheet PDF'}
    </button>
  );
}
