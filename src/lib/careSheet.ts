import { addDays, formatDayLabel, formatLongDate, formatShortDate, formatTime, todayISO } from './dates';
import { formatDistance, routeLength } from './geo';
import { ageText, kindOf, mealTimes, sexText } from './profile';
import { describeSchedule, nextDueDate } from './schedule';
import type { Member, Pet, Place, Routine } from './types';

// A printable care sheet for a sitter, a boarding place, or the fridge: one
// page (or more) per pet with feeding, allergies, routines, medications,
// what's coming up, likes and dislikes, and the vet. jsPDF is loaded only
// when someone asks for one.

export interface CareSheetInput {
  householdName: string;
  pets: Pet[];
  routines: Routine[];
  members: (Pick<Member, 'display_name'> & { phone?: string | null })[];
  places: Pick<Place, 'kind' | 'name' | 'notes' | 'points'>[];
  today?: string;
}

/** The standard PDF fonts only cover Western European text, so drop what they can't draw (emoji). */
export function pdfText(s: string): string {
  return Array.from(s)
    .filter((ch) => {
      const c = ch.codePointAt(0)!;
      return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || '‘’“”–—•…€™'.includes(ch) || ch === '\n';
    })
    .join('')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

const INK: [number, number, number] = [28, 42, 58];
const MUTED: [number, number, number] = [78, 93, 108];
const LINE: [number, number, number] = [217, 224, 230];
const ALERT: [number, number, number] = [199, 59, 59];
const BALL: [number, number, number] = [201, 220, 76];

export async function makeCareSheet(input: CareSheetInput): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  const today = input.today ?? todayISO();
  let y = M;

  const ensure = (need: number) => {
    if (y + need > H - M - 20) {
      doc.addPage();
      y = M;
    }
  };
  const text = (s: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; x?: number; width?: number; gap?: number } = {}) => {
    const size = opts.size ?? 11;
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...(opts.color ?? INK));
    const x = opts.x ?? M;
    const lines = doc.splitTextToSize(pdfText(s), opts.width ?? W - x - M) as string[];
    const lh = size * 1.35;
    for (const line of lines) {
      ensure(lh);
      doc.text(line, x, y + size);
      y += lh;
    }
    y += opts.gap ?? 0;
  };
  /** A section title. Short sections stay on one page with their title. */
  const heading = (s: string, rows = 2) => {
    ensure(36 + Math.min(rows, 8) * 15);
    y += 10;
    doc.setDrawColor(...LINE);
    doc.setLineWidth(1);
    doc.line(M, y, W - M, y);
    y += 8;
    text(s, { size: 13, bold: true, gap: 4 });
  };
  /** A label on the left and the value wrapped on the right, kept together on one page. */
  const fact = (label: string, value: string | null | undefined) => {
    if (!value?.trim()) return;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    const labelLines = doc.splitTextToSize(pdfText(label), 110) as string[];
    doc.setFontSize(11);
    const valueLines = doc.splitTextToSize(pdfText(value), W - M * 2 - 120) as string[];
    const lh = 11 * 1.35;
    const rows = Math.max(labelLines.length, valueLines.length);
    ensure(rows * lh);
    doc.setFontSize(10.5);
    doc.setTextColor(...MUTED);
    labelLines.forEach((l, i) => doc.text(l, M, y + 11 + i * lh));
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    valueLines.forEach((l, i) => doc.text(l, M + 120, y + 11 + i * lh));
    y += rows * lh + 3;
  };
  const when = (r: Routine) => describeSchedule(r, today).replace(', due today', `, next ${formatShortDate(today)}`);

  input.pets.forEach((pet, i) => {
    if (i > 0) {
      doc.addPage();
      y = M;
    }
    // Header band
    doc.setFillColor(...BALL);
    doc.rect(0, 0, W, 6, 'F');
    const photoSize = 76;
    let textX = M;
    if (pet.photo?.startsWith('data:image/jpeg') || pet.photo?.startsWith('data:image/png')) {
      try {
        doc.addImage(pet.photo, pet.photo.startsWith('data:image/png') ? 'PNG' : 'JPEG', M, y, photoSize, photoSize);
        textX = M + photoSize + 16;
      } catch {
        /* a broken photo just leaves it out */
      }
    }
    const top = y;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(26);
    doc.setTextColor(...INK);
    doc.text(pdfText(pet.name) || 'Pet', textX, y + 26);
    y += 36;
    const who = [pet.breed?.trim() || kindOf(pet), ageText(pet.birthday, today), sexText(pet)?.toLowerCase()].filter(Boolean).join(', ');
    text(who.replace(/^./, (c) => c.toUpperCase()), { x: textX, color: MUTED, size: 12 });
    text(`${input.householdName}. Care sheet from Herd, ${formatLongDate(today)}.`, { x: textX, color: MUTED, size: 9.5 });
    y = Math.max(y, top + photoSize) + 12;

    if (pet.allergies.length) {
      const msg = `Allergic to: ${pet.allergies.join(', ')}`;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      const lines = doc.splitTextToSize(pdfText(msg), W - 2 * M - 24) as string[];
      const h = lines.length * 16 + 14;
      ensure(h);
      doc.setDrawColor(...ALERT);
      doc.setLineWidth(1.5);
      doc.roundedRect(M, y, W - 2 * M, h, 6, 6, 'S');
      doc.setTextColor(...ALERT);
      lines.forEach((l, j) => doc.text(l, M + 12, y + 20 + j * 16));
      y += h + 8;
    }

    const routines = input.routines.filter((r) => r.pet_id === pet.id && r.active);
    const meals = mealTimes(pet, input.routines);
    if (pet.food || pet.food_amount || pet.feeding_notes || meals) {
      heading('Feeding', [pet.food, pet.food_amount, meals, pet.feeding_notes].filter(Boolean).length);
      fact('Food', pet.food);
      fact('How much', pet.food_amount ? `${pet.food_amount} per meal` : null);
      fact('When', meals);
      fact('Instructions', pet.feeding_notes);
    }

    const daily = routines
      .filter((r) => r.category === 'care' && (r.kind === 'daily' || r.kind === 'weekly'))
      .flatMap((r) => (r.times.length ? r.times.map((t) => ({ t, r })) : [{ t: 'any', r }]))
      .sort((a, b) => (a.t === 'any' ? 1 : b.t === 'any' ? -1 : a.t.localeCompare(b.t)));
    if (daily.length) {
      heading('Daily routine', daily.length);
      for (const { t, r } of daily) {
        const at = t === 'any' ? 'Any time' : formatTime(t);
        const extra = [r.kind === 'weekly' ? when(r).replace(/ at .*$/, '') : '', r.notes ?? ''].filter(Boolean).join('. ');
        fact(at, `${r.title}${extra ? `. ${extra}` : ''}`);
      }
    }

    const meds = routines.filter((r) => r.category === 'medication');
    if (meds.length) {
      heading('Medications', meds.length * 2);
      for (const r of meds) fact(r.title, [r.dose, when(r), r.notes].filter(Boolean).join('. '));
    }

    const soon = routines
      .filter((r) => (r.category === 'vaccine' || r.category === 'vet' || r.kind === 'once' || r.kind === 'interval') && r.category !== 'medication')
      .map((r) => ({ r, next: nextDueDate(r, today) }))
      .filter((x): x is { r: Routine; next: string } => !!x.next && x.next <= addDays(today, 60))
      .sort((a, b) => a.next.localeCompare(b.next));
    if (soon.length) {
      heading('Coming up in the next two months', soon.length);
      for (const { r, next } of soon) {
        fact(formatDayLabel(next, today), `${r.title}${r.times[0] ? ` at ${formatTime(r.times[0])}` : ''}${r.notes ? `. ${r.notes}` : ''}`);
      }
    }

    if (pet.likes.length || pet.dislikes.length) {
      heading('Likes and dislikes');
      fact('Likes', pet.likes.join(', '));
      fact('Dislikes', pet.dislikes.join(', '));
    }

    if (pet.vet_clinic || pet.vet_name || pet.vet_phone || pet.vet_address) {
      heading('Vet', 3);
      fact('Clinic', [pet.vet_clinic, pet.vet_name].filter(Boolean).join(', '));
      fact('Phone', pet.vet_phone);
      fact('Address', pet.vet_address);
    }

    if (pet.microchip || pet.birthday) {
      heading('ID');
      fact('Microchip', pet.microchip);
      fact('Birthday', pet.birthday ? formatLongDate(pet.birthday) : null);
    }

    if (pet.notes) {
      heading('Notes');
      text(pet.notes);
    }

    const routes = input.places.filter((p) => p.kind === 'route' && p.points.length > 1);
    if (routes.length && pet.species === 'dog') {
      heading('Usual walks');
      for (const r of routes) fact(r.name, `${formatDistance(routeLength(r.points))}${r.notes ? `. ${r.notes}` : ''}`);
    }

    if (input.members.length) {
      heading('Household', input.members.length);
      for (const m of input.members.filter((x) => x.phone)) fact(m.display_name, m.phone);
      const noPhone = input.members.filter((x) => !x.phone).map((x) => x.display_name);
      if (noPhone.length) text(noPhone.join(', '), { color: MUTED });
    }
  });

  // Page numbers
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text(`Made with Herd`, M, H - 28);
    if (pages > 1) doc.text(`Page ${p} of ${pages}`, W - M, H - 28, { align: 'right' });
  }
  return doc.output('blob');
}

/** Share the file on a phone (Messages, Mail, Save to Files), or download it on a computer. */
export async function shareFile(blob: Blob, filename: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], filename, { type: blob.type || 'application/pdf' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: filename.replace(/\.pdf$/, '') });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'downloaded';
}

/** "Biscuit care sheet.pdf", or the household's name for several pets. */
export function careSheetName(pets: Pick<Pet, 'name'>[], householdName: string): string {
  const base = pets.length === 1 ? `${pets[0].name} care sheet` : `${householdName} care sheets`;
  return `${pdfText(base).replace(/[\\/:*?"<>|]/g, '') || 'Care sheet'}.pdf`;
}
