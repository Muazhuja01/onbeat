import type { VoiceMode } from "@/lib/voice/engine";
import type { VoiceSource } from "@/lib/voice/messages";

export function voiceStatusText(mode: VoiceMode, source: VoiceSource, progress: number): string {
  if (source === "awake") return "Your voice is ready.";
  if (mode === "basic") return "Using the basic voice.";
  if (source === "down")
    return mode === "natural" ? "Using the backup voice." : `Getting the backup voice ready… ${Math.max(0, Math.min(100, progress))}%. The basic voice works in the meantime.`;
  return "Waking your voice…";
}

export function VoiceStatus({ mode, source, progress }: { mode: VoiceMode; source: VoiceSource; progress: number }) {
  return <p className="text-label text-muted">{voiceStatusText(mode, source, progress)}</p>;
}
