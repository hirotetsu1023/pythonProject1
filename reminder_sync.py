import configparser
import logging
import smtplib
import sys
from datetime import datetime
from email.message import EmailMessage
from pathlib import Path

import caldav

BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "config.ini"
LOG_PATH = BASE_DIR / "reminder_sync.log"

logger = logging.getLogger("reminder_sync")
logger.setLevel(logging.INFO)
_formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
_file_handler = logging.FileHandler(LOG_PATH, encoding="utf-8")
_file_handler.setFormatter(_formatter)
logger.addHandler(_file_handler)
_stream_handler = logging.StreamHandler()
_stream_handler.setFormatter(_formatter)
logger.addHandler(_stream_handler)


def load_config():
    if not CONFIG_PATH.exists():
        raise SystemExit(
            f"{CONFIG_PATH} が見つかりません。config.example.ini をコピーして "
            f"config.ini を作成し、値を設定してください。"
        )
    config = configparser.ConfigParser()
    config.read(CONFIG_PATH, encoding="utf-8")

    try:
        apple_id = config["apple"]["apple_id"]
        apple_app_password = config["apple"]["app_specific_password"]
        gmail_address = config["gmail"]["address"]
        gmail_app_password = config["gmail"]["app_password"]
    except KeyError as exc:
        raise SystemExit(
            f"config.ini に設定項目 {exc} がありません。config.example.ini を参照してください。"
        )

    to_address = config["gmail"].get("to_address", gmail_address)
    return apple_id, apple_app_password, gmail_address, gmail_app_password, to_address


def fetch_incomplete_reminders(apple_id, app_password):
    client = caldav.DAVClient(
        url="https://caldav.icloud.com/",
        username=apple_id,
        password=app_password,
    )
    principal = client.principal()

    reminders = []
    for calendar in principal.calendars():
        try:
            todos = calendar.get_todos(include_completed=False)
        except Exception:
            logger.exception(
                "カレンダー「%s」のリマインダー取得に失敗しました",
                getattr(calendar, "name", calendar.url),
            )
            continue

        for todo in todos:
            vtodo = todo.icalendar_component
            status = str(vtodo.get("status", "")).upper()
            if status in ("COMPLETED", "CANCELLED") or vtodo.get("completed"):
                continue

            title = str(vtodo.get("summary", "(タイトルなし)"))
            due_prop = vtodo.get("due")
            due_value = due_prop.dt if due_prop else None
            reminders.append((title, due_value))

    def sort_key(item):
        _, due = item
        if due is None:
            return (1, datetime.max)
        if isinstance(due, datetime):
            naive = due.astimezone().replace(tzinfo=None) if due.tzinfo else due
            return (0, naive)
        return (0, datetime(due.year, due.month, due.day))

    reminders.sort(key=sort_key)
    return reminders


def format_due(due_value):
    if due_value is None:
        return None
    if isinstance(due_value, datetime):
        if due_value.tzinfo is not None:
            due_value = due_value.astimezone()
        return due_value.strftime("%Y-%m-%d %H:%M")
    return due_value.strftime("%Y-%m-%d")


def build_email_body(reminders):
    if not reminders:
        return "未完了のリマインダーはありません。"

    lines = [f"未完了のリマインダーは{len(reminders)}件です。", ""]
    for title, due_value in reminders:
        due_text = format_due(due_value)
        lines.append(f"- {title} (期限: {due_text})" if due_text else f"- {title}")
    return "\n".join(lines)


def send_email(gmail_address, gmail_app_password, to_address, body):
    message = EmailMessage()
    message["Subject"] = "リマインダー同期"
    message["From"] = gmail_address
    message["To"] = to_address
    message.set_content(body)

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
        smtp.login(gmail_address, gmail_app_password)
        smtp.send_message(message)


def main():
    apple_id, apple_app_password, gmail_address, gmail_app_password, to_address = load_config()

    logger.info("リマインダー取得を開始します")
    reminders = fetch_incomplete_reminders(apple_id, apple_app_password)
    logger.info("未完了リマインダー %d件を取得しました", len(reminders))

    body = build_email_body(reminders)
    send_email(gmail_address, gmail_app_password, to_address, body)
    logger.info("メール送信が完了しました")


if __name__ == "__main__":
    try:
        main()
    except SystemExit as exc:
        logger.error(str(exc))
        sys.exit(1)
    except Exception:
        logger.exception("リマインダー同期に失敗しました")
        sys.exit(1)
