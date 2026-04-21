import json
import os
import re
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from typing import Any

try:
    import google.generativeai as genai
except ImportError:  # pragma: no cover - optional dependency
    genai = None


def _extract_json_blob(text: str) -> dict[str, Any] | None:
    text = text.strip()
    if not text:
        return None

    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        return None
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    if isinstance(parsed, dict):
        return parsed
    return None


def _keyword_fallback(notes: str) -> dict[str, Any]:
    lowered = notes.lower()

    severity = "medium"
    if any(token in lowered for token in ["critical", "severe", "collapsed", "multiple injured", "urgent"]):
        severity = "critical"
    elif any(token in lowered for token in ["minor", "stable", "safe"]):
        severity = "low"

    categories: list[str] = []
    if any(token in lowered for token in ["flood", "water logging", "boat", "submerged"]):
        categories.append("flood-response")
    if any(token in lowered for token in ["medical", "injury", "doctor", "nurse", "bleeding"]):
        categories.append("medical")
    if any(token in lowered for token in ["food", "ration", "meal", "hunger"]):
        categories.append("food-distribution")
    if any(token in lowered for token in ["shelter", "tent", "sleep", "displaced"]):
        categories.append("shelter")
    if any(token in lowered for token in ["earthquake", "debris", "collapsed", "rescue"]):
        categories.append("rescue-support")
    if not categories:
        categories = ["community-support"]

    supply_needs: list[str] = []
    for supply in [
        "water",
        "food",
        "blankets",
        "antibiotics",
        "first aid",
        "medicines",
        "shelter kits",
        "sanitary kits",
    ]:
        if supply in lowered:
            supply_needs.append(supply)

    people_match = re.search(r"(\d{1,4})\s+(people|families|persons|children|patients)", lowered)
    people_count = int(people_match.group(1)) if people_match else 0

    volunteer_need = max(4, min(150, int(round(people_count * 0.18)))) if people_count else 12

    summary = notes.strip()[:320] or "Field report received from volunteer."

    return {
        "summary": summary,
        "severity": severity,
        "categories": categories,
        "supply_needs": supply_needs,
        "people_count_estimate": people_count,
        "required_volunteers_estimate": volunteer_need,
        "image_hint": "Crisis scene reviewed",
    }


def _gemini_client() -> tuple[Any | None, str | None]:
    api_key = os.getenv("GOOGLE_API_KEY", "").strip() or _read_env_value("GOOGLE_API_KEY")
    if not api_key or genai is None:
        return None, None

    genai.configure(api_key=api_key)
    model_name = os.getenv("GEMINI_MODEL", "").strip() or _read_env_value("GEMINI_MODEL") or "gemini-1.5-flash"
    return genai.GenerativeModel(model_name), model_name


def _read_env_value(key: str) -> str:
    backend_root = Path(__file__).resolve().parents[2]
    project_root = backend_root.parent
    candidates = [backend_root / ".env", project_root / ".env"]

    for env_file in candidates:
        if not env_file.exists():
            continue
        try:
            lines = env_file.read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        for raw_line in lines:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            env_key, value = line.split("=", 1)
            if env_key.strip() == key:
                return value.strip().strip("'").strip('"')
    return ""


def _generate_with_timeout(model: Any, parts: Any, timeout_seconds: float = 8.0):
    executor = ThreadPoolExecutor(max_workers=1)
    future = executor.submit(model.generate_content, parts)
    try:
        return future.result(timeout=timeout_seconds)
    except FutureTimeoutError:
        future.cancel()
        return None
    except Exception:
        future.cancel()
        return None
    finally:
        executor.shutdown(wait=False, cancel_futures=True)


def analyze_crisis_multimodal(
    notes: str,
    image_bytes: bytes | None = None,
    image_mime: str | None = None,
    audio_bytes: bytes | None = None,
    audio_mime: str | None = None,
) -> dict[str, Any]:
    fallback = _keyword_fallback(notes)

    model, model_name = _gemini_client()
    if model is None:
        fallback["analysis_engine"] = "keyword-fallback"
        return fallback

    prompt = (
        "You are an emergency triage AI for NGO operations.\n"
        "Analyze the provided text/audio/image and return STRICT JSON only with keys:\n"
        "summary (string), severity (one of low|medium|high|critical), categories (string[]),\n"
        "supply_needs (string[]), people_count_estimate (int), required_volunteers_estimate (int), image_hint (string).\n"
        "Do not include markdown.\n"
        f"Field notes: {notes}\n"
    )

    parts: list[Any] = [prompt]
    if image_bytes:
        parts.append({"mime_type": image_mime or "image/jpeg", "data": image_bytes})
    if audio_bytes:
        parts.append({"mime_type": audio_mime or "audio/webm", "data": audio_bytes})

    try:
        response = _generate_with_timeout(model, parts, timeout_seconds=8.0)
        if response is None:
            parsed = None
        else:
            text = getattr(response, "text", "") or ""
            parsed = _extract_json_blob(text)
    except Exception:
        parsed = None

    if not parsed:
        fallback["analysis_engine"] = f"{model_name}-fallback"
        return fallback

    merged = {
        "summary": str(parsed.get("summary") or fallback["summary"]),
        "severity": str(parsed.get("severity") or fallback["severity"]).lower(),
        "categories": parsed.get("categories") if isinstance(parsed.get("categories"), list) else fallback["categories"],
        "supply_needs": parsed.get("supply_needs") if isinstance(parsed.get("supply_needs"), list) else fallback["supply_needs"],
        "people_count_estimate": int(parsed.get("people_count_estimate") or fallback["people_count_estimate"]),
        "required_volunteers_estimate": int(parsed.get("required_volunteers_estimate") or fallback["required_volunteers_estimate"]),
        "image_hint": str(parsed.get("image_hint") or fallback["image_hint"]),
        "analysis_engine": model_name,
    }
    if merged["severity"] not in {"low", "medium", "high", "critical"}:
        merged["severity"] = fallback["severity"]
    return merged


def build_dispatch_briefing(
    need_title: str,
    ngo_name: str,
    address: str | None,
    start_time: str | None,
    selected_volunteers: list[dict[str, Any]],
    emergency_level: str,
) -> dict[str, str]:
    fallback_message = (
        f"Urgent deployment for '{need_title}' by {ngo_name}. "
        f"Location: {address or 'shared in app'}. "
        f"Start: {start_time or 'ASAP'}. "
        f"Priority: {emergency_level}."
    )

    model, model_name = _gemini_client()
    if model is None:
        return {
            "briefing": fallback_message,
            "subject": f"Dispatch: {need_title}",
            "engine": "template-fallback",
        }

    volunteer_summary = ", ".join(
        f"{item.get('name', item.get('id'))} ({item.get('distance_km', '?')}km, fit {item.get('dispatch_score', 0):.2f})"
        for item in selected_volunteers[:8]
    )

    prompt = (
        "Write a concise NGO deployment briefing (max 120 words) for volunteers. "
        "Tone: clear, urgent, actionable. Include where, when, and expected role.\n"
        f"Need: {need_title}\n"
        f"NGO: {ngo_name}\n"
        f"Address: {address or 'shared in app'}\n"
        f"Start: {start_time or 'ASAP'}\n"
        f"Emergency level: {emergency_level}\n"
        f"Selected volunteers: {volunteer_summary}\n"
        "Return JSON: {\"subject\": string, \"briefing\": string}"
    )

    try:
        response = _generate_with_timeout(model, prompt, timeout_seconds=8.0)
        if response is None:
            parsed = None
        else:
            parsed = _extract_json_blob(getattr(response, "text", "") or "")
    except Exception:
        parsed = None

    if not parsed:
        return {
            "briefing": fallback_message,
            "subject": f"Dispatch: {need_title}",
            "engine": f"{model_name}-fallback",
        }

    return {
        "briefing": str(parsed.get("briefing") or fallback_message),
        "subject": str(parsed.get("subject") or f"Dispatch: {need_title}"),
        "engine": model_name,
    }
