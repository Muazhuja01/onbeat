export default function Home() {
  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-caption font-bold">OnBeat</h1>
      <p className="text-body text-muted">The conversation screen is coming in the next tasks.</p>
      <div id="replies" tabIndex={-1} />
    </main>
  );
}
