/**
 * MentionTextarea — textarea with Discord-style # and @ autocomplete.
 *
 * Type '#' to search channels  → inserts <#channelId>
 * Type '@' to search roles     → inserts <@&roleId>
 */
import { useState, useRef, useEffect } from 'react';
import { Hash, AtSign } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Data types ────────────────────────────────────────────────────────────────

type Channel = { id: string; name: string; guildId: string; guildName: string };
type Role    = { id: string; name: string; color: number; guildId: string; guildName: string };

type MentionItem =
  | { kind: 'channel'; id: string; name: string }
  | { kind: 'role';    id: string; name: string; color: number };

// ── Module-level cache (shared across all instances) ──────────────────────────

let _channels: Channel[] | null = null;
let _roles:    Role[]    | null = null;

function apiBase() {
  return (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
}

async function getChannels(): Promise<MentionItem[]> {
  if (!_channels) {
    try {
      const r = await fetch(`${apiBase()}/api/bot/channels`);
      _channels = r.ok ? await r.json() : [];
    } catch { _channels = []; }
  }
  return (_channels ?? []).map(c => ({ kind: 'channel', id: c.id, name: c.name }));
}

async function getRoles(): Promise<MentionItem[]> {
  if (!_roles) {
    try {
      const r = await fetch(`${apiBase()}/api/bot/roles`);
      _roles = r.ok ? await r.json() : [];
    } catch { _roles = []; }
  }
  return (_roles ?? []).map(r => ({ kind: 'role', id: r.id, name: r.name, color: r.color }));
}

// ── Trigger detection ─────────────────────────────────────────────────────────

type MentionState = {
  trigger: '#' | '@';
  query: string;
  startIndex: number; // position of the trigger char in value
} | null;

function detectMention(text: string, cursor: number): MentionState {
  const slice = text.slice(0, cursor);
  // Match the last # or @ followed by non-whitespace/non-trigger chars up to cursor
  const match = slice.match(/[#@]([^#@\s]*)$/);
  if (!match) return null;
  return {
    trigger:    match[0][0] as '#' | '@',
    query:      match[1],
    startIndex: cursor - match[0].length,
  };
}

// ── Chip renderer (display only) ──────────────────────────────────────────────

/**
 * Renders a message string, replacing <#id> and <@&id> tokens with
 * coloured inline chips. Used in preview panels outside the textarea.
 */
export function DiscordText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(<#\d+>|<@&\d+>)/g);
  return (
    <span className={className}>
      {parts.map((p, i) => {
        const ch = p.match(/^<#(\d+)>$/);
        const rl = p.match(/^<@&(\d+)>$/);
        if (ch) {
          const name = _channels?.find(c => c.id === ch[1])?.name ?? ch[1];
          return (
            <span key={i} className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-xs font-medium bg-indigo-500/20 text-indigo-400">
              <Hash className="w-2.5 h-2.5" />{name}
            </span>
          );
        }
        if (rl) {
          const role = _roles?.find(r => r.id === rl[1]);
          const col = role?.color ? `#${role.color.toString(16).padStart(6, '0')}` : '#99aab5';
          const name = role?.name ?? rl[1];
          return (
            <span key={i} className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-xs font-medium"
              style={{ background: `${col}22`, color: col }}>
              @{name}
            </span>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export type MentionTextareaProps = {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  maxLength?: number;
  /** Hide the # / @ hint row below the textarea */
  hideHint?: boolean;
};

export function MentionTextarea({
  value, onChange, rows = 3, placeholder, className, autoFocus, maxLength, hideHint = false,
}: MentionTextareaProps) {
  const taRef   = useRef<HTMLTextAreaElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const [mention, setMention] = useState<MentionState>(null);
  const [items,   setItems]   = useState<MentionItem[]>([]);
  const [selIdx,  setSelIdx]  = useState(0);

  // ── Load & filter items whenever mention state changes ──────────────────────
  useEffect(() => {
    if (!mention) { setItems([]); return; }
    let cancelled = false;
    (async () => {
      const all = mention.trigger === '#' ? await getChannels() : await getRoles();
      const q   = mention.query.toLowerCase();
      const filtered = q
        ? all.filter(it => it.name.toLowerCase().includes(q)).slice(0, 10)
        : all.slice(0, 10);
      if (!cancelled) { setItems(filtered); setSelIdx(0); }
    })();
    return () => { cancelled = true; };
  }, [mention?.trigger, mention?.query]);

  // ── Close on outside click ──────────────────────────────────────────────────
  useEffect(() => {
    if (!mention) return;
    const handler = (e: MouseEvent) => {
      if (
        !dropRef.current?.contains(e.target as Node) &&
        !taRef.current?.contains(e.target as Node)
      ) setMention(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [!!mention]);

  // ── Insert chosen item ──────────────────────────────────────────────────────
  function insertMention(item: MentionItem) {
    if (!mention || !taRef.current) return;
    const cursorEnd = taRef.current.selectionStart ?? value.length;
    const snippet   = item.kind === 'channel' ? `<#${item.id}>` : `<@&${item.id}>`;
    const before    = value.slice(0, mention.startIndex);
    const after     = value.slice(cursorEnd);
    const newVal    = before + snippet + after;
    onChange(newVal);
    setMention(null);
    requestAnimationFrame(() => {
      if (!taRef.current) return;
      const pos = before.length + snippet.length;
      taRef.current.focus();
      taRef.current.setSelectionRange(pos, pos);
    });
  }

  // ── Handlers ────────────────────────────────────────────────────────────────
  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v      = e.target.value;
    const cursor = e.target.selectionStart ?? v.length;
    onChange(v);
    setMention(detectMention(v, cursor));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!mention || items.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelIdx(i => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelIdx(i => Math.max(i - 1, 0));
    } else if ((e.key === 'Enter' || e.key === 'Tab') && items[selIdx]) {
      e.preventDefault();
      insertMention(items[selIdx]);
    } else if (e.key === 'Escape') {
      setMention(null);
    }
  }

  function handleSelect() {
    if (!taRef.current) return;
    const cursor = taRef.current.selectionStart ?? value.length;
    setMention(detectMention(value, cursor));
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="relative">
      <textarea
        ref={taRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onSelect={handleSelect}
        onClick={handleSelect}
        rows={rows}
        placeholder={placeholder}
        autoFocus={autoFocus}
        maxLength={maxLength}
        className={cn(
          'w-full rounded-md border bg-background px-3 py-2 text-sm resize-y',
          'focus:outline-none focus:ring-2 focus:ring-ring',
          className,
        )}
      />

      {/* ── Autocomplete dropdown ── */}
      {mention && items.length > 0 && (
        <div
          ref={dropRef}
          className="absolute z-50 left-0 right-0 top-full mt-1 rounded-lg border bg-popover shadow-xl overflow-hidden"
          style={{ maxHeight: '13rem' }}
        >
          <div className="px-2 pt-1.5 pb-0.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground border-b select-none">
            {mention.trigger === '#'
              ? <><Hash className="w-3 h-3" /> Salon</>
              : <><AtSign className="w-3 h-3" /> Rôle</>
            }
            {mention.query && <span className="ml-1 font-normal normal-case opacity-70">"{mention.query}"</span>}
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: '10.5rem' }}>
            {items.map((item, i) => (
              <button
                key={item.id}
                type="button"
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors',
                  i === selIdx
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-muted text-foreground',
                )}
                onMouseEnter={() => setSelIdx(i)}
                onMouseDown={e => { e.preventDefault(); insertMention(item); }}
              >
                {item.kind === 'channel' ? (
                  <>
                    <Hash className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate">{item.name}</span>
                  </>
                ) : (
                  <>
                    <span
                      className="w-3 h-3 rounded-full shrink-0 border border-white/10"
                      style={{
                        background: item.color
                          ? `#${item.color.toString(16).padStart(6, '0')}`
                          : '#99aab5',
                      }}
                    />
                    <span className="truncate">{item.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground shrink-0">rôle</span>
                  </>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Hint row ── */}
      {!hideHint && (
        <p className="mt-1 flex items-center gap-4 text-[11px] text-muted-foreground select-none">
          <span className="flex items-center gap-1">
            <Hash className="w-3 h-3" />
            <span>pour mentionner un salon</span>
          </span>
          <span className="flex items-center gap-1">
            <AtSign className="w-3 h-3" />
            <span>pour mentionner un rôle</span>
          </span>
        </p>
      )}
    </div>
  );
}
