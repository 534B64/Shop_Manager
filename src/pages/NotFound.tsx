import { Button, EmptyState } from '../components/m3';

export default function NotFound() {
  return (
    <EmptyState icon="search" title="Page not found" action={<Button to="/" touch>Go to the dashboard</Button>}>
      This link may be old. Everything is still reachable from the menu.
    </EmptyState>
  );
}
