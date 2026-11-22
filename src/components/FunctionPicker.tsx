import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { FUNCTION_CATALOG, NodeBadgeIcon, type FunctionCatalogItem } from './NodeMeta';

interface FunctionPickerProps {
  position: { x: number; y: number } | null;
  onSelect: (item: FunctionCatalogItem) => void;
  onClose: () => void;
}

const CATEGORIES: Array<FunctionCatalogItem['category']> = [
  'CRUD',
  'SQL',
  'Data',
  'Outputs & Alerts',
];

export function FunctionPicker({ position, onSelect, onClose }: FunctionPickerProps) {
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (position) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [position]);

  useEffect(() => {
    if (!position) return;
    function handleDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('mousedown', handleDown);
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('mousedown', handleDown);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [position, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FUNCTION_CATALOG;
    return FUNCTION_CATALOG.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.kind.toLowerCase().includes(q)
    );
  }, [query]);

  if (!position) return null;

  return (
    <div
      ref={containerRef}
      style={{
        left: Math.max(12, Math.min(position.x, window.innerWidth - 276)),
        top: Math.max(12, Math.min(position.y, window.innerHeight - 430)),
      }}
      className="fixed z-50 w-[256px] bg-white border border-[#DCE2EC] rounded-[12px] shadow-[0_14px_38px_rgba(15,23,42,0.14)] overflow-hidden"
    >
      <div className="px-3.5 py-2.5 border-b border-[#F1F5F9] flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Functions"
          className="w-full text-[13px] text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none bg-transparent"
        />
        <Search className="w-4 h-4 text-[#94A3B8] shrink-0" />
      </div>

      <div className="max-h-[360px] overflow-y-auto py-1.5">
        {CATEGORIES.map((category) => {
          const items = filtered.filter((i) => i.category === category);
          if (items.length === 0) return null;
          return (
            <div key={category} className="mb-1.5 last:mb-0">
              <div className="px-3.5 py-1.5 text-[11.5px] font-medium text-[#64748B]">
                {category}
              </div>
              <div>
                {items.map((item) => (
                  <button
                    key={item.subtype}
                    type="button"
                    onClick={() => onSelect(item)}
                    className="w-full px-3.5 py-2 flex items-center gap-2.5 text-left hover:bg-[#F8FAFC] transition-colors"
                  >
                    <NodeBadgeIcon kind={item.kind} subtype={item.subtype} size="sm" />
                    <span className="text-[13px] font-medium text-[#0F172A] truncate">
                      {item.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="px-4 py-6 text-center text-[12.5px] text-[#94A3B8]">
            No functions match &ldquo;{query}&rdquo;
          </div>
        )}
      </div>
    </div>
  );
}
