import { useId, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Search } from 'lucide-react';
import type { Player } from '@swu-tcc/core';

export function PlayerSearch({
  players,
  selectedId,
  onSelect,
}: {
  players: Player[];
  selectedId?: string | null;
  onSelect: (playerId: string) => void;
}) {
  const uid = useId();
  const selectedName = players.find((p) => p.id === selectedId)?.name ?? '';
  const [query, setQuery] = useState(selectedName);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || q === selectedName.toLowerCase()) return players.slice(0, 8);
    return players.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8);
  }, [players, query, selectedName]);

  const choose = (p: Player) => {
    setQuery(p.name);
    setOpen(false);
    onSelect(p.id);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && open && matches[active]) {
      e.preventDefault();
      choose(matches[active]!);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const listId = `${uid}-list`;
  return (
    <div className="search">
      <label htmlFor={`${uid}-in`} className="field-label">
        Find your name
      </label>
      <div className="input-wrap">
        <Search size={18} aria-hidden="true" />
        <input
          id={`${uid}-in`}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && matches[active] ? `${uid}-o-${matches[active]!.id}` : undefined}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="Start typing your Melee name"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKey}
        />
      </div>
      {open && (
        <ul id={listId} role="listbox" aria-label="Players" className="options">
          {matches.length === 0 && <li className="no-match">No player matches "{query}".</li>}
          {matches.map((p, i) => (
            <li
              key={p.id}
              id={`${uid}-o-${p.id}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(p);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {p.name}
              {p.dropped && <span className="tag">DROPPED</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
