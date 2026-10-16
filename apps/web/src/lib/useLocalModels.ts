import { useEffect, useState } from 'react';
import { api } from './api';

/** Models installed in the local Ollama (empty when it is down or unreachable). Loaded once when the component mounts. */
export function useLocalModels(): string[] {
  const [models, setModels] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    api
      .router()
      .then((r) => !cancelled && setModels(r.local?.modelos ?? []))
      .catch(() => undefined); // optional: the select still offers the CLI models
    return () => {
      cancelled = true;
    };
  }, []);
  return models;
}
