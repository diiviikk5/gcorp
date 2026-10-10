"""Deterministic helpers, bit-compatible with web/src/sim/rng.ts."""

M32 = 0xFFFFFFFF


def _imul(a: int, b: int) -> int:
    return (a * b) & M32


def mulberry32(seed: int):
    state = seed & M32

    def rnd() -> float:
        nonlocal state
        state = (state + 0x6D2B79F5) & M32
        t = state
        t = _imul(t ^ (t >> 15), t | 1)
        t = t ^ ((t + _imul(t ^ (t >> 7), t | 61)) & M32)
        return ((t ^ (t >> 14)) & M32) / 4294967296

    return rnd


def fnv1a(text: str) -> str:
    h = 0x811C9DC5
    for ch in text:
        h ^= ord(ch)
        h = _imul(h, 0x01000193)
    return f"{h:08x}"


def clamp(v: float, lo: float, hi: float) -> float:
    return min(hi, max(lo, v))
