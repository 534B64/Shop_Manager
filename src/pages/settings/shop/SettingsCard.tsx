// A settings card: numeric fields loaded from one GET, saved with one PUT.
// Shows loading / error, validates ranges, disables while saving, and
// re-reads the server's answer after saving.
import { useEffect, useState } from 'react';
import { Button, Card, CardHeader, LinearProgress, TextField, showSnackbar } from '../../../components/m3';
import { get, put } from '../../../lib/api';
import { errorText } from '../../../lib/errorText';
import { numberIn, rangeMsg } from '../logic';

export interface NumField {
  key: string; label: string; min: number; max: number; suffix?: string; hint?: string;
  /** Server value → text (default String). */
  show?: (v: number) => string;
  /** Parsed text → server value (default identity). */
  send?: (n: number) => number;
}

export default function SettingsCard({ title, subtitle, url, fields, pick, body }: {
  title: string; subtitle?: string; url: string; fields: NumField[];
  /** Server JSON → { key: number }. */
  pick: (data: Record<string, unknown>) => Record<string, number>;
  /** { key: number } → PUT body (default: as-is). */
  body?: (v: Record<string, number>) => unknown;
}) {
  const [text, setText] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const fill = (data: Record<string, unknown>) => {
    const v = pick(data);
    setText(Object.fromEntries(fields.map((f) => [f.key, (f.show ?? String)(v[f.key] ?? 0)])));
  };
  useEffect(() => {
    setLoadErr(null);
    get<Record<string, unknown>>(url).then((d) => { fill(d); setLoaded(true); }).catch((e) => setLoadErr(errorText(e)));
  }, [url, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = Object.fromEntries(fields.map((f) => [f.key, numberIn(text[f.key] ?? '', f.min, f.max)]));
  const invalid = fields.some((f) => parsed[f.key] === null);

  async function save() {
    if (invalid) return;
    setBusy(true); setError(null);
    const values = Object.fromEntries(fields.map((f) => [f.key, (f.send ?? ((n: number) => n))(parsed[f.key]!)]));
    try {
      await put(url, body ? body(values) : values);
      fill(await get<Record<string, unknown>>(url)); // server truth
      showSnackbar(`${title} saved`);
    } catch (e) { setError(errorText(e, 'Save failed')); }
    finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      <div className="h-1 mb-2">{!loaded && !loadErr && <LinearProgress label={`Loading ${title}`} />}</div>
      {loadErr ? (
        <p role="alert" className="text-body-medium text-error">{loadErr}{' '}
          <button type="button" className="text-primary underline" onClick={() => setTick((t) => t + 1)}>Try again</button></p>
      ) : (
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
          {fields.map((f) => (
            <TextField key={f.key} label={f.suffix ? `${f.label} (${f.suffix})` : f.label} inputMode="decimal"
              value={text[f.key] ?? ''} disabled={!loaded || busy}
              onChange={(e) => setText({ ...text, [f.key]: e.target.value })}
              error={loaded && parsed[f.key] === null ? rangeMsg(f.min, f.max) : null} supportingText={f.hint} />
          ))}
          <div className="sm:col-span-2 flex items-center gap-3">
            <Button type="submit" disabled={!loaded || busy || invalid}>{busy ? 'Saving…' : 'Save'}</Button>
            {error && <span role="alert" className="text-body-medium text-error">{error}</span>}
          </div>
        </form>
      )}
    </Card>
  );
}
