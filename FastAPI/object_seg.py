import base64
import json
import mimetypes
import os
import re
from pathlib import Path
from typing import Any

import requests


def _safe_label(label: Any) -> str:
    if isinstance(label, str):
        cleaned = re.sub(r"[^a-z0-9_-]+", "_", label.lower()).strip("_")
        if cleaned:
            return cleaned
    return "object"


def _safe_score(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _safe_bbox(value: Any) -> list[float] | None:
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        return None
    if not all(isinstance(item, (int, float)) for item in value):
        return None
    return [float(item) for item in value]


def _labels_from_instances(instances: list[dict[str, Any]]) -> list[str]:
    labels: list[str] = []
    for instance in instances:
        label = instance.get("label")
        if isinstance(label, str) and label.strip():
            labels.append(label.strip())
    return sorted(set(labels))


class ObjectSegClient:
    def __init__(self) -> None:
        raw_url = os.getenv("OBJECT_SEG_API_URL", "").strip()
        self._base_url = raw_url.rstrip("/")
        raw_timeout = os.getenv("OBJECT_SEG_TIMEOUT_SECONDS", "120").strip()
        try:
            self._timeout_seconds = float(raw_timeout)
        except ValueError:
            self._timeout_seconds = 120.0

    @property
    def enabled(self) -> bool:
        return bool(self._base_url)

    @staticmethod
    def _guess_content_type(image_path: str) -> str:
        guessed_type, _ = mimetypes.guess_type(image_path)
        if guessed_type and guessed_type.startswith("image/"):
            return guessed_type
        return "image/jpeg"

    def predict(self, image_path: str) -> dict[str, Any]:
        if not self.enabled:
            return {"objects": [], "instances": []}

        content_type = self._guess_content_type(image_path)
        with open(image_path, "rb") as image_file:
            response = requests.post(
                f"{self._base_url}/predict",
                files={
                    "file": (
                        Path(image_path).name,
                        image_file,
                        content_type,
                    )
                },
                headers={"Accept": "application/json"},
                timeout=self._timeout_seconds,
            )

        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("Object segmentation response must be a JSON object.")
        return payload


def build_task_artifacts(
    task_id: str,
    payload: dict[str, Any],
    results_dir: Path,
) -> dict[str, Any]:
    raw_objects = payload.get("objects")
    raw_instances = payload.get("instances")

    objects: list[str] = []
    if isinstance(raw_objects, list):
        for item in raw_objects:
            if isinstance(item, str) and item.strip():
                objects.append(item.strip())

    instances: list[dict[str, Any]] = []
    if isinstance(raw_instances, list):
        object_dir = results_dir / "objects" / task_id
        object_dir.mkdir(parents=True, exist_ok=True)

        for index, item in enumerate(raw_instances):
            if not isinstance(item, dict):
                continue

            encoded = item.get("png_base64")
            if not isinstance(encoded, str) or not encoded:
                continue

            try:
                image_bytes = base64.b64decode(encoded, validate=True)
            except Exception:
                continue

            label = item.get("label") if isinstance(item.get("label"), str) else "object"
            file_name = f"{index:03d}_{_safe_label(label)}.png"
            file_path = object_dir / file_name
            file_path.write_bytes(image_bytes)

            instances.append(
                {
                    "label": label,
                    "mask_score": _safe_score(item.get("mask_score")),
                    "bbox": _safe_bbox(item.get("bbox")),
                    "bbox_mask_iou": _safe_score(item.get("bbox_mask_iou")),
                    "image_url": f"/results/objects/{task_id}/{file_name}",
                }
            )

    instance_labels = _labels_from_instances(instances)
    if instance_labels:
        objects = instance_labels
    elif not objects:
        objects = []

    artifacts = {
        "objects": objects,
        "instances": instances,
        "objects_count": len(instances),
    }

    metadata_path = results_dir / f"{task_id}.objects.json"
    metadata_path.write_text(
        json.dumps(artifacts, ensure_ascii=False),
        encoding="utf-8",
    )

    return artifacts


def load_task_artifacts(task_id: str, results_dir: Path) -> dict[str, Any] | None:
    metadata_path = results_dir / f"{task_id}.objects.json"
    if not metadata_path.exists():
        return None

    try:
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
    except Exception:
        return None

    if not isinstance(payload, dict):
        return None

    objects = payload.get("objects")
    instances = payload.get("instances")
    objects_count = payload.get("objects_count")

    if not isinstance(instances, list):
        instances = []

    normalized_instances: list[dict[str, Any]] = []
    for item in instances:
        if isinstance(item, dict):
            normalized_instances.append(item)
    instances = normalized_instances

    if not isinstance(objects, list):
        objects = []
    else:
        normalized_objects: list[str] = []
        for item in objects:
            if isinstance(item, str) and item.strip():
                normalized_objects.append(item.strip())
        objects = normalized_objects

    # If segmented objects are present, trust them over broad detection labels.
    instance_labels = _labels_from_instances(instances)
    if instance_labels:
        objects = instance_labels
        objects_count = len(instances)
    elif not isinstance(objects_count, int):
        objects_count = len(objects)

    return {
        "objects": objects,
        "instances": instances,
        "objects_count": objects_count,
    }
