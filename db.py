import os
from decimal import Decimal
from functools import wraps

import psycopg2


class DBUtils:
    @staticmethod
    def get_error_info(e, error_type: str, message: str) -> dict:
        return {
            "success": False,
            "table": e.diag.table_name,
            "error": error_type,
            "message": message,
            "constraint_name": e.diag.constraint_name,
            "column": e.diag.column_name,
            "detail": e.diag.message_detail,
            "hint": e.diag.message_hint,
            "sqlstate": e.pgcode,
        }

    @staticmethod
    def require_tables(*table_names):
        def decorator(func):
            @wraps(func)
            def wrapper(self, *args, **kwargs):
                missing_tables = []

                try:
                    for table_name in table_names:
                        self._cursor.execute(
                            """
                            SELECT EXISTS (
                                SELECT FROM information_schema.tables 
                                WHERE table_schema = 'public' 
                                AND table_name = %s
                            );
                            """,
                            (table_name,),
                        )

                        if not self._cursor.fetchone()[0]:
                            missing_tables.append(table_name)

                    if missing_tables:
                        return {
                            "success": False,
                            "error": "tables_not_found",
                            "message": f"Таблицы не найдены: {', '.join(missing_tables)}",
                        }

                    return func(self, *args, **kwargs)

                except psycopg2.Error as e:
                    return {
                        "success": False,
                        "error": "database_error",
                        "message": f"Ошибка при проверке таблиц: {str(e)}",
                    }

            return wrapper

        return decorator

    @staticmethod
    def convert_to_decimal(n):
        if isinstance(n, float):
            n = Decimal(str(n))
        elif isinstance(n, int):
            n = Decimal(n)
        return n


class DBHelper:
    def __init__(self):
        self._connection = psycopg2.connect(
            dbname=os.getenv("DB_NAME", "practice"),
            host=os.getenv("DB_HOST", "localhost"),
            user=os.getenv("DB_USER", "postgres"),
            password=os.getenv("DB_PASSWORD"),
            port=os.getenv("DB_PORT", "5430"),
        )
        self._cursor = self._connection.cursor()

    @DBUtils.require_tables("users")
    def add_user(self, login: str, password: str, root: str, directory: str) -> dict:
        try:
            self._cursor.execute(
                "INSERT INTO users (login, directory, root, password) VALUES (%s, %s, %s, %s)",
                (login, directory, root, password),
            )
            self._connection.commit()
        except psycopg2.errors.UniqueViolation as e:
            info = DBUtils.get_error_info(
                e, error_type="unique_violation", message="Данные уже существуют"
            )
            self._connection.rollback()
            return info
        except psycopg2.errors.CheckViolation as e:
            info = DBUtils.get_error_info(
                e,
                error_type="check_violation",
                message="Поле root должно быть 'admin' или 'common'",
            )
            self._connection.rollback()
            return info
        except psycopg2.errors.IntegrityError as e:
            info = DBUtils.get_error_info(
                e,
                error_type="integrity_violation",
                message="Неожиданное нарушение целостности",
            )
            self._connection.rollback()
            return info
        else:
            return {"success": True}

    @DBUtils.require_tables("users", "queries")
    def add_query(
        self,
        login: str,
        operation_type: str,
        photo_name: str,
        query_result: int | float | Decimal,
    ) -> dict:
        query_result = DBUtils.convert_to_decimal(query_result)
        print(query_result)

        try:
            self._cursor.execute(
                """
                INSERT INTO queries (user_id, operation_type, photo_name, query_result)
                VALUES ((SELECT id FROM users WHERE login = %s), %s, %s, %s)
                """,
                (login, operation_type, photo_name, query_result),
            )
            self._connection.commit()
        except psycopg2.errors.NotNullViolation as e:
            info = DBUtils.get_error_info(
                e,
                error_type="not_null_violation",
                message=f"Пользователь с логином {login} не найден",
            )
            self._connection.rollback()
            return info
        except psycopg2.errors.UniqueViolation as e:
            info = DBUtils.get_error_info(
                e, error_type="unique_violation", message="Имя фотографии занято"
            )
            self._connection.rollback()
            return info
        except psycopg2.errors.CheckViolation as e:
            info = DBUtils.get_error_info(
                e,
                error_type="check_violation",
                message="Поле operation_type должно быть 'money' или 'object'",
            )
            self._connection.rollback()
            return info
        except psycopg2.errors.IntegrityError as e:
            info = DBUtils.get_error_info(
                e,
                error_type="integrity_violation",
                message="Неожиданное нарушение целостности",
            )
            self._connection.rollback()
            return info
        else:
            return {"success": True}

    @DBUtils.require_tables("users", "entry_log")
    def add_entry(self, login: str, entry_source: str) -> dict:
        try:
            self._cursor.execute(
                """
                INSERT INTO entry_log (user_id, entry_source)
                VALUES ((SELECT id FROM users WHERE login = %s), %s)
                """,
                (login, entry_source),
            )
            self._connection.commit()
        except psycopg2.errors.NotNullViolation as e:
            info = DBUtils.get_error_info(
                e,
                error_type="not_null_violation",
                message=f"Пользователь с логином {login} не найден",
            )
            self._connection.rollback()
            return info
        except psycopg2.errors.CheckViolation as e:
            info = DBUtils.get_error_info(
                e,
                error_type="check_violation",
                message="Поле entry_source должно быть 'web' или 'tg'",
            )
            self._connection.rollback()
            return info
        except psycopg2.errors.IntegrityError as e:
            info = DBUtils.get_error_info(
                e,
                error_type="integrity_violation",
                message="Неожиданное нарушение целостности",
            )
            self._connection.rollback()
            return info
        else:
            return {"success": True}

    @DBUtils.require_tables("users", "queries")
    def get_user_query_log(self, login: str) -> list[tuple] | dict:
        self._cursor.execute(
            """
            SELECT q.operation_type, q.photo_name, q.query_result, q.sent, q.query_id
            FROM queries AS q
                JOIN users AS u ON q.user_id = u.id
            WHERE u.login = %s
            """,
            (login,),
        )
        data = self._cursor.fetchall()

        if not data:
            return {
                "success": False,
                "error": "not_found",
                "message": f"Пользователь '{login}' не найден или у него нет запросов",
            }
        return {"success": True, "content": data}

    @DBUtils.require_tables("users", "entry_log")
    def get_user_entry_log(self, login: str):
        self._cursor.execute(
            """
            SELECT el.date_time, el.entry_source
            FROM entry_log AS el
                JOIN users AS u ON el.user_id = u.id
            WHERE u.login = %s
            """,
            (login,),
        )
        data = self._cursor.fetchall()

        if not data:
            return {
                "success": False,
                "error": "not_found",
                "message": f"Пользователь '{login}' не найден или журнал пуст",
            }
        return {"success": True, "content": data}

    @DBUtils.require_tables("users")
    def get_users_list(self) -> list[tuple]:
        self._cursor.execute("SELECT * FROM users")
        return self._cursor.fetchall()

    @DBUtils.require_tables("users")
    def authenticate_user(self, login: str, password: str) -> bool:
        self._cursor.execute(
            "SELECT 1 FROM users WHERE login = %s AND password = %s",
            (login, password),
        )
        return self._cursor.fetchone() is not None

    @DBUtils.require_tables("queries")
    def get_queries_list(self) -> list[tuple]:
        self._cursor.execute("SELECT * FROM queries")
        return self._cursor.fetchall()

    @DBUtils.require_tables("tasks")
    def add_task(self, login: str, task_id: str, original_name: str) -> dict:
        try:
            self._cursor.execute(
                """
                INSERT INTO tasks (user_id, task_id, original_name, status)
                VALUES ((SELECT id FROM users WHERE login = %s), %s, %s, %s)
                """,
                (login, task_id, original_name, "PENDING"),
            )
            self._connection.commit()
        except psycopg2.errors.UniqueViolation as e:
            info = DBUtils.get_error_info(
                e, error_type="unique_violation", message="Task already exists"
            )
            self._connection.rollback()
            return info
        except psycopg2.errors.NotNullViolation as e:
            info = DBUtils.get_error_info(
                e,
                error_type="not_null_violation",
                message=f"Пользователь с логином {login} не найден",
            )
            self._connection.rollback()
            return info
        except psycopg2.errors.IntegrityError as e:
            info = DBUtils.get_error_info(
                e,
                error_type="integrity_violation",
                message="Неожиданное нарушение целостности",
            )
            self._connection.rollback()
            return info
        else:
            return {"success": True}

    @DBUtils.require_tables("tasks")
    def update_task(
        self,
        task_id: str,
        status: str,
        result_total: Decimal | int | float | None = None,
        result_image: str | None = None,
    ) -> dict:
        result_total = (
            DBUtils.convert_to_decimal(result_total)
            if result_total is not None
            else None
        )
        try:
            self._cursor.execute(
                """
                UPDATE tasks
                SET status = %s,
                    result_total = %s,
                    result_image = %s,
                    completed_at = CASE WHEN %s IN ('SUCCESS','FAILURE') THEN now() ELSE completed_at END
                WHERE task_id = %s
                """,
                (status, result_total, result_image, status, task_id),
            )
            self._connection.commit()
        except psycopg2.Error as e:
            info = DBUtils.get_error_info(
                e, error_type="database_error", message="Ошибка при обновлении задачи"
            )
            self._connection.rollback()
            return info
        else:
            return {"success": True}

    @DBUtils.require_tables("tasks")
    def get_tasks_for_user(self, login: str) -> list[tuple] | dict:
        self._cursor.execute(
            """
            SELECT t.task_id, t.original_name, t.status, t.result_total, t.result_image, t.created_at, t.completed_at
            FROM tasks AS t
                JOIN users AS u ON t.user_id = u.id
            WHERE u.login = %s
            ORDER BY t.created_at DESC
            """,
            (login,),
        )
        data = self._cursor.fetchall()
        if not data:
            return {"success": False, "error": "not_found", "message": "Нет задач"}
        return {"success": True, "content": data}

    @DBUtils.require_tables("tasks", "users")
    def get_task_for_user(self, login: str, task_id: str) -> dict:
        self._cursor.execute(
            """
            SELECT t.task_id, t.original_name, t.status, t.result_total, t.result_image,
                   t.created_at, t.completed_at
            FROM tasks AS t
                JOIN users AS u ON t.user_id = u.id
            WHERE u.login = %s AND t.task_id = %s
            """,
            (login, task_id),
        )
        row = self._cursor.fetchone()
        if not row:
            return {"success": False, "error": "not_found", "message": "Task not found"}
        return {"success": True, "content": row}

    @DBUtils.require_tables("sessions", "users")
    def create_session(self, login: str, token: str) -> dict:
        try:
            self._cursor.execute(
                """
                INSERT INTO sessions (user_id, token)
                VALUES ((SELECT id FROM users WHERE login = %s), %s)
                """,
                (login, token),
            )
            self._connection.commit()
        except psycopg2.errors.NotNullViolation as e:
            info = DBUtils.get_error_info(
                e,
                error_type="not_null_violation",
                message=f"Пользователь с логином {login} не найден",
            )
            self._connection.rollback()
            return info
        except psycopg2.errors.UniqueViolation as e:
            info = DBUtils.get_error_info(
                e, error_type="unique_violation", message="Session already exists"
            )
            self._connection.rollback()
            return info
        except psycopg2.Error as e:
            info = DBUtils.get_error_info(
                e, error_type="database_error", message="Ошибка при создании сессии"
            )
            self._connection.rollback()
            return info
        else:
            return {"success": True}

    @DBUtils.require_tables("sessions", "users")
    def get_user_by_session(self, token: str) -> dict:
        self._cursor.execute(
            """
            SELECT u.login
            FROM sessions AS s
                JOIN users AS u ON s.user_id = u.id
            WHERE s.token = %s
            """,
            (token,),
        )
        row = self._cursor.fetchone()
        if not row:
            return {"success": False, "error": "not_found", "message": "Session not found"}
        return {"success": True, "login": row[0]}

    @DBUtils.require_tables("users")
    def get_user_by_id(self, user_id: int) -> dict:
        self._cursor.execute(
            "SELECT login FROM users WHERE id = %s",
            (user_id,),
        )
        row = self._cursor.fetchone()
        if not row:
            return {"success": False, "error": "not_found", "message": "User not found"}
        return {"success": True, "login": row[0]}

    @DBUtils.require_tables("users")
    def get_user_by_tg_uuid(self, tg_uuid: str) -> dict:
        self._cursor.execute(
            "SELECT login FROM users WHERE tg_uuid = %s",
            (tg_uuid,),
        )
        row = self._cursor.fetchone()
        if not row:
            return {"success": False, "error": "not_found", "message": "User not found"}
        return {"success": True, "login": row[0]}

    @DBUtils.require_tables("users")
    def get_user_id_by_login(self, login: str) -> int | None:
        self._cursor.execute(
            "SELECT id FROM users WHERE login = %s",
            (login,),
        )
        row = self._cursor.fetchone()
        return row[0] if row else None

    @DBUtils.require_tables("users")
    def get_users_admin_list(self) -> list[tuple]:
        self._cursor.execute(
            "SELECT id, login, tg_uuid, created FROM users ORDER BY login"
        )
        return self._cursor.fetchall()

    @DBUtils.require_tables("sessions")
    def delete_session(self, token: str) -> dict:
        try:
            self._cursor.execute("DELETE FROM sessions WHERE token = %s", (token,))
            self._connection.commit()
        except psycopg2.Error as e:
            info = DBUtils.get_error_info(
                e, error_type="database_error", message="Ошибка при удалении сессии"
            )
            self._connection.rollback()
            return info
        else:
            return {"success": True}

    @DBUtils.require_tables("entry_log")
    def get_entry_log_list(self) -> list[tuple]:
        self._cursor.execute("SELECT * FROM entry_log")
        return self._cursor.fetchall()

    @DBUtils.require_tables("entry_log")
    def get_entry_stats(
        self,
        start_dt,
        end_dt,
        granularity: str,
        tz_offset: str,
        user_id: int | None = None,
    ) -> list[tuple]:
        if granularity not in {"hour", "day"}:
            raise ValueError("Invalid granularity")

        query = (
            f"""
            SELECT date_trunc('{granularity}', (el.date_time AT TIME ZONE 'UTC') + (%s)::interval) AS bucket,
                   COUNT(DISTINCT el.user_id) AS total
            FROM entry_log AS el
            WHERE el.date_time >= %s AND el.date_time <= %s
            """
        )
        params = [tz_offset, start_dt, end_dt]
        if user_id is not None:
            query += " AND el.user_id = %s"
            params.append(user_id)
        query += " GROUP BY bucket ORDER BY bucket"

        self._cursor.execute(query, params)
        return self._cursor.fetchall()

    @DBUtils.require_tables("users")
    def get_new_users_stats(
        self,
        start_dt,
        end_dt,
        granularity: str,
        tz_offset: str,
        user_id: int | None = None,
    ) -> list[tuple]:
        if granularity not in {"hour", "day"}:
            raise ValueError("Invalid granularity")

        query = (
            f"""
            SELECT date_trunc('{granularity}', (u.created AT TIME ZONE 'UTC') + (%s)::interval) AS bucket,
                   COUNT(*) AS total
            FROM users AS u
            WHERE u.created >= %s AND u.created <= %s
            """
        )
        params = [tz_offset, start_dt, end_dt]
        if user_id is not None:
            query += " AND u.id = %s"
            params.append(user_id)
        query += " GROUP BY bucket ORDER BY bucket"

        self._cursor.execute(query, params)
        return self._cursor.fetchall()
    
    @DBUtils.require_tables("users")
    def get_users_count(self) -> int:
        self._cursor.execute("SELECT COUNT(*) FROM users")
        return self._cursor.fetchone()[0]
    
    @DBUtils.require_tables("tasks")
    def get_task_count(self) -> int:
        self._cursor.execute("SELECT COUNT(*) FROM tasks")
        return self._cursor.fetchone()[0]
    
    @DBUtils.require_tables("tasks")
    def get_tasks_count_by_status(self, status: str) -> int:
        self._cursor.execute(
            """
            SELECT COUNT(*) FROM tasks
            WHERE status = %s
            """,
            (status,),
        )
        return self._cursor.fetchone()[0]
    
    @DBUtils.require_tables("users")
    def get_user_root(self, login: str) -> str | None:
        self._cursor.execute("SELECT root FROM users WHERE login = %s", (login,))
        row = self._cursor.fetchone()
        return row[0] if row else None

    @DBUtils.require_tables("users")
    def get_user_token_balance(self, login: str) -> int | None:
        self._cursor.execute(
            "SELECT token_balance FROM users WHERE login = %s",
            (login,),
        )
        row = self._cursor.fetchone()
        return row[0] if row else None

    @DBUtils.require_tables("users")
    def consume_tokens(self, login: str, amount: int) -> dict:
        try:
            self._cursor.execute(
                """
                UPDATE users
                SET token_balance = token_balance - %s
                WHERE login = %s AND token_balance >= %s
                RETURNING token_balance
                """,
                (amount, login, amount),
            )
            row = self._cursor.fetchone()
            if not row:
                self._connection.rollback()
                return {"success": False, "error": "insufficient_tokens"}
            self._connection.commit()
            return {"success": True, "remaining": row[0]}
        except psycopg2.Error as e:
            info = DBUtils.get_error_info(
                e, error_type="database_error", message="Ошибка при списании токенов"
            )
            self._connection.rollback()
            return info

    @DBUtils.require_tables("users")
    def add_tokens(self, login: str, amount: int) -> dict:
        if amount <= 0:
            return {"success": False, "error": "invalid_amount"}

        try:
            self._cursor.execute(
                """
                UPDATE users
                SET token_balance = token_balance + %s
                WHERE login = %s
                RETURNING token_balance
                """,
                (amount, login),
            )
            row = self._cursor.fetchone()
            if not row:
                self._connection.rollback()
                return {"success": False, "error": "not_found"}
            self._connection.commit()
            return {"success": True, "balance": row[0]}
        except psycopg2.Error as e:
            info = DBUtils.get_error_info(
                e, error_type="database_error", message="Ошибка при пополнении токенов"
            )
            self._connection.rollback()
            return info

    def close(self):
        if self._cursor:
            self._cursor.close()
        if self._connection:
            self._connection.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
