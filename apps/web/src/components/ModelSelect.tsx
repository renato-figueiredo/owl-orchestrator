import { useId } from 'react';

/** Models each CLI accepts as a short alias; Ollama's come from what is installed. */
const CLI_MODELS: Record<string, string[]> = { 'claude-cli': ['haiku', 'sonnet', 'opus'], 'codex-cli': [] };

export const modelsFor = (provider: string | undefined, local: string[]): string[] => (provider === 'ollama' ? local : (CLI_MODELS[provider ?? ''] ?? []));

/**
 * A model is always picked from a list, never typed. The empty option means "padrão do provedor" (or `emptyLabel`).
 * A value already saved that is not in the list stays selectable, so opening a screen never changes a setting by itself.
 */
export function ModelSelect({ provider, local, value, onChange, name, id, className, label, emptyLabel = 'padrão do provedor' }: { provider: string | undefined; local: string[]; value: string; onChange?: (v: string) => void; name?: string; id?: string; className?: string; label?: string; emptyLabel?: string }) {
  const auto = useId();
  const options = modelsFor(provider, local);
  const all = value && !options.includes(value) ? [...options, value] : options;
  return (
    <select id={id ?? auto} name={name} aria-label={label} value={value} onChange={(e) => onChange?.(e.target.value)} className={className}>
      <option value="">{emptyLabel}</option>
      {all.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </select>
  );
}
