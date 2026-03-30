import uuid
import secrets
import os
from dotenv import load_dotenv
load_dotenv()
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

from celery.result import AsyncResult
from fastapi import Body, Cookie, FastAPI, File, Header, HTTPException, Response, UploadFile, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from FastAPI.celery_app import celery_app
from FastAPI.object_seg import load_task_artifacts
from FastAPI.settings import AppSettings
from FastAPI.tasks import run_inference
from db import DBHelper


class APIPaths:
    BASE_DIR = Path(__file__).resolve().parent
    UPLOAD_DIR = BASE_DIR / "uploads"
    RESULTS_DIR = BASE_DIR / "results"
    OBJECTS_DIR = RESULTS_DIR / "objects"

    @classmethod
    def ensure_dirs(cls) -> None:
        cls.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        cls.RESULTS_DIR.mkdir(parents=True, exist_ok=True)
        cls.OBJECTS_DIR.mkdir(parents=True, exist_ok=True)

    @classmethod
    def load_result_artifacts(cls, task_id: str) -> dict | None:
        return load_task_artifacts(task_id, cls.RESULTS_DIR)


class CoinDetectorAPI:
    @staticmethod
    def _enrich_result_with_objects(task_id: str, payload: dict) -> dict:
        artifacts = APIPaths.load_result_artifacts(task_id)
        if not artifacts:
            return payload

        result_payload = dict(payload)
        # Artifacts are normalized after segmentation and should be authoritative
        # for UI counters/labels.
        result_payload["objects"] = artifacts.get("objects", [])
        result_payload["instances"] = artifacts.get("instances", [])
        result_payload["objects_count"] = artifacts.get("objects_count", 0)
        return result_payload

    @staticmethod
    def get_login_from_token(token: str | None) -> str | None:
        if not token:
            return None
        try:
            with DBHelper() as db:
                res = db.get_user_by_session(token)
            if res.get("success") is True:
                return res.get("login")
        except Exception:
            return None
        return None

    @staticmethod
    def get_login_from_tg_uuid(tg_uuid: str | None) -> str | None:
        if not tg_uuid:
            return None
        try:
            with DBHelper() as db:
                res = db.get_user_by_tg_uuid(tg_uuid)
            if res.get("success") is True:
                return res.get("login")
        except Exception:
            return None
        return None

    @staticmethod
    def resolve_login(
        auth_token: str | None,
        user_token: str | None,
    ) -> str | None:
        if user_token:
            login = CoinDetectorAPI.get_login_from_tg_uuid(user_token)
            if login:
                return login
        return CoinDetectorAPI.get_login_from_token(auth_token)

    @staticmethod
    def is_authorized(token: str | None) -> bool:
        return CoinDetectorAPI.get_login_from_token(token) is not None
    
    @staticmethod
    def is_admin(token: str | None, th_uuid: str | None) -> bool:
        login = CoinDetectorAPI.get_login_from_token(token)
        if not login:
            login = CoinDetectorAPI.get_login_from_tg_uuid(th_uuid)
        if not login:
            return False
        try:
            with DBHelper() as db:
                return db.get_user_root(login) == "admin"
        except Exception:
            return False

    @staticmethod
    def _require_admin(
        auth_token: str | None,
        user_token: str | None,
    ) -> str:
        login = CoinDetectorAPI.resolve_login(auth_token, user_token)
        if not login:
            raise HTTPException(status_code=401, detail="Unauthorized")
        try:
            with DBHelper() as db:
                if db.get_user_root(login) != "admin":
                    raise HTTPException(status_code=403, detail="Forbidden")
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=500, detail="db_error")
        return login

    @staticmethod
    def _parse_datetime(value: str, is_end: bool = False) -> datetime:
        raw = value.strip()
        if raw.endswith("Z"):
            raw = raw.replace("Z", "+00:00")
        if len(raw) == 10 and raw.count("-") == 2:
            raw = f"{raw}T23:59:59" if is_end else f"{raw}T00:00:00"
        try:
            return datetime.fromisoformat(raw)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid datetime format")

    @staticmethod
    def _normalize_range(
        start_raw: str,
        end_raw: str,
        granularity: str | None,
    ) -> tuple[datetime, datetime, str, str]:
        start_dt = CoinDetectorAPI._parse_datetime(start_raw, is_end=False)
        end_dt = CoinDetectorAPI._parse_datetime(end_raw, is_end=True)
        if end_dt < start_dt:
            raise HTTPException(status_code=400, detail="End before start")

        if end_dt - start_dt > timedelta(days=93):
            raise HTTPException(status_code=400, detail="Range exceeds 3 months")

        if granularity is None:
            granularity = "hour" if start_dt.date() == end_dt.date() else "day"
        if granularity not in {"hour", "day"}:
            raise HTTPException(status_code=400, detail="Invalid granularity")

        offset = start_dt.utcoffset() or timedelta()
        total_minutes = int(offset.total_seconds() // 60)
        sign = "+" if total_minutes >= 0 else "-"
        total_minutes = abs(total_minutes)
        tz_offset = f"{sign}{total_minutes // 60:02d}:{total_minutes % 60:02d}"

        return start_dt, end_dt, granularity, tz_offset

    @staticmethod
    def _bucket_range(
        start_dt: datetime,
        end_dt: datetime,
        granularity: str,
        tz_offset: str,
    ) -> list[datetime]:
        tz_hours = int(tz_offset[1:3])
        tz_minutes = int(tz_offset[4:6])
        offset = timedelta(hours=tz_hours, minutes=tz_minutes)
        if tz_offset.startswith("-"):
            offset = -offset
        tzinfo = timezone(offset)

        if start_dt.tzinfo is not None:
            start_dt = start_dt.astimezone(tzinfo)
        else:
            start_dt = start_dt.replace(tzinfo=tzinfo)
        if end_dt.tzinfo is not None:
            end_dt = end_dt.astimezone(tzinfo)
        else:
            end_dt = end_dt.replace(tzinfo=tzinfo)

        if granularity == "hour":
            current = start_dt.replace(minute=0, second=0, microsecond=0)
            end_bucket = end_dt.replace(minute=0, second=0, microsecond=0)
            step = timedelta(hours=1)
        else:
            current = start_dt.replace(hour=0, minute=0, second=0, microsecond=0)
            end_bucket = end_dt.replace(hour=0, minute=0, second=0, microsecond=0)
            step = timedelta(days=1)

        buckets: list[datetime] = []
        while current <= end_bucket:
            buckets.append(current)
            current += step
        return buckets

    @staticmethod
    def _dir_size_bytes(path: Path) -> int:
        total = 0
        if not path.exists():
            return 0
        for root, _, files in os.walk(path):
            for name in files:
                file_path = Path(root) / name
                try:
                    total += file_path.stat().st_size
                except OSError:
                    continue
        return total
    
    @staticmethod
    def ensure_admin_user() -> None:
        try:
            with DBHelper() as db:
                status = db.add_user(
                    AppSettings.ADMIN_LOGIN,
                    AppSettings.ADMIN_PASSWORD,
                    AppSettings.ADMIN_ROOT,
                    AppSettings.ADMIN_DIRECTORY,
                )
                if status.get("success") is True:
                    return
                if status.get("error") == "unique_violation":
                    return
        except Exception:
            return

    @staticmethod
    def health():
        return {"status": "ok"}

    @staticmethod
    async def detect(
        image: UploadFile = File(...),
        auth_token: str | None = Cookie(default=None, alias="coin_detector_token"),
        user_token: str | None = Header(default=None, alias="X-User-Token"),
    ):
        login = CoinDetectorAPI.resolve_login(auth_token, user_token)
        if not login:
            raise HTTPException(status_code=401, detail="Unauthorized")
        try:
            with DBHelper() as db:
                entry_source = "tg" if user_token else "web"
                db.add_entry(login, entry_source)
        except Exception:
            pass
        try:
            with DBHelper() as db:
                token_result = db.consume_tokens(login, AppSettings.TOKEN_COST)
            if token_result.get("success") is not True:
                raise HTTPException(status_code=402, detail="Not enough tokens")
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=500, detail="Token charge failed")

        suffix = Path(image.filename).suffix or ".jpg"
        file_id = uuid.uuid4().hex
        file_path = APIPaths.UPLOAD_DIR / f"{file_id}{suffix}"

        content = await image.read()
        file_path.write_bytes(content)

        task = run_inference.delay(str(file_path), image.filename, login)
        try:
            with DBHelper() as db:
                db.add_task(login, task.id, image.filename)
        except Exception:
            pass
        return {"task_id": task.id}

    @staticmethod
    async def login(response: Response, payload: dict = Body(...)):
        login = payload.get("login")
        password = payload.get("password")
        try:
            with DBHelper() as db:
                if db.authenticate_user(login, password):
                    token = secrets.token_urlsafe(32)
                    db.create_session(login, token)
                    response.set_cookie(
                        key="coin_detector_token",
                        value=token,
                        httponly=True,
                        samesite="lax",
                    )
                    return {"success": True, "token": token}
        except Exception as e:
            return {"success": False, "error": "db_error", "details": str(e)}
        return {"success": False, "error": "invalid_credentials"}

    @staticmethod
    def get_result(
        task_id: str,
        auth_token: str | None = Cookie(default=None, alias="coin_detector_token"),
        user_token: str | None = Header(default=None, alias="X-User-Token"),
    ):
        login = CoinDetectorAPI.resolve_login(auth_token, user_token)
        if not login:
            raise HTTPException(status_code=401, detail="Unauthorized")

        result = AsyncResult(task_id, app=celery_app)

        if result.successful():
            payload = result.result
            if isinstance(payload, dict):
                payload = CoinDetectorAPI._enrich_result_with_objects(task_id, payload)
            return {"status": "SUCCESS", "result": payload}
        if result.failed():
            return {"status": "FAILURE", "error": str(result.result)}

        # Fallback to DB status to avoid stale PENDING from celery backend
        try:
            with DBHelper() as db:
                task = db.get_task_for_user(login, task_id)
            if task.get("success") is True:
                (
                    _task_id,
                    _original_name,
                    status,
                    result_total,
                    result_image,
                    _created_at,
                    _completed_at,
                ) = task["content"]
                if status == "SUCCESS":
                    payload = {
                        "total": float(result_total) if result_total is not None else None,
                        "image_url": f"/results/{result_image}" if result_image else None,
                    }
                    payload = CoinDetectorAPI._enrich_result_with_objects(task_id, payload)
                    return {
                        "status": "SUCCESS",
                        "result": payload,
                    }
                if status == "FAILURE":
                    return {"status": "FAILURE", "error": "processing_failed"}
                return {"status": status}
        except Exception:
            pass

        return {"status": result.status}

    @staticmethod
    def get_result_objects(
        task_id: str,
        auth_token: str | None = Cookie(default=None, alias="coin_detector_token"),
        user_token: str | None = Header(default=None, alias="X-User-Token"),
    ):
        login = CoinDetectorAPI.resolve_login(auth_token, user_token)
        if not login:
            raise HTTPException(status_code=401, detail="Unauthorized")

        try:
            with DBHelper() as db:
                task = db.get_task_for_user(login, task_id)
        except Exception:
            raise HTTPException(status_code=500, detail="db_error")

        if task.get("success") is not True:
            raise HTTPException(status_code=404, detail="Task not found")

        status = task["content"][2]
        if status != "SUCCESS":
            raise HTTPException(status_code=409, detail=f"Task is {status}")

        artifacts = APIPaths.load_result_artifacts(task_id)
        if not artifacts:
            return {"success": True, "objects": [], "instances": [], "objects_count": 0}

        return {"success": True, **artifacts}

    @staticmethod
    def get_history(
        auth_token: str | None = Cookie(default=None, alias="coin_detector_token"),
        user_token: str | None = Header(default=None, alias="X-User-Token"),
    ):
        login = CoinDetectorAPI.resolve_login(auth_token, user_token)
        if not login:
            raise HTTPException(status_code=401, detail="Unauthorized")
        try:
            with DBHelper() as db:
                history = db.get_tasks_for_user(login)
            if history.get("success") is not True:
                return {"success": True, "items": []}

            items = []
            for row in history["content"]:
                task_id, original_name, status, result_total, result_image, created_at, completed_at = row
                item = {
                    "id": str(task_id),
                    "filename": original_name,
                    "status": status,
                    "total": float(result_total) if result_total is not None else None,
                    "createdAt": created_at.isoformat() if created_at else None,
                    "completedAt": completed_at.isoformat() if completed_at else None,
                    "imageUrl": f"/results/{result_image}" if result_image else None,
                }
                artifacts = APIPaths.load_result_artifacts(str(task_id))
                if artifacts:
                    item["objects"] = artifacts.get("objects", [])
                    item["instances"] = artifacts.get("instances", [])
                    item["objectsCount"] = artifacts.get("objects_count", 0)
                items.append(item)
            return {"success": True, "items": items}
        except Exception:
            return {"success": False, "error": "db_error"}

    @staticmethod
    def auth_check(
        auth_token: str | None = Cookie(default=None, alias="coin_detector_token"),
        user_token: str | None = Header(default=None, alias="X-User-Token"),
    ):
        login = CoinDetectorAPI.resolve_login(auth_token, user_token)
        if login:
            try:
                with DBHelper() as db:
                    db.add_entry(login, "web")
            except Exception:
                pass
        return {"authorized": login is not None, "login": login}
    
    @staticmethod
    def require_statistics(
        auth_token: str | None = Cookie(default=None, alias="coin_detector_token"),
        user_token: str | None = Header(default=None, alias="X-User-Token"),
    ):
        login = CoinDetectorAPI.resolve_login(auth_token, user_token)
        if not login:
            raise HTTPException(status_code=401, detail="Unauthorized")
        try:
            with DBHelper() as db:
                if db.get_user_root(login) != "admin":
                    raise HTTPException(status_code=403, detail="Forbidden")
                task_count = db.get_task_count()
                task_pending_count = db.get_tasks_count_by_status("PENDING")
                task_success_count = db.get_tasks_count_by_status("SUCCESS")
                task_failure_count = db.get_tasks_count_by_status("FAILURE")
                users_count = db.get_users_count()
                stats = {
                    "task_count": task_count,
                    "task_pending_count": task_pending_count,
                    "task_success_count": task_success_count,
                    "task_failure_count": task_failure_count,
                    "users_count": users_count,
                }
            
            return {"success": True, "items": stats}
        except HTTPException:
            raise
        except Exception as e:
            return {"success": False, "error": "db_error", "details": str(e)}

    @staticmethod
    def admin_users(
        auth_token: str | None = Cookie(default=None, alias="coin_detector_token"),
        user_token: str | None = Header(default=None, alias="X-User-Token"),
    ):
        CoinDetectorAPI._require_admin(auth_token, user_token)
        try:
            with DBHelper() as db:
                rows = db.get_users_admin_list()
        except Exception as exc:
            return {"success": False, "error": "db_error", "details": str(exc)}

        items = [
            {
                "id": row[0],
                "login": row[1],
                "tg_uuid": row[2],
                "created": row[3].isoformat() if row[3] else None,
            }
            for row in rows
        ]
        return {"success": True, "items": items}

    @staticmethod
    def admin_visits(
        start: str = Query(...),
        end: str = Query(...),
        granularity: str | None = Query(default=None),
        login: str | None = Query(default=None),
        auth_token: str | None = Cookie(default=None, alias="coin_detector_token"),
        user_token: str | None = Header(default=None, alias="X-User-Token"),
    ):
        CoinDetectorAPI._require_admin(auth_token, user_token)
        start_dt, end_dt, bucket, tz_offset = CoinDetectorAPI._normalize_range(start, end, granularity)

        with DBHelper() as db:
            user_id = None
            if login and login.lower() != "all":
                user_id = db.get_user_id_by_login(login)
                if user_id is None:
                    raise HTTPException(status_code=404, detail="User not found")
            rows = db.get_entry_stats(start_dt, end_dt, bucket, tz_offset, user_id=user_id)

        data = {row[0]: int(row[1]) for row in rows}
        items = [
            {"ts": ts.isoformat(), "count": data.get(ts.replace(tzinfo=None), 0)}
            for ts in CoinDetectorAPI._bucket_range(start_dt, end_dt, bucket, tz_offset)
        ]
        return {"success": True, "granularity": bucket, "items": items}

    @staticmethod
    def admin_new_users(
        start: str = Query(...),
        end: str = Query(...),
        granularity: str | None = Query(default=None),
        login: str | None = Query(default=None),
        auth_token: str | None = Cookie(default=None, alias="coin_detector_token"),
        user_token: str | None = Header(default=None, alias="X-User-Token"),
    ):
        CoinDetectorAPI._require_admin(auth_token, user_token)
        start_dt, end_dt, bucket, tz_offset = CoinDetectorAPI._normalize_range(start, end, granularity)

        with DBHelper() as db:
            user_id = None
            if login and login.lower() != "all":
                user_id = db.get_user_id_by_login(login)
                if user_id is None:
                    raise HTTPException(status_code=404, detail="User not found")
            rows = db.get_new_users_stats(start_dt, end_dt, bucket, tz_offset, user_id=user_id)

        data = {row[0]: int(row[1]) for row in rows}
        items = [
            {"ts": ts.isoformat(), "count": data.get(ts.replace(tzinfo=None), 0)}
            for ts in CoinDetectorAPI._bucket_range(start_dt, end_dt, bucket, tz_offset)
        ]
        return {"success": True, "granularity": bucket, "items": items}

    @staticmethod
    def admin_storage(
        auth_token: str | None = Cookie(default=None, alias="coin_detector_token"),
        user_token: str | None = Header(default=None, alias="X-User-Token"),
    ):
        CoinDetectorAPI._require_admin(auth_token, user_token)
        try:
            with DBHelper() as db:
                users_count = db.get_users_count()
        except Exception as exc:
            return {"success": False, "error": "db_error", "details": str(exc)}

        uploads_size = CoinDetectorAPI._dir_size_bytes(APIPaths.UPLOAD_DIR)
        results_size = CoinDetectorAPI._dir_size_bytes(APIPaths.RESULTS_DIR)
        user_data_mb = round((uploads_size + results_size) / (1024 * 1024), 2)

        total_disk_bytes = shutil.disk_usage("/").total
        total_disk_mb = round(total_disk_bytes / (1024 * 1024), 2)

        return {
            "success": True,
            "users_count": users_count,
            "user_data_mb": user_data_mb,
            "total_disk_mb": total_disk_mb,
        }

    @staticmethod
    def get_balance(
        auth_token: str | None = Cookie(default=None, alias="coin_detector_token"),
        user_token: str | None = Header(default=None, alias="X-User-Token"),
    ):
        login = CoinDetectorAPI.resolve_login(auth_token, user_token)
        if not login:
            raise HTTPException(status_code=401, detail="Unauthorized")
        try:
            with DBHelper() as db:
                balance = db.get_user_token_balance(login)
            return {"success": True, "balance": balance, "cost": AppSettings.TOKEN_COST}
        except Exception:
            return {"success": False, "error": "db_error"}

    @staticmethod
    def topup_balance(
        payload: dict = Body(...),
        auth_token: str | None = Cookie(default=None, alias="coin_detector_token"),
        user_token: str | None = Header(default=None, alias="X-User-Token"),
    ):
        login = CoinDetectorAPI.resolve_login(auth_token, user_token)
        if not login:
            raise HTTPException(status_code=401, detail="Unauthorized")

        raw_amount = payload.get("amount")
        try:
            amount = int(raw_amount)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Amount must be a positive integer")

        if amount <= 0:
            raise HTTPException(status_code=400, detail="Amount must be a positive integer")

        try:
            with DBHelper() as db:
                result = db.add_tokens(login, amount)
        except Exception:
            return {"success": False, "error": "db_error"}

        if result.get("success") is not True:
            return {"success": False, "error": result.get("error", "db_error")}

        return {"success": True, "added": amount, "balance": result.get("balance")}

    @staticmethod
    def logout(
        response: Response,
        auth_token: str | None = Cookie(default=None, alias="coin_detector_token"),
    ):
        if auth_token:
            try:
                with DBHelper() as db:
                    db.delete_session(auth_token)
            except Exception:
                pass
        response.delete_cookie("coin_detector_token")
        return {"success": True}

    @classmethod
    def create_app(cls) -> FastAPI:
        APIPaths.ensure_dirs()
        app = FastAPI()

        app.add_middleware(
            CORSMiddleware,
            allow_origins=["http://localhost:3000"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

        app.mount("/results", StaticFiles(directory=APIPaths.RESULTS_DIR), name="results")

        app.add_api_route("/health", cls.health, methods=["GET"])
        app.add_api_route("/detect", cls.detect, methods=["POST"])
        app.add_api_route("/login", cls.login, methods=["POST"])
        app.add_api_route("/logout", cls.logout, methods=["POST"])
        app.add_api_route("/auth", cls.auth_check, methods=["GET"])
        app.add_api_route("/history", cls.get_history, methods=["GET"])
        app.add_api_route("/result/{task_id}", cls.get_result, methods=["GET"])
        app.add_api_route("/result/{task_id}/objects", cls.get_result_objects, methods=["GET"])
        app.add_api_route("/require_statistics", cls.require_statistics, methods=["GET"])
        app.add_api_route("/admin/users", cls.admin_users, methods=["GET"])
        app.add_api_route("/admin/visits", cls.admin_visits, methods=["GET"])
        app.add_api_route("/admin/new-users", cls.admin_new_users, methods=["GET"])
        app.add_api_route("/admin/storage", cls.admin_storage, methods=["GET"])
        app.add_api_route("/balance", cls.get_balance, methods=["GET"])
        app.add_api_route("/balance/topup", cls.topup_balance, methods=["POST"])

        return app


app = CoinDetectorAPI.create_app()
