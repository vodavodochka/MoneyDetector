from collections import Counter


class MoneyProcessor:

    VALUES = {
        "coin_1": 1,
        "coin_2": 2,
        "coin_5": 5,
        "coin_10": 10,
        "bill_5": 5,
        "bill_10": 10,
        "bill_50": 50,
        "bill_100": 100,
        "bill_200": 200,
        "bill_500": 500,
        "bill_1000": 1000,
        "bill_2000": 2000,
        "bill_5000": 5000
    }
    IGNORE_CLASSES = {"coin_1", "coin_2", "coin_5", "coin_10"}

    @staticmethod
    def iou(box1, box2):
        x1 = max(box1["x1"], box2["x1"])
        y1 = max(box1["y1"], box2["y1"])
        x2 = min(box1["x2"], box2["x2"])
        y2 = min(box1["y2"], box2["y2"])

        inter = max(0, x2 - x1) * max(0, y2 - y1)

        area1 = (box1["x2"] - box1["x1"]) * (box1["y2"] - box1["y1"])
        area2 = (box2["x2"] - box2["x1"]) * (box2["y2"] - box2["y1"])

        union = area1 + area2 - inter

        return inter / union if union > 0 else 0

    @classmethod
    def remove_duplicates(cls, detections, iou_threshold=0.15):

        detections = sorted(
            detections,
            key=lambda x: x["confidence"],
            reverse=True
        )

        result = []

        while detections:

            best = detections.pop(0)
            result.append(best)

            detections = [
                d for d in detections
                if cls.iou(best["box"], d["box"]) < iou_threshold
            ]

        return result

    @classmethod
    def count_money(cls, detections):

        names = [d["name"] for d in detections]
        counts = Counter(names)

        total = 0

        for name, count in counts.items():
            if name in cls.IGNORE_CLASSES:
                continue
            if name not in cls.VALUES:
                continue
            value = cls.VALUES[name]
            total += value * count

        return total
