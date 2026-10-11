interface SearchBarProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onClear: () => void;
}

export function SearchBar({ value, onChange, onSubmit, onClear }: SearchBarProps) {
  return (
    <form
      className="search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="search__field">
        <span aria-hidden="true" style={{ color: 'var(--text-tertiary)' }}>
          ⌕
        </span>
        <input
          className="search__input"
          type="search"
          value={value}
          placeholder="Search the archive…"
          aria-label="Search archived mail"
          onChange={(event) => onChange(event.target.value)}
        />
        {value.length > 0 && (
          <button type="button" className="search__clear" aria-label="Clear search" onClick={onClear}>
            ×
          </button>
        )}
      </div>
    </form>
  );
}
