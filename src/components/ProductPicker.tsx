import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronsUpDown, PackageSearch } from 'lucide-react';
import type { StockPosition } from '@/types/db';
import { cn } from '@/lib/utils';
import { formatQty } from '@/lib/format';
import { Badge } from './ui/badge';

function normalize(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function matchesProduct(p: Pick<StockPosition, 'name' | 'sku' | 'barcode'>, q: string) {
  if (!q) return true;
  const n = normalize(q.trim());
  return normalize(p.name).includes(n) || normalize(p.sku).includes(n) || (!!p.barcode && p.barcode.includes(q.trim()));
}

interface Props {
  products: StockPosition[];
  value: string | null;
  onChange: (id: string | null, product: StockPosition | null) => void;
  placeholder?: string;
  showStock?: boolean;
  autoFocus?: boolean;
  id?: string;
  invalid?: boolean;
}

/** Combobox acessível para escolher produto por nome, SKU ou código de barras. */
export function ProductPicker({ products, value, onChange, placeholder = 'Buscar por nome, SKU ou código de barras', showStock = true, autoFocus, id, invalid }: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = products.find((p) => p.id === value) ?? null;
  const results = useMemo(() => products.filter((p) => matchesProduct(p, q)).slice(0, 50), [products, q]);

  useEffect(() => { setActive(0); }, [q]);

  function choose(p: StockPosition) {
    onChange(p.id, p);
    setQ('');
    setOpen(false);
  }

  // Leitor de código de barras: digita o código e "Enter" — se bater exato, seleciona.
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const exact = products.find((p) => p.barcode === q.trim() || p.sku.toLowerCase() === q.trim().toLowerCase());
      if (exact) choose(exact);
      else if (results[active]) choose(results[active]);
    } else if (e.key === 'Escape') { setOpen(false); }
  }

  return (
    <div className="relative">
      <div className={cn('flex h-11 items-center rounded-xl border bg-white transition-colors focus-within:border-acai-400 focus-within:ring-2 focus-within:ring-acai-100', invalid ? 'border-red-400' : 'border-line')}>
        <PackageSearch className="ml-3 h-4 w-4 shrink-0 text-ink-soft" aria-hidden />
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && results[active] ? `${listId}-${results[active].id}` : undefined}
          autoFocus={autoFocus}
          className="h-full min-w-0 flex-1 bg-transparent px-2 text-[15px] placeholder:text-ink-soft focus:outline-none"
          placeholder={selected ? '' : placeholder}
          value={open || !selected ? q : `${selected.name}`}
          onFocus={() => { setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => { setQ(e.target.value); setOpen(true); if (selected) onChange(null, null); }}
          onKeyDown={onKeyDown}
          autoComplete="off"
        />
        <ChevronsUpDown className="mr-3 h-4 w-4 shrink-0 text-ink-soft" aria-hidden />
      </div>
      {open && (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-line bg-white py-1 shadow-pop">
          {results.length === 0 && <li className="px-3 py-3 text-sm text-ink-muted">Nenhum item encontrado.</li>}
          {results.map((p, i) => (
            <li
              key={p.id}
              id={`${listId}-${p.id}`}
              role="option"
              aria-selected={p.id === value}
              onMouseDown={(e) => { e.preventDefault(); choose(p); }}
              onMouseEnter={() => setActive(i)}
              className={cn('flex cursor-pointer items-center gap-2 px-3 py-2 text-sm', i === active && 'bg-acai-50')}
            >
              <Check className={cn('h-4 w-4 shrink-0 text-acai-600', p.id === value ? 'opacity-100' : 'opacity-0')} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-ink">{p.name}{p.is_demo && <Badge tone="warning" className="ml-1.5">DEMO</Badge>}</div>
                <div className="text-[12px] text-ink-muted">{p.sku}{p.barcode ? ` · ${p.barcode}` : ''}</div>
              </div>
              {showStock && p.stock_mode === 'stock' && (
                <span className={cn('shrink-0 text-[12.5px] tabular', p.stock_status === 'out' ? 'text-red-600' : p.stock_status === 'low' ? 'text-mango-700' : 'text-ink-muted')}>
                  {formatQty(p.quantity, p.unit_code)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
