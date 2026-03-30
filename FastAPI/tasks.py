import os
import sys
import logging
import concurrent.futures
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import cv2
from celery import current_task

from FastAPI.celery_app import celery_app
from FastAPI.object_seg import ObjectSegClient, build_task_artifacts
from db import DBHelper

logger = logging.getLogger(__name__)


class TaskPaths:
    RESULTS_DIR = Path(__file__).resolve().parent / "results"
    OBJECTS_DIR = RESULTS_DIR / "objects"

    @classmethod
    def ensure_paths(cls) -> None:
        cls.RESULTS_DIR.mkdir(parents=True, exist_ok=True)
        cls.OBJECTS_DIR.mkdir(parents=True, exist_ok=True)


class InferenceTasks:
    @staticmethod
    def run_money_inference(image_path: str) -> tuple[float, list[dict], str, bool]:
        from YOLO.inference import MoneyDetector

        detector = MoneyDetector()
        return detector.inference_with_detections(image_path)

    @staticmethod
    def run_object_segmentation(image_path: str) -> dict | None:
        client = ObjectSegClient()
        if not client.enabled:
            return None
        return client.predict(image_path)

    @staticmethod
    def draw_detections(image_path: str, detections: list[dict], output_path: str) -> None:
        image = cv2.imread(image_path)
        if image is None:
            raise ValueError("Failed to read image for drawing.")

        for det in detections:
            box = det["box"]
            x1, y1, x2, y2 = (
                int(box["x1"]),
                int(box["y1"]),
                int(box["x2"]),
                int(box["y2"]),
            )
            label = f"{det['name']} {det['confidence']:.2f}"

            cv2.rectangle(image, (x1, y1), (x2, y2), (20, 220, 140), 2)
            cv2.putText(
                image,
                label,
                (x1, max(y1 - 6, 10)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                (20, 220, 140),
                1,
                cv2.LINE_AA,
            )

        cv2.imwrite(output_path, image)

    @staticmethod
    def run_inference(image_path: str, photo_name: str, login: str) -> dict:
        TaskPaths.ensure_paths()

        try:
            task_id = current_task.request.id or Path(image_path).stem
            try:
                with DBHelper() as db:
                    db.update_task(task_id, "STARTED")
            except Exception:
                pass

            object_payload: dict | None = None
            object_error: str | None = None

            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                money_future = pool.submit(InferenceTasks.run_money_inference, image_path)
                object_future = pool.submit(InferenceTasks.run_object_segmentation, image_path)

                total, detections, preprocessed_path, should_cleanup = money_future.result()

                try:
                    raw_object_payload = object_future.result()
                    if raw_object_payload is not None:
                        object_payload = build_task_artifacts(
                            task_id=task_id,
                            payload=raw_object_payload,
                            results_dir=TaskPaths.RESULTS_DIR,
                        )
                except Exception as exc:
                    logger.exception(
                        "Object segmentation failed for task %s", task_id
                    )
                    object_error = str(exc)

            output_file = TaskPaths.RESULTS_DIR / f"{task_id}.jpg"

            InferenceTasks.draw_detections(preprocessed_path, detections, str(output_file))
            if should_cleanup:
                try:
                    os.remove(preprocessed_path)
                except OSError:
                    pass

            try:
                with DBHelper() as db:
                    db.update_task(
                        task_id,
                        "SUCCESS",
                        result_total=total,
                        result_image=output_file.name,
                    )
                    try:
                        db.add_query(
                            login,
                            "money",
                            output_file.name,
                            total,
                        )
                    except Exception:
                        pass
            except Exception:
                pass

            result_payload = {"total": total, "image_url": f"/results/{output_file.name}"}
            if object_payload:
                result_payload.update(object_payload)
            if object_error:
                result_payload["objects_error"] = object_error

            return result_payload
        except Exception:
            try:
                task_id = current_task.request.id or Path(image_path).stem
                with DBHelper() as db:
                    db.update_task(task_id, "FAILURE")
            except Exception:
                pass
            raise
        finally:
            try:
                os.remove(image_path)
            except OSError:
                pass


TaskPaths.ensure_paths()
run_inference = celery_app.task(name="coin_detector.run_inference")(InferenceTasks.run_inference)
