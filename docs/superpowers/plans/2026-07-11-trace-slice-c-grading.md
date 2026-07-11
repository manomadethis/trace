# TRACE Slice C — Grading & Decay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Branch: `slice/grading` off `main` (after Plan 0 lands).
> **Owner:** the grading person. **You export the cleanest seam:** `grade()` + `simulate_decay()`. Zero knowledge of Telegram or routing.

**Goal:** A pure function `grade(image, crop) -> {grade, reason}` via OpenRouter (temp 0, USDA-anchored prompt) and a PIL `simulate_decay(image)` that makes the handoff re-grade read lower.

**Architecture:** Two stateless functions. No DB, no Telegram. The grading prompt is fixed (one string) — **the prompt is the standard**. Decay is image-level degradation, not a score hack.

**Tech Stack:** `httpx` (OpenRouter call), `pillow` (decay), `pytest` with fixture images.

**Specs:** [product spec §8, §8.1–8.3](../../specs/2026-07-11-trace-mvp-design.md) · [impl spec §4 Slice C, §5](../../specs/2026-07-11-trace-implementation-design.md)

**Time budget:** ~half day. Slice B and Slice D both depend on your signatures — land them early.

---

## File structure

```
backend/app/services/__init__.py
backend/app/services/grading.py        # grade(), simulate_decay(), the fixed prompt
backend/tests/fixtures/                 # fresh.jpg, blemished.jpg, decayed.jpg
backend/tests/test_grading.py
```

---

## Task 1: The fixed USDA prompt + grade()

**Files:** `backend/app/services/grading.py`, `backend/tests/test_grading.py`, `backend/tests/fixtures/`

- [ ] **Step 1:** Add 3 fixture images to `backend/tests/fixtures/`: `fresh.jpg`, `blemished.jpg`, `decayed.jpg` (tomatoes with a coin in frame; source royalty-free or photograph). These define the golden cases.

- [ ] **Step 2:** Write `services/grading.py` with the **Golden Prompt** verbatim from product spec §8.2 (USDA §51.1855–1859, coin in frame, A/B/WASTE, JSON-only output). Implement:
```python
import httpx, json
from app.config import settings
GRADE_PROMPT = """You are a produce quality grader following the USDA United States
Standards for Grades of Fresh Tomatoes (§51.1855–1859). A coin is in
the frame as a size reference. Grade this batch of tomatoes by the USDA
definitions, using visible SIZE (vs the coin), MATURITY (color/ripeness),
and DEFECTS (cuts, bruising, growth cracks, soft/wrinkled spots, decay, mold):
- A     = U.S. No. 1 — fairly uniform ripe color, ~free from damage
- B     = U.S. No. 2 — tolerable defects, free from serious damage
- WASTE = below No. 2 — decay / severe damage / unsellable
Reply ONLY: {"grade":"A"|"B"|"WASTE","reason":"one sentence citing the USDA deciding factor"}"""

def grade(image_bytes: bytes, crop: str = "tomato") -> dict:
    for attempt in range(2):  # retry once
        resp = httpx.post("https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {settings.openrouter_api_key}"},
            json={"model": settings.openrouter_model, "temperature": 0,
                  "messages": [{"role":"user","content":[
                      {"type":"text","text":GRADE_PROMPT},
                      {"type":"image_url","image_url":{"url":f"data:image/jpeg;base64,{_b64(image_bytes)}"}}]}]},
            timeout=60)
        try:
            txt = resp.json()["choices"][0]["message"]["content"]
            return json.loads(txt)   # {"grade":..,"reason":..}
        except Exception:
            if attempt: raise
    raise RuntimeError("grade failed after retry")
```
(Add `_b64` helper.) Validate the returned `grade` is in {A,B,WASTE}; else raise.

- [ ] **Step 3:** Write `test_grading.py` with a **live flag-gated** test (`@pytest.mark.skipif(not settings.openrouter_api_key)`) calling `grade(fresh_bytes)` and asserting `grade in {A,B,WASTE}`. Also a **mocked** unit test (monkeypatch `httpx.post`) asserting JSON parsing + retry-on-malformed. Run → PASS. Commit: `feat(grading): grade() USDA prompt + retry`.

---

## Task 2: simulate_decay()

**Files:** `backend/app/services/grading.py`, `backend/tests/test_grading.py`

- [ ] **Step 1:** Implement `simulate_decay` in `grading.py`:
```python
from PIL import Image, ImageEnhance, ImageFilter
import io
def simulate_decay(image_bytes: bytes) -> bytes:
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    img = ImageEnhance.Brightness(img).enhance(0.75)   # darken
    img = ImageEnhance.Color(img).enhance(0.6)          # desaturate / brown
    img = img.filter(ImageFilter.GaussianBlur(radius=1))# soften (soft-spot hint)
    buf = io.BytesIO(); img.save(buf, format="JPEG"); return buf.getvalue()
```

- [ ] **Step 2:** Test (live-gated): `grade(simulate_decay(fresh_bytes))` yields a grade **≤** the fresh grade (A→B or worse). Assert the handoff grade is not better than the farm grade. Run → PASS. Commit: `feat(grading): simulate_decay image degradation`.

---

## Task 3: Export + wire router import path

- [ ] **Step 1:** Ensure `services/grading.py` exports `grade` and `simulate_decay` at module level (it does). Verify `python -c "from app.services.grading import grade, simulate_decay"` works inside the container.
- [ ] **Step 2:** Document the seam in a short module docstring: *"Slice B calls grade() at intake; Slice D calls grade(simulate_decay(photo)) at handoff."* Commit: `docs(grading): seam documentation`.

## Definition of Done

- [ ] `grade(image, crop)` returns `{grade, reason}` against real OpenRouter (live-gated test green when key set)
- [ ] `simulate_decay` demonstrably lowers the grade on a fresh image
- [ ] Mocked unit tests green in CI (no key needed)
- [ ] PR to `main` — Slice B and Slice D unblock on merge

## Critical reminders

- **Temp 0, fixed prompt, every image.** Do not parameterize the prompt per-image.
- Crop is "tomato" only for the MVP (spec §8). The `crop` param is there for the roadmap; don't build pepper logic now.
- Log the raw LLM response on failure before raising — Slice D's audit trail wants it.
