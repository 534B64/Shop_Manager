import { Button, Card, Icon } from '../components/m3';

/** Placeholder for a route whose page isn't built yet — keeps the URL real. */
export default function ComingSoon({ title, blurb, links = [] }: { title: string; blurb: string; links?: { to: string; label: string }[] }) {
  return (
    <div className="max-w-2xl">
      <h1 className="text-headline-medium mb-4">{title}</h1>
      <Card variant="filled" className="flex gap-4 items-start">
        <Icon name="info" className="text-primary shrink-0 mt-0.5" />
        <div>
          <p className="text-body-large">{blurb}</p>
          {links.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {links.map((l, i) => <Button key={l.to} to={l.to} variant={i === 0 ? 'filled' : 'outlined'} touch>{l.label}</Button>)}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
