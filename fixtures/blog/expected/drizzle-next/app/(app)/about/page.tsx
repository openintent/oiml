// Created once by OSL (@osl/backend-drizzle-next). The About page, declared as a custom page in the model.
// You own this file: OSL never rewrites it.

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold tracking-tight">About</h1>
      <p className="mt-2 text-muted-foreground">What this blog is about.</p>
    </div>
  );
}
