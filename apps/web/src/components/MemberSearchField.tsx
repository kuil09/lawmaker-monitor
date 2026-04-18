import { useEffect, useId, useMemo, useState } from "react";

export type MemberSearchOption = {
  id: string;
  label: string;
};

type MemberSearchFieldProps = {
  label: string;
  options: MemberSearchOption[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
};

function findMatchingOption(
  options: MemberSearchOption[],
  query: string
): MemberSearchOption | null {
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");

  if (!normalizedQuery) {
    return null;
  }

  const exactLabelMatch =
    options.find(
      (option) => option.label.toLocaleLowerCase("ko-KR") === normalizedQuery
    ) ?? null;

  if (exactLabelMatch) {
    return exactLabelMatch;
  }

  const uniquePrefixMatches = options.filter((option) =>
    option.label.toLocaleLowerCase("ko-KR").startsWith(normalizedQuery)
  );

  if (uniquePrefixMatches.length === 1) {
    return uniquePrefixMatches[0] ?? null;
  }

  return null;
}

function findExactOption(
  options: MemberSearchOption[],
  query: string
): MemberSearchOption | null {
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");

  if (!normalizedQuery) {
    return null;
  }

  return (
    options.find(
      (option) => option.label.toLocaleLowerCase("ko-KR") === normalizedQuery
    ) ?? null
  );
}

export function MemberSearchField({
  label,
  options,
  selectedId,
  onSelect,
  placeholder = "의원 이름 또는 정당을 입력하세요",
  className,
  disabled = false
}: MemberSearchFieldProps) {
  const listId = useId();
  const selectedOption = useMemo(
    () => options.find((option) => option.id === selectedId) ?? null,
    [options, selectedId]
  );
  const [query, setQuery] = useState(selectedOption?.label ?? "");
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (isEditing) {
      return;
    }

    if (selectedOption) {
      setQuery(selectedOption.label);
      return;
    }

    if (!query.trim()) {
      setQuery("");
    }
  }, [isEditing, query, selectedOption]);

  return (
    <label
      className={
        className ? `member-search-field ${className}` : "member-search-field"
      }
    >
      <span className="member-search-field__label">{label}</span>
      <div className="member-search-field__control">
        <input
          type="text"
          list={listId}
          aria-label={label}
          className="member-search-field__input"
          value={query}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          onFocus={() => {
            setIsEditing(true);
          }}
          onChange={(event) => {
            const nextValue = event.target.value;
            setQuery(nextValue);

            if (!nextValue.trim()) {
              onSelect(null);
              return;
            }

            const exactOption = findExactOption(options, nextValue);
            if (exactOption) {
              onSelect(exactOption.id);
              return;
            }

            if (selectedId) {
              onSelect(null);
            }
          }}
          onBlur={() => {
            setIsEditing(false);

            if (!query.trim()) {
              onSelect(null);
              return;
            }

            const matchedOption = findMatchingOption(options, query);
            if (matchedOption) {
              setQuery(matchedOption.label);
              onSelect(matchedOption.id);
              return;
            }

            onSelect(null);
          }}
        />
      </div>
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option.id} value={option.label} />
        ))}
      </datalist>
    </label>
  );
}
