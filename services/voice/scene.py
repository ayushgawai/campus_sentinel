"""Instant call answers from the precomputed scene script (no model round-trip).

data/feeds/seville_scene_script.json holds, for every second of the demo
clip: the active camera, people visible (YOLO), weapons in view (dataset
hand labels) and Qwen3-VL descriptions of the armed people. The dispatcher's
usual questions (who are you, where, how many, weapons, descriptions,
injuries, location, movement) are answered from the second the wall is
showing, so the answer is immediate and matches the picture.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "data" / "feeds" / "seville_scene_script.json"

SITE = "MacQuarrie Hall at San Jose State University"
ADDRESS = "One Washington Square, San Jose, California"
PLACE = {
    "CAM-01": "the ground-floor lobby",
    "CAM-02": "the east corridor on the ground floor",
    "CAM-03": "the west corridor near the stairwell",
}
# Hand-checked against the labelled frames (who holds what, per stretch of
# the clip). Qwen's per-frame descriptions are the fallback outside these.
DESCRIPTIONS: list[tuple[float, float, str]] = [
    (0, 60, "A man in a red polo shirt and jeans with a handgun. Two men in black T-shirts with handguns. "
            "A man in a white shirt with a handgun, and a man in a light-blue shirt with a knife. "
            "Near the doors, a man in dark clothing with a rifle."),
    (60, 100, "The closest is a man in a dark polo shirt and jeans with a handgun in his left hand. "
              "Ahead of him, a man in a white shirt with a knife."),
    (100, 117, "A man in a black T-shirt and khaki trousers carrying a rifle down by his side, "
               "and ahead of him a man in a black T-shirt with a handgun."),
    (117, 140, "A man in a black T-shirt and jeans with a handgun, and a man in a white shirt with a handgun further down the corridor."),
    (140, 175, "A man in a white T-shirt and blue shorts carrying a rifle, and a man in a light-blue shirt ahead of him."),
    (175, 230, "A man in a black T-shirt and shorts with a handgun, and a man in a light-blue shirt holding a knife."),
    (230, 268, "A man in a black T-shirt and dark trousers holding up a handgun."),
    (268, 340, "A man in a white T-shirt and blue denim shorts carrying a rifle, and a man in a black T-shirt with a handgun."),
]

WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]
PLURAL = {"handgun": "handguns", "rifle": "rifles", "knife": "knives"}


def num(n: int) -> str:
    return WORDS[n] if 0 <= n < len(WORDS) else str(n)


@lru_cache(maxsize=1)
def seconds() -> list[dict[str, Any]]:
    try:
        return json.loads(SCRIPT.read_text())["seconds"]
    except (OSError, ValueError, KeyError):
        return []


def at(t: float) -> dict[str, Any]:
    """The scene at clip second t; inactive seconds borrow the last active one."""
    rows = seconds()
    if not rows:
        return {}
    i = max(0, min(int(t), len(rows) - 1))
    for j in range(i, -1, -1):
        if rows[j].get("camera"):
            return rows[j]
    return rows[i]


def moves(t: float) -> list[tuple[int, str, str]]:
    """Camera changes up to t: (second, from camera, to camera)."""
    out, prev = [], None
    for row in seconds()[: int(t) + 1]:
        cam = row.get("camera")
        if cam and prev and cam != prev:
            out.append((row["t"], prev, cam))
        if cam:
            prev = cam
    return out


def weapons_phrase(w: dict[str, int]) -> str:
    parts = [f"{num(n)} {PLURAL.get(k, k) if n > 1 else k}" for k, n in sorted(w.items(), key=lambda kv: -kv[1]) if n]
    if not parts:
        return "no weapon in view right now"
    return parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]


CLOTHES = ("shirt", "polo", "pants", "shorts", "jeans", "jacket", "hoodie", "sweater", "dress", "skirt", "clothing", "top", "trousers")


def speakable(who: str) -> tuple[str, str]:
    """("man"|"woman"|"person", "a black t-shirt and dark pants") from Qwen's label."""
    parts = [p.strip().removeprefix("wearing ").strip() for p in re.split(r",| and ", who.lower()) if p.strip()]
    noun = "man" if any(p in ("male", "man") for p in parts) else "woman" if any(p in ("female", "woman") for p in parts) else "person"
    clothes = [p for p in parts if any(c in p for c in CLOTHES)]
    clothes = [c if c.split()[0] in ("a", "an", "dark", "light") or c.endswith("s") else f"a {c}" for c in clothes]
    return noun, " and ".join(clothes[:2])


def people_descriptions(s: dict[str, Any], limit: int = 3) -> str:
    groups: dict[tuple[str, str, str], int] = {}
    for a in s.get("armed", []):
        noun, clothes = speakable(str(a.get("person", "")))
        if not clothes:
            continue
        key = (noun, clothes, str(a.get("weapon", "weapon")))
        groups[key] = groups.get(key, 0) + 1
    out = []
    for (noun, clothes, weapon), n in list(groups.items())[:limit]:
        if n == 1:
            out.append(f"a {noun} in {clothes} with a {weapon}")
        else:
            nouns = {"man": "men", "woman": "women"}.get(noun, "people")
            out.append(f"{num(n)} {nouns} in {clothes.replace('a ', '', 1)}, each with a {weapon}")
    return "; ".join(out)


def location(s: dict[str, Any]) -> str:
    return PLACE.get(s.get("camera"), "inside the building")


def movement_line(t: float) -> str:
    history = moves(t)
    s = at(t)
    if not history:
        return f"They are still in {location(s)}, their first location."
    route = [history[0][1]] + [b for _, _, b in history]
    path = " to ".join(PLACE[c].split(" on ")[0].split(" near ")[0] for c in route)
    return f"They went from {path}. They're in {location(s)} now."


def update_line(frm: str, to: str) -> str:
    """Spoken the moment the wall's active camera changes."""
    return f"Update: they have moved from {PLACE.get(frm, 'the last camera')} into {PLACE.get(to, 'another area')}."


INTENTS: list[tuple[tuple[str, ...], str]] = [
    # Phone ASR garbles words ("where you call info"): match loosely.
    (("who are you", "who is this", "who am i", "calling", "call from", "you call", "your name", "who's"), "identity"),
    (("address", "where is the emergency", "what building", "which building"), "address"),
    (("how many", "number of", "count"), "count"),
    (("describe", "description", "look like", "wearing", "clothes", "clothing"), "describe"),
    # Before weapons: "harmed" contains "armed".
    (("hurt", "injur", "harm", "wounded", "bleeding", "shot", "anyone down", "victim"), "injuries"),
    (("weapon", "gun", "armed", "firearm", "knife", "rifle"), "weapons"),
    (("moved", "where did", "coming from", "direction", "heading", "going", "which way"), "movement"),
    (("where are they", "where is", "location", "right now", "where now"), "location"),
    (("update", "anything new", "what's happening", "what is happening", "status"), "status"),
    (("emergency", "what are you reporting", "what happened", "go ahead"), "report"),
    (("where",), "location"),
    (("who",), "identity"),
]


def intent(question: str) -> str | None:
    q = question.lower()
    for keys, name in INTENTS:
        if any(k in q for k in keys):
            return name
    return None


def answer(question: str, t: float) -> str | None:
    """A one- or two-sentence answer for the dispatcher, or None if unknown."""
    kind = intent(question)
    if kind is None or not seconds():
        return None
    s = at(t)
    people, w = int(s.get("people") or 0), s.get("weapons") or {}
    armed = sum(w.values())
    if kind == "identity":
        return (f"This is Campus Sentinel, the automated camera security system at {SITE}. "
                f"I'm calling from the building's camera network, {ADDRESS}.")
    if kind == "address":
        return f"{SITE}, {ADDRESS}. The armed people are in {location(s)}."
    if kind == "report":
        return f"Armed people inside {SITE}. I see {weapons_phrase(w)} in {location(s)}."
    if kind == "count":
        if armed:
            return f"{num(people).capitalize()} people in {location(s)}; {num(min(armed, people) or armed)} of them armed."
        return f"{num(people).capitalize()} people in {location(s)}, no weapon in view this second."
    if kind == "weapons":
        return f"I see {weapons_phrase(w)} in {location(s)}."
    if kind == "describe":
        for a, b, text in DESCRIPTIONS:
            if a <= t < b:
                return text
        d = people_descriptions(s)
        return f"{d[0].upper() + d[1:]}." if d else f"I can't make out clothing clearly on this camera; {num(people)} people in view."
    if kind == "injuries":
        return "No one appears injured, and no one is down on camera."
    if kind == "location":
        return f"They're in {location(s)} of {SITE}."
    if kind == "movement":
        return movement_line(t)
    if kind == "status":
        return f"{num(people).capitalize()} people in {location(s)}, {weapons_phrase(w)}. {movement_line(t)}"
    return None


if __name__ == "__main__":
    assert intent("Where are you calling from?") == "identity"
    assert intent("where you call info") == "identity"
    assert intent("Where are they?") == "location"
    assert intent("How many people do you see?") == "count"
    assert intent("What weapons do they have?") == "weapons"
    assert intent("Describe the persons") == "describe"
    assert intent("Is anyone harmed?") == "injuries"
    assert weapons_phrase({"handgun": 5, "knife": 1}) == "five handguns and one knife"
    assert update_line("CAM-01", "CAM-02").startswith("Update: they have moved from the ground-floor lobby")
    if seconds():
        for q in ("Where are you calling from?", "How many people do you see?", "What weapons do they have?",
                  "Describe the persons", "Is anyone hurt?", "Where are they now?", "Where did they move?"):
            print(f"t=20  {q} -> {answer(q, 20)}")
        print("t=130", answer("Where did they move?", 130))
    print("scene self-check OK")
