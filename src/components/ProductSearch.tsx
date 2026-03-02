import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { ALLOWED_ARTICLES } from "@/config/articles";

interface ProductSearchProps {
  onSelect: (productId: string) => void;
}

const articles = [...ALLOWED_ARTICLES.entries()].map(([key, desc]) => ({
  id: key,
  label: `${key} — ${desc}`,
}));

export function ProductSearch({ onSelect }: ProductSearchProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const filtered = query.length > 0
    ? articles.filter((a) =>
        a.label.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 20)
    : [];

  useEffect(() => {
    setHighlightIndex(0);
  }, [query]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function select(id: string) {
    setQuery(id);
    setOpen(false);
    onSelect(id);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(filtered[highlightIndex]!.id);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapperRef} className="relative w-full max-w-md">
      <Input
        placeholder="Søk produkt (artikkelnr eller beskrivelse)…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => query.length > 0 && setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md">
          {filtered.map((item, i) => (
            <li
              key={item.id}
              className={`cursor-pointer px-3 py-2 text-sm ${
                i === highlightIndex ? "bg-accent text-accent-foreground" : ""
              }`}
              onMouseEnter={() => setHighlightIndex(i)}
              onMouseDown={() => select(item.id)}
            >
              {item.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
