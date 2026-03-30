import os


class AppSettings:
    ADMIN_LOGIN = os.getenv("ADMIN_LOGIN")
    ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD")
    ADMIN_ROOT = os.getenv("ADMIN_ROOT")
    ADMIN_DIRECTORY = os.getenv("ADMIN_DIRECTORY", "./admin_folder")
    ADMIN_TOKEN = os.getenv("ADMIN_TOKEN")
    TOKEN_COST = int(os.getenv("TOKEN_COST", "10"))
