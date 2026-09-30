import { useEffect, useState } from 'react';
import { Button, Card, CardHeader, TextField, showSnackbar } from '../../../components/m3';
import { get, put } from '../../../lib/api';
import { errorText } from '../../../lib/errorText';
import { setCompanyName } from '../../../lib/branding';
import { brandName, COMPANY_NAME_MAX } from '../../../../shared/branding';

/** The company name shown next to “Shop Manager” in the title, top bar, sign-in screen and printed sheets. */
export default function CompanyCard() {
  const [saved, setSaved] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<{ companyName: string }>('/api/settings/company')
      .then((d) => { setSaved(d.companyName); setText(d.companyName); })
      .catch((e) => setError(errorText(e)));
  }, []);

  async function save() {
    setBusy(true); setError(null);
    try {
      const d = await put<{ companyName: string }>('/api/settings/company', { companyName: text });
      setSaved(d.companyName); setText(d.companyName); setCompanyName(d.companyName);
      showSnackbar('Company saved');
    } catch (e) { setError(errorText(e, 'Save failed')); }
    finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader title="Company" subtitle="Shown on the sign-in screen, the top bar and printed sheets. Leave blank to show just “Shop Manager”." />
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <TextField label="Company name" value={text} maxLength={COMPANY_NAME_MAX} disabled={saved === null && !error || busy}
          onChange={(e) => setText(e.target.value)} supportingText={`Shows as: ${brandName(text)}`} />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saved === null || busy || text.trim() === saved}>{busy ? 'Saving…' : 'Save'}</Button>
          {error && <span role="alert" className="text-body-medium text-error">{error}</span>}
        </div>
      </form>
    </Card>
  );
}
