import { useState, type ReactNode } from 'react';
import { todayISO } from '../lib/dates';
import { feedingLine, hasFeeding, hasVet, mapsHref, mealTimes, petSubtitle, telHref } from '../lib/profile';
import type { Pet, Routine } from '../lib/types';
import { Icons, PetAvatar, Tags } from '../ui';

/**
 * The things anyone looking after a pet needs at a glance: what and how much
 * they eat, allergies, likes and dislikes, and the vet. Shown in the pet
 * dropdowns on Today, Pets and the sitter page, and on the pet's profile.
 */
export function PetQuickInfo({
  pet,
  routines,
  onEdit,
}: {
  pet: Pet;
  routines: Routine[];
  /** Shown as "Add" links for missing parts, for people who can edit. */
  onEdit?: (section: PetSection) => void;
}) {
  const times = mealTimes(pet, routines);
  const empty = !hasFeeding(pet) && !times && !pet.allergies.length && !pet.likes.length && !pet.dislikes.length && !hasVet(pet);
  if (empty && !onEdit) return pet.notes ? <p className="pet-info-notes">{pet.notes}</p> : null;

  return (
    <div className="pet-info">
      <dl className="pet-facts">
        {hasFeeding(pet) || times ? (
          <div>
            <dt>Feeding</dt>
            <dd>
              {pet.food && <span className="pet-fact-strong">{pet.food}</span>}
              {(pet.food_amount || times) && (
                <span>
                  {pet.food_amount ? `${pet.food_amount}${times ? ` at ${times}` : ' per meal'}` : `Meals at ${times}`}
                </span>
              )}
              {pet.feeding_notes && <span className="muted">{pet.feeding_notes}</span>}
            </dd>
          </div>
        ) : (
          onEdit && <Missing label="Feeding" what="How much they eat" onAdd={() => onEdit('feeding')} />
        )}

        {pet.allergies.length > 0 ? (
          <div>
            <dt>Allergies</dt>
            <dd>
              <Tags values={pet.allergies} tone="alert" />
            </dd>
          </div>
        ) : (
          onEdit && <Missing label="Allergies" what="None noted" onAdd={() => onEdit('health')} quiet />
        )}

        {pet.likes.length > 0 && (
          <div>
            <dt>Likes</dt>
            <dd>{pet.likes.join(', ')}</dd>
          </div>
        )}
        {pet.dislikes.length > 0 && (
          <div>
            <dt>Dislikes</dt>
            <dd>{pet.dislikes.join(', ')}</dd>
          </div>
        )}
        {!pet.likes.length && !pet.dislikes.length && onEdit && (
          <Missing label="Likes" what="Favorite things, and what to avoid" onAdd={() => onEdit('prefs')} />
        )}

        {hasVet(pet) ? (
          <div>
            <dt>Vet</dt>
            <dd>
              <span className="pet-fact-strong">{[pet.vet_clinic, pet.vet_name].filter(Boolean).join(', ') || 'Vet'}</span>
              {pet.vet_address && <span className="muted">{pet.vet_address}</span>}
              {(pet.vet_phone || pet.vet_address) && (
                <span className="pet-fact-actions">
                  {pet.vet_phone && (
                    <a className="btn btn-quiet btn-small" href={telHref(pet.vet_phone)}>
                      {Icons.phone}
                      {pet.vet_phone}
                    </a>
                  )}
                  {pet.vet_address && (
                    <a className="btn btn-quiet btn-small" href={mapsHref(pet.vet_address)} target="_blank" rel="noreferrer">
                      Directions
                    </a>
                  )}
                </span>
              )}
            </dd>
          </div>
        ) : (
          onEdit && <Missing label="Vet" what="Their regular vet" onAdd={() => onEdit('vet')} />
        )}
      </dl>
      {pet.notes && <p className="pet-info-notes">{pet.notes}</p>}
    </div>
  );
}

export type PetSection = 'about' | 'feeding' | 'health' | 'prefs' | 'vet';

function Missing({ label, what, onAdd, quiet = false }: { label: string; what: string; onAdd: () => void; quiet?: boolean }) {
  return (
    <div className="pet-fact-missing">
      <dt>{label}</dt>
      <dd>
        <span className={quiet ? 'muted' : 'faint'}>{what}</span>
        <button type="button" className="btn-text btn-text-small" onClick={onAdd}>
          Add
        </button>
      </dd>
    </div>
  );
}

/** One line that sums a pet up for a collapsed dropdown. */
export function petSummary(pet: Pet, routines: Routine[]): string {
  const feeding = feedingLine(pet, routines);
  const parts: string[] = [];
  if (feeding) parts.push(feeding);
  if (pet.allergies.length) parts.push(`allergic to ${pet.allergies.join(', ').toLowerCase()}`);
  if (!parts.length) return petSubtitle(pet, todayISO());
  return parts.join('; ').replace(/^./, (c) => c.toUpperCase());
}

/**
 * A pet with a dropdown: tap the arrow for feeding, allergies, likes and the
 * vet. Used on the Pets list and the sitter page.
 */
export function PetDropdown({
  pet,
  routines,
  onOpen,
  defaultOpen = false,
  children,
}: {
  pet: Pet;
  routines: Routine[];
  /** Tapping the name opens the full profile, when there is one to open. */
  onOpen?: () => void;
  defaultOpen?: boolean;
  /** Extra buttons inside the open dropdown. */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = `pet-drop-${pet.id}`;
  const head = (
    <>
      <PetAvatar emoji={pet.emoji} photo={pet.photo} size="lg" />
      <span className="row-text">
        <span className="row-title row-title-lg">{pet.name}</span>
        <span className="row-meta">
          <span className="row-meta-text">{open ? petSubtitle(pet, todayISO()) : petSummary(pet, routines)}</span>
        </span>
      </span>
    </>
  );
  return (
    <div className={`pet-drop${open ? ' pet-drop-open' : ''}`}>
      <div className="pet-drop-head">
        {onOpen ? (
          <button className="row-main" onClick={onOpen} aria-label={`${pet.name}, full profile`}>
            {head}
          </button>
        ) : (
          <span className="row-main">{head}</span>
        )}
        <button
          className="icon-btn pet-drop-toggle"
          aria-expanded={open}
          aria-controls={id}
          aria-label={open ? `Hide ${pet.name}’s details` : `Show ${pet.name}’s feeding and details`}
          onClick={() => setOpen(!open)}
        >
          {Icons.down}
        </button>
      </div>
      {open && (
        <div className="pet-drop-body" id={id}>
          <PetQuickInfo pet={pet} routines={routines} />
          {children && <div className="pet-drop-actions">{children}</div>}
        </div>
      )}
    </div>
  );
}
