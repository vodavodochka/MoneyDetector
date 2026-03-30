import os
import sys
from pathlib import Path

from celery import Celery


class CeleryProvider:
    PROJECT_ROOT = Path(__file__).resolve().parents[1]

    @classmethod
    def ensure_path(cls) -> None:
        if str(cls.PROJECT_ROOT) not in sys.path:
            sys.path.insert(0, str(cls.PROJECT_ROOT))

    @staticmethod
    def get_redis_url() -> str:
        return os.getenv("REDIS_URL", "redis://localhost:6379/0")

    @classmethod
    def create_app(cls) -> Celery:
        cls.ensure_path()

        app = Celery(
            "coin_detector",
            broker=cls.get_redis_url(),
            backend=cls.get_redis_url(),
            include=["FastAPI.tasks"],
        )

        app.conf.update(
            task_serializer="json",
            accept_content=["json"],
            result_serializer="json",
            timezone="UTC",
            enable_utc=True,
        )

        app.autodiscover_tasks(["FastAPI"])
        return app


celery_app = CeleryProvider.create_app()
