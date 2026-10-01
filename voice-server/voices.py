"""The 13 OnBeat voices: app id -> (Chatterbox model, reference clip in refs/ or None for the built-in voice).

The ids match src/lib/voice/choices.ts. Picked by ear by the owner on 2026-10-01."""

VOICES: dict[str, tuple[str, str | None]] = {
    "f_us_bright": ("turbo", None),
    "f_us_clear": ("turbo", "p341"),
    "f_us_calm": ("turbo", "p294"),
    "f_us_warm": ("turbo", "p362"),
    "f_ca_lively": ("turbo", "p303"),
    "f_gb_calm": ("turbo", "p228"),
    "f_gb_bright": ("turbo", "p250"),
    "m_us_deep": ("turbo", "p311"),
    "m_ca_warm": ("turbo", "p363"),
    "m_gb_calm": ("nano", "p226"),
    "m_gb_warm": ("nano", "p232"),
    "m_gb_bright": ("nano", "p258"),
    "m_gb_gentle": ("nano", "p273"),
}
SPEEDS = (0.85, 1.0, 1.15)
MAX_TEXT = 300


def check_request(body: dict) -> tuple[str, str, float]:
    """(text, voice, speed) from a /speak body, or ValueError."""
    text, voice, speed = body.get("text"), body.get("voice"), body.get("speed")
    if not isinstance(text, str) or not text.strip() or len(text.strip()) > MAX_TEXT:
        raise ValueError("text")
    if voice not in VOICES:
        raise ValueError("voice")
    if not isinstance(speed, (int, float)) or float(speed) not in SPEEDS:
        raise ValueError("speed")
    return text.strip(), voice, float(speed)
