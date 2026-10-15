import { useEffect, useReducer, useRef } from 'react';
import { API } from './api';
import { EVENT_TYPES, initialStream, isTerminal, reduceStream, type StreamState } from './stream';
import type { RunEvent } from './types';

/**
 * Follows a run over SSE. `onFinish` fires once, after the terminal event, and the connection is closed
 * right away so EventSource does not try to reconnect to a finished run.
 */
export function useRunStream(runId: string | null, onFinish?: (state: StreamState) => void): StreamState {
  const [state, dispatch] = useReducer(reduceStream, initialStream);
  const latest = useRef(state);
  latest.current = state;
  const finish = useRef(onFinish);
  finish.current = onFinish;

  useEffect(() => {
    if (!runId) return;
    // `reduceStream` resets on `start`; this covers the gap before the first event arrives.
    dispatch({ type: 'start', runId, provider: '' });
    const es = new EventSource(`${API}/runs/${encodeURIComponent(runId)}/stream`);
    let done = false;
    let working = initialStream;
    const onEvent = (ev: Event) => {
      const data = (ev as MessageEvent<string>).data;
      // The browser also fires a plain `error` Event for connection problems; it carries no data.
      if (typeof data !== 'string') return;
      const event = JSON.parse(data) as RunEvent;
      working = reduceStream(working, event);
      dispatch(event);
      if (isTerminal(event) && !done) {
        done = true;
        es.close();
        finish.current?.(working);
      }
    };
    for (const t of EVENT_TYPES) es.addEventListener(t, onEvent);
    es.addEventListener('error', () => {
      // Closed by the browser (not reconnecting) before a terminal event: report instead of hanging.
      if (!done && es.readyState === EventSource.CLOSED) {
        done = true;
        const event: RunEvent = { type: 'error', message: 'Connection to the server was lost' };
        working = reduceStream(working, event);
        dispatch(event);
        finish.current?.(working);
      }
    });
    return () => es.close();
  }, [runId]);

  return runId ? state : initialStream;
}
