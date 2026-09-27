import type { VoiceMode } from "@/lib/voice/engine";

export function VoiceStatus({ mode, progress }: { mode: VoiceMode; progress: number }) {
  const text =
    mode === "loading"
      ? `Getting the natural voice ready… ${Math.max(0, Math.min(100, progress))}%. The basic voice works in the meantime.`
      : mode === "basic"
        ? "Using the basic voice."
        : "Natural voice ready.";
  return <p className="text-label text-muted">{text}</p>;
}
