import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { todayISO } from '../lib/dates';
import { EMOJI_CHOICES, ROUTINE_TEMPLATES, SPECIES, defaultEmoji, type Template } from '../lib/pets';
import { photoToDataUrl } from '../lib/photo';
import { hasVet, lastEmoji } from '../lib/profile';
import { describeSchedule } from '../lib/schedule';
import type { Pet, PetInput, Routine, Sex, Species } from '../lib/types';
import type { PetSection } from '../parts/PetInfo';
import { useApp } from '../state';
import { Chips, Field, Icons, PetAvatar, Sheet, TagInput } from '../ui';

interface CustomTask {
  title: string;
  time: string;
}

const s = (v: string) => v.trim() || null;

/** Add a pet, or edit everything about one: basics, profile, feeding, health, vet. */
export function PetSheet({
  pet,
  focus,
  onClose,
  onSaved,
  onDeleted,
}: {
  pet?: Pet;
  /** Open this part of the profile and scroll to it. */
  focus?: PetSection;
  onClose: () => void;
  onSaved: (id: string) => void;
  onDeleted?: () => void;
}) {
  const { backend, snapshot, run } = useApp();
  const [name, setName] = useState(pet?.name ?? '');
  const [species, setSpecies] = useState<Species>(pet?.species ?? 'dog');
  const [speciesLabel, setSpeciesLabel] = useState(pet?.species_label ?? '');
  const [emoji, setEmoji] = useState(pet?.emoji ?? defaultEmoji('dog'));
  const [emojiDraft, setEmojiDraft] = useState('');
  const [photo, setPhoto] = useState<string | null>(pet?.photo ?? null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [notes, setNotes] = useState(pet?.notes ?? '');
  const [breed, setBreed] = useState(pet?.breed ?? '');
  const [birthday, setBirthday] = useState(pet?.birthday ?? '');
  const [sex, setSex] = useState<Sex | ''>(pet?.sex ?? '');
  const [fixed, setFixed] = useState<boolean | null>(pet?.fixed ?? null);
  const [microchip, setMicrochip] = useState(pet?.microchip ?? '');
  const [allergies, setAllergies] = useState<string[]>(pet?.allergies ?? []);
  const [likes, setLikes] = useState<string[]>(pet?.likes ?? []);
  const [dislikes, setDislikes] = useState<string[]>(pet?.dislikes ?? []);
  const [food, setFood] = useState(pet?.food ?? '');
  const [foodAmount, setFoodAmount] = useState(pet?.food_amount ?? '');
  const [feedingNotes, setFeedingNotes] = useState(pet?.feeding_notes ?? '');
  const [vetClinic, setVetClinic] = useState(pet?.vet_clinic ?? '');
  const [vetName, setVetName] = useState(pet?.vet_name ?? '');
  const [vetPhone, setVetPhone] = useState(pet?.vet_phone ?? '');
  const [vetAddress, setVetAddress] = useState(pet?.vet_address ?? '');
  const [picked, setPicked] = useState<Set<number>>(() => new Set(ROUTINE_TEMPLATES.dog.map((_, i) => i)));
  const [custom, setCustom] = useState<CustomTask[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const templates = ROUTINE_TEMPLATES[species];
  const hid = snapshot.household.id;
  const today = todayISO();
  const otherVets = snapshot.pets.filter((p) => p.id !== pet?.id && hasVet(p));
  const choices = EMOJI_CHOICES.includes(emoji) ? EMOJI_CHOICES : [emoji, ...EMOJI_CHOICES];

  function chooseSpecies(next: Species) {
    if (emoji === defaultEmoji(species)) setEmoji(defaultEmoji(next));
    setSpecies(next);
    setPicked(new Set(ROUTINE_TEMPLATES[next].map((_, i) => i)));
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setPhotoError(null);
    try {
      setPhoto(await photoToDataUrl(file));
    } catch (e) {
      setPhotoError((e as Error).message);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const input: PetInput = {
      name: name.trim(),
      species,
      species_label: species === 'other' ? s(speciesLabel)?.slice(0, 30) ?? null : null,
      emoji,
      notes: s(notes),
      photo,
      breed: s(breed),
      birthday: birthday || null,
      sex: sex || null,
      fixed,
      microchip: s(microchip),
      allergies,
      likes,
      dislikes,
      food: s(food),
      food_amount: s(foodAmount),
      feeding_notes: s(feedingNotes),
      vet_clinic: s(vetClinic),
      vet_name: s(vetName),
      vet_phone: s(vetPhone),
      vet_address: s(vetAddress),
    };
    const id = await run(async () => {
      if (pet) {
        await backend.updatePet(pet.id, input);
        return pet.id;
      }
      const created = await backend.addPet(hid, input);
      const chosen: Template[] = [...picked].sort().map((i) => templates[i]);
      for (const c of custom) {
        if (!c.title.trim()) continue;
        chosen.push({
          title: c.title.trim().slice(0, 60),
          kind: 'daily',
          category: 'care',
          dose: null,
          times: c.time ? [c.time] : [],
          weekdays: [],
          interval_days: null,
          repeat_every: 1,
        });
      }
      for (const t of chosen) {
        await backend.addRoutine(hid, { ...t, pet_id: created.id, start_date: today, assignee: null, notes: null });
      }
      return created.id;
    }, pet ? 'Saved' : `Added ${input.name}`);
    setBusy(false);
    if (id) onSaved(id);
  }

  async function remove() {
    if (!pet) return;
    setBusy(true);
    const ok = await run(() => backend.deletePet(pet.id).then(() => true), `Removed ${pet.name}`);
    setBusy(false);
    if (ok) {
      onClose();
      onDeleted?.();
    }
  }

  const who = name.trim() || (pet ? pet.name : 'them');
  const filled = {
    about: [breed, birthday, sex, microchip].filter(Boolean).length + (fixed !== null ? 1 : 0),
    feeding: [food, foodAmount, feedingNotes].filter((x) => x.trim()).length,
    health: allergies.length,
    prefs: likes.length + dislikes.length,
    vet: [vetClinic, vetName, vetPhone, vetAddress].filter((x) => x.trim()).length,
  };

  return (
    <Sheet
      title={pet ? `Edit ${pet.name}` : 'Add a pet'}
      onClose={onClose}
      footer={
        <button className="btn btn-primary btn-block" form="pet-form" disabled={busy || !name.trim()}>
          {pet ? 'Save changes' : name.trim() ? `Add ${name.trim()}` : 'Add pet'}
        </button>
      }
    >
      <form id="pet-form" className="stack" onSubmit={save}>
        <div className="photo-pick">
          <PetAvatar emoji={emoji} photo={photo} size="xl" />
          <div className="stack-tight">
            <button type="button" className="btn btn-quiet btn-small" onClick={() => fileRef.current?.click()}>
              {Icons.camera}
              {photo ? 'Change photo' : 'Add a photo'}
            </button>
            {photo && (
              <button type="button" className="btn-text btn-text-small" onClick={() => setPhoto(null)}>
                Remove photo
              </button>
            )}
            <input
              ref={fileRef}
              id="pet-photo"
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                onFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        </div>
        {photoError && <p className="form-error">{photoError}</p>}

        <Field label="Name">
          <input id="pet-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} autoFocus={!pet} />
        </Field>
        <div className="field">
          <span className="field-label">Kind of pet</span>
          <Chips<Species> label="Kind of pet" value={species} onChange={chooseSpecies} options={SPECIES.map((x) => ({ value: x.key, label: x.label }))} />
        </div>
        {species === 'other' && (
          <Field label="What kind of pet">
            <input
              id="pet-kind"
              value={speciesLabel}
              onChange={(e) => setSpeciesLabel(e.target.value)}
              maxLength={30}
              placeholder="Hedgehog, chinchilla, tarantula…"
              autoFocus={!pet}
            />
          </Field>
        )}
        {!photo && (
          <div className="field">
            <span className="field-label">Icon</span>
            <div className="emoji-grid" role="radiogroup" aria-label="Icon">
              {choices.map((x) => (
                <button
                  type="button"
                  key={x}
                  role="radio"
                  aria-checked={emoji === x}
                  className={`emoji-choice${emoji === x ? ' emoji-on' : ''}`}
                  onClick={() => setEmoji(x)}
                >
                  {x}
                </button>
              ))}
            </div>
            <div className="emoji-any">
              <input
                id="pet-emoji"
                value={emojiDraft}
                onChange={(e) => {
                  const picked = lastEmoji(e.target.value);
                  if (picked) {
                    setEmoji(picked);
                    setEmojiDraft(picked);
                  } else setEmojiDraft(e.target.value.slice(-8));
                }}
                onBlur={() => setEmojiDraft('')}
                aria-label="Use any emoji"
                placeholder="Or type any emoji"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <span className="field-hint">On iPhone, tap the box, then the smiley or globe key for every emoji.</span>
              {emojiDraft && !lastEmoji(emojiDraft) && <span className="field-hint late">That isn’t an emoji. Try the emoji keyboard.</span>}
            </div>
          </div>
        )}

        {!pet && (
          <fieldset className="field templates">
            <legend className="field-label">Start with these routines</legend>
            <span className="field-hint">
              Uncheck any you don’t need, or add your own. You can change times, assign people, and add medications later.
            </span>
            {templates.map((t, i) => (
              <label key={t.title} className="check-row">
                <input
                  type="checkbox"
                  checked={picked.has(i)}
                  onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(i);
                    else next.delete(i);
                    setPicked(next);
                  }}
                />
                <span>
                  {t.title}
                  <span className="muted"> {describeSchedule({ ...(t as Routine), start_date: today, active: true }).replace(/, due today$/, '')}</span>
                </span>
              </label>
            ))}
            {custom.map((c, i) => (
              <div className="custom-task" key={i}>
                <input
                  id={`custom-title-${i}`}
                  value={c.title}
                  onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                  maxLength={60}
                  placeholder="Task name"
                  aria-label={`Your task ${i + 1}`}
                  autoFocus={!c.title}
                />
                <input
                  id={`custom-time-${i}`}
                  type="time"
                  value={c.time}
                  onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)))}
                  aria-label={`Time for your task ${i + 1}`}
                />
                <button type="button" className="icon-btn" onClick={() => setCustom(custom.filter((_, j) => j !== i))} aria-label="Remove this task">
                  {Icons.close}
                </button>
              </div>
            ))}
            <button type="button" className="btn-text" onClick={() => setCustom([...custom, { title: '', time: '' }])}>
              Add your own task
            </button>
            {custom.length > 0 && <span className="field-hint">Your tasks repeat every day. Leave the time empty for “any time”.</span>}
          </fieldset>
        )}

        <div className="profile-sections">
          <Section id="feeding" title="Feeding" count={filled.feeding} focus={focus} defaultOpen={!pet}>
            <Field label="What they eat">
              <input id="pet-food" value={food} onChange={(e) => setFood(e.target.value)} maxLength={80} placeholder="Salmon kibble, wet food, hay…" />
            </Field>
            <Field label="How much per meal">
              <input id="pet-food-amount" value={foodAmount} onChange={(e) => setFoodAmount(e.target.value)} maxLength={80} placeholder="1 cup, half a can, 2 scoops" />
            </Field>
            <Field label="Feeding instructions">
              <textarea
                id="pet-feeding-notes"
                value={feedingNotes}
                onChange={(e) => setFeedingNotes(e.target.value)}
                rows={2}
                maxLength={1000}
                placeholder="Soak it first, slow feeder bowl, pill goes in breakfast"
              />
            </Field>
          </Section>

          <Section id="health" title="Allergies" count={filled.health} focus={focus}>
            <div className="field">
              <span className="field-label">Allergic to</span>
              <TagInput id="pet-allergies" label="Allergies" values={allergies} onChange={setAllergies} tone="alert" placeholder="Chicken, bee stings… then return" />
            </div>
          </Section>

          <Section id="prefs" title="Likes and dislikes" count={filled.prefs} focus={focus}>
            <div className="field">
              <span className="field-label">{who} likes</span>
              <TagInput id="pet-likes" label="Likes" values={likes} onChange={setLikes} placeholder="Tennis balls, belly rubs… then return" />
            </div>
            <div className="field">
              <span className="field-label">{who} doesn’t like</span>
              <TagInput id="pet-dislikes" label="Dislikes" values={dislikes} onChange={setDislikes} placeholder="Golden retrievers, baths… then return" />
              <span className="field-hint">Other dogs, people, sounds, places. Sitters see this too.</span>
            </div>
          </Section>

          <Section id="vet" title="Vet" count={filled.vet} focus={focus}>
            {otherVets.length > 0 && !filled.vet && (
              <div className="chips">
                {otherVets.slice(0, 3).map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    className="chip"
                    onClick={() => {
                      setVetClinic(p.vet_clinic ?? '');
                      setVetName(p.vet_name ?? '');
                      setVetPhone(p.vet_phone ?? '');
                      setVetAddress(p.vet_address ?? '');
                    }}
                  >
                    Same vet as {p.name}
                  </button>
                ))}
              </div>
            )}
            <Field label="Clinic">
              <input id="pet-vet-clinic" value={vetClinic} onChange={(e) => setVetClinic(e.target.value)} maxLength={80} placeholder="Prospect Park Animal Clinic" />
            </Field>
            <Field label="Vet’s name">
              <input id="pet-vet-name" value={vetName} onChange={(e) => setVetName(e.target.value)} maxLength={60} placeholder="Dr. Lee" />
            </Field>
            <Field label="Phone">
              <input id="pet-vet-phone" type="tel" inputMode="tel" value={vetPhone} onChange={(e) => setVetPhone(e.target.value)} maxLength={30} />
            </Field>
            <Field label="Address">
              <input id="pet-vet-address" value={vetAddress} onChange={(e) => setVetAddress(e.target.value)} maxLength={200} autoComplete="street-address" />
            </Field>
          </Section>

          <Section id="about" title="About" count={filled.about} focus={focus}>
            <Field label="Breed">
              <input id="pet-breed" value={breed} onChange={(e) => setBreed(e.target.value)} maxLength={60} placeholder="Lab mix" />
            </Field>
            <Field label="Birthday" hint="A guess is fine. It’s used to show their age.">
              <input id="pet-birthday" type="date" value={birthday} max={today} onChange={(e) => setBirthday(e.target.value)} />
            </Field>
            <div className="field">
              <span className="field-label">Sex</span>
              <Chips<Sex | ''>
                label="Sex"
                value={sex}
                onChange={setSex}
                options={[
                  { value: 'female', label: 'Female' },
                  { value: 'male', label: 'Male' },
                  { value: '', label: 'Not sure' },
                ]}
              />
            </div>
            <label className="check-row">
              <input type="checkbox" checked={!!fixed} onChange={(e) => setFixed(e.target.checked ? true : pet?.fixed === null ? null : false)} />
              <span>{sex === 'female' ? 'Spayed' : sex === 'male' ? 'Neutered' : 'Spayed or neutered'}</span>
            </label>
            <Field label="Microchip number">
              <input id="pet-chip" value={microchip} onChange={(e) => setMicrochip(e.target.value)} maxLength={40} inputMode="numeric" />
            </Field>
          </Section>
        </div>

        <Field label="Other notes" hint="Anything else. Everyone in the household and any sitter sees this.">
          <textarea id="pet-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={1000} placeholder="Spare key is with the doorman" />
        </Field>

        {pet &&
          (confirmDelete ? (
            <div className="danger-zone">
              <p>Remove {pet.name} and all of {pet.name}’s routines, weights and history? This can’t be undone.</p>
              <div className="btn-pair">
                <button type="button" className="btn btn-quiet" onClick={() => setConfirmDelete(false)}>
                  Keep {pet.name}
                </button>
                <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
                  Remove {pet.name}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn-text btn-text-danger" onClick={() => setConfirmDelete(true)}>
              Remove {pet.name}
            </button>
          ))}
      </form>
    </Sheet>
  );
}

/** A part of the profile that folds away. Opens itself when it's the one asked for. */
function Section({
  id,
  title,
  count,
  focus,
  defaultOpen = false,
  children,
}: {
  id: PetSection;
  title: string;
  count: number;
  focus?: PetSection;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const isFocus = focus === id;
  useEffect(() => {
    if (isFocus) ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [isFocus]);
  return (
    <details className="profile-section" ref={ref} open={isFocus || defaultOpen || undefined}>
      <summary>
        <span>{title}</span>
        <span className="muted small">{count ? `${count} filled in` : 'Optional'}</span>
        <span className="profile-section-chev" aria-hidden="true">
          {Icons.down}
        </span>
      </summary>
      <div className="profile-section-body">{children}</div>
    </details>
  );
}
