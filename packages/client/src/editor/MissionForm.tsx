import { crewSizeText } from '../screens/Crew.js';
import { MapThumb } from '../screens/MapThumb.js';
import { customIdOf, type Draft } from './draft.js';
import { AreaField, FormHead, NumberField, TextField } from './fields.js';
import { mapSize, MAP_LIMITS, resize } from './tools.js';
import { messagesAt, type Validation } from './validate.js';

interface Props {
  draft: Draft;
  validation: Validation;
  onChange: (draft: Draft) => void;
}

const clock = (sec: number): string =>
  `${Math.floor(sec / 60)}:${String(Math.max(0, sec % 60)).padStart(2, '0')} min`;

/**
 * The mission's own fields, and the card it gets in the mission picker —
 * thumbnail, title, the line of facts — as the join screen will show it.
 */
export function MissionForm({ draft, validation, onChange }: Props) {
  const at = (path: string): string[] => messagesAt(validation, path);
  // The one rule on players has no field of its own in the file's paths.
  const crew = validation.findings.filter((f) => f.path === '' && f.text.startsWith('players:'));
  const { width, height } = mapSize(draft);
  return (
    <div className="editor-mission">
      <div className="editor-card" aria-label="So steht sie in der Auswahl">
        <MapThumb tiles={draft.map.tiles} height={64} />
        <span className="editor-card-text">
          <strong>{draft.title || 'Ohne Titel'}</strong>
          <span className="editor-card-meta">
            {crewSizeText(draft.players)} · {Math.round(draft.timeLimitSec / 60)} min ·{' '}
            {draft.puzzles.length} Stationen
          </span>
          <code className="editor-id">{customIdOf(draft.title)}</code>
        </span>
      </div>
      <TextField
        label="Titel"
        value={draft.title}
        onChange={(title) => onChange({ ...draft, title })}
        issues={at('title')}
      />
      <TextField
        label="Untertitel"
        value={draft.subtitle}
        placeholder="Eine Zeile für die Auswahl"
        onChange={(subtitle) => onChange({ ...draft, subtitle })}
      />
      <div className="editor-row">
        <NumberField
          label="Spieler ab"
          value={draft.players.min}
          onChange={(min) => onChange({ ...draft, players: { ...draft.players, min } })}
          issues={at('players.min')}
        />
        <NumberField
          label="bis"
          value={draft.players.max}
          onChange={(max) => onChange({ ...draft, players: { ...draft.players, max } })}
          issues={[...at('players.max'), ...crew.map((f) => f.message)]}
        />
      </div>
      <NumberField
        label="Zeitlimit in Sekunden"
        value={draft.timeLimitSec}
        note={clock(draft.timeLimitSec)}
        onChange={(timeLimitSec) => onChange({ ...draft, timeLimitSec })}
        issues={at('timeLimitSec')}
      />
      <FormHead title="Karte" where={`${width} × ${height} Felder`} />
      <div className="editor-row">
        <NumberField
          label="Breite"
          value={width}
          note={`${MAP_LIMITS.min}–${MAP_LIMITS.maxWidth}`}
          onChange={(w) => onChange(resize(draft, w, height))}
          issues={at('map.tiles')}
        />
        <NumberField
          label="Höhe"
          value={height}
          note={`${MAP_LIMITS.min}–${MAP_LIMITS.maxHeight}`}
          onChange={(h) => onChange(resize(draft, width, h))}
        />
      </div>
      <FormHead title="Funk" />
      <TextField
        label="Zum Start"
        value={draft.radio.start}
        onChange={(start) => onChange({ ...draft, radio: { ...draft.radio, start } })}
      />
      <TextField
        label="Wenn der Ausgang offen ist"
        value={draft.radio.escape}
        onChange={(escape) => onChange({ ...draft, radio: { ...draft.radio, escape } })}
      />
      <FormHead title="Geschichte" />
      <AreaField
        label="Einleitung"
        value={draft.story.intro}
        onChange={(intro) => onChange({ ...draft, story: { ...draft.story, intro } })}
      />
      <AreaField
        label="Gewonnen"
        value={draft.story.win}
        onChange={(win) => onChange({ ...draft, story: { ...draft.story, win } })}
      />
      <AreaField
        label="Verloren"
        value={draft.story.lose}
        onChange={(lose) => onChange({ ...draft, story: { ...draft.story, lose } })}
      />
    </div>
  );
}
