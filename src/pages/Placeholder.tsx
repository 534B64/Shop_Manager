export default function Placeholder({ title, phase }: { title: string; phase: string }) {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">{title}</h1>
      <p className="text-muted">
        Coming in {phase}. See <code>TASKS.md</code> for the build plan.
      </p>
    </div>
  );
}
