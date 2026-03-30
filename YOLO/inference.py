import os
import tempfile
from pathlib import Path

import cv2
import numpy as np
import requests
from dotenv import load_dotenv

from YOLO.processor import MoneyProcessor


class MoneyDetector:

    def __init__(self):
        env_path = Path(__file__).resolve().parent / ".env"
        load_dotenv(dotenv_path=env_path)

        self.url = os.getenv("DEPLOYMENT_URL")
        self.api_key = os.getenv("DEPLOYMENT_API_KEY")
        self.conf_threshold = float(os.getenv("CONF_THRESHOLD", "0.5"))
        self.dup_iou_threshold = float(os.getenv("DUP_IOU_THRESHOLD", "0.2"))
        self.model_conf = float(os.getenv("MODEL_CONF", "0.1"))
        self.model_iou = float(os.getenv("MODEL_IOU", "0.1"))

        self.headers = {
            "Authorization": f"Bearer {self.api_key}"
        }

        self.data = {
            "conf": self.model_conf,
            "iou": self.model_iou,
            "imgsz": 1280
        }

    def _preprocess_image(self, image_path: str) -> tuple[str, bool]:
        image = cv2.imread(image_path)
        if image is None:
            return image_path, False

        img = image.astype(np.float32)
        b, g, r = cv2.split(img)
        mean_b = float(np.mean(b))
        mean_g = float(np.mean(g))
        mean_r = float(np.mean(r))
        mean_gray = (mean_b + mean_g + mean_r) / 3.0
        eps = 1e-6

        b = b * (mean_gray / (mean_b + eps))
        g = g * (mean_gray / (mean_g + eps))
        r = r * (mean_gray / (mean_r + eps))
        img = cv2.merge([b, g, r])
        img = np.clip(img, 0, 255).astype(np.uint8)

        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        l = clahe.apply(l)
        lab = cv2.merge([l, a, b])
        out = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)

        # Gentle warm shift: slightly boost red, slightly reduce blue
        out = out.astype(np.float32)
        out[:, :, 2] = np.clip(out[:, :, 2] * 1.06, 0, 255)  # R
        out[:, :, 0] = np.clip(out[:, :, 0] * 0.97, 0, 255)  # B
        out = out.astype(np.uint8)

        tmp_dir = Path(image_path).parent
        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=".jpg",
            prefix="pre_",
            dir=str(tmp_dir),
        ) as tmp:
            tmp_path = tmp.name

        cv2.imwrite(tmp_path, out)
        return tmp_path, True

    def _send_request(self, image_path):

        with open(image_path, "rb") as f:
            response = requests.post(
                self.url,
                headers=self.headers,
                data=self.data,
                files={"file": f}
            )

        return response.json()

    def _postprocess(self, result):

        detections = result["images"][0]["results"]

        detections = [d for d in detections if d["confidence"] > self.conf_threshold]
        detections = [
            d for d in detections if d.get("name") not in MoneyProcessor.IGNORE_CLASSES
        ]

        detections = MoneyProcessor.remove_duplicates(
            detections, iou_threshold=self.dup_iou_threshold
        )

        total = MoneyProcessor.count_money(detections)

        return total, detections

    def inference(self, image_path):

        preprocessed_path, should_cleanup = self._preprocess_image(image_path)
        try:
            result = self._send_request(preprocessed_path)
        finally:
            if should_cleanup:
                try:
                    os.remove(preprocessed_path)
                except OSError:
                    pass
        total, _ = self._postprocess(result)
        return total

    def inference_with_detections(self, image_path):

        preprocessed_path, should_cleanup = self._preprocess_image(image_path)
        result = self._send_request(preprocessed_path)
        total, detections = self._postprocess(result)
        return total, detections, preprocessed_path, should_cleanup
