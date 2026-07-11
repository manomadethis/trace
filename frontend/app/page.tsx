import { Button } from "@/components/handdrawn/Button";
import { Card } from "@/components/handdrawn/Card";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <Card wobble={1} decoration="tape">
        <h1 className="text-3xl font-bold text-primary">TRACE</h1>
        <p className="mt-2 text-lg text-primary">
          Scaffold + Hand-Drawn components are wired up.
        </p>
        <div className="mt-4">
          <Button variant="accent">Placeholder action</Button>
        </div>
      </Card>
    </main>
  );
}
