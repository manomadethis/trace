import os

import httpx
from telegram import Update, ReplyKeyboardMarkup
from telegram.ext import Application, ContextTypes, CommandHandler, MessageHandler, filters

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
TELEGRAM_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")

MENU_KEYBOARD = ReplyKeyboardMarkup(
    [["\U0001f3d7\ufe0f Build a Trace", "\U0001f4e6 Track Batch"], ["\u2753 Help"]],
    resize_keyboard=True,
)


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "Hello and welcome to TRACE! \U0001f33f\n\n"
        "I help you get your harvest to market.\n"
        "Tap a button below to get started.",
        reply_markup=MENU_KEYBOARD,
    )


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_text = update.message.text.strip()
    chat_id = str(update.effective_chat.id)
    state = context.user_data.get("state")

    # -- Step 2 of "Build a Trace": user sends kg ---------------------------------
    if state == "awaiting_kg":
        try:
            kg = float(user_text)
        except ValueError:
            await update.message.reply_text(
                "Please enter a number, e.g. 30 (for 30 kg).",
                reply_markup=MENU_KEYBOARD,
            )
            return
        if kg <= 0:
            await update.message.reply_text(
                "Weight must be more than 0 kg. Try again.",
                reply_markup=MENU_KEYBOARD,
            )
            return

        crop = context.user_data["crop"]
        await _create_batch(update, chat_id, crop, kg)
        context.user_data.clear()
        return

    # -- Step 2 of "Track": user sends a batch id ---------------------------------
    if state == "awaiting_track_id":
        await _track_batch(update, user_text)
        context.user_data.clear()
        return

    # -- Top-level buttons --------------------------------------------------------
    if user_text == "\U0001f3d7\ufe0f Build a Trace":
        context.user_data["state"] = "awaiting_crop"
        await update.message.reply_text(
            "What crop are you harvesting?\n\n(e.g. tomato, ackee, mango\u2026)",
            reply_markup=MENU_KEYBOARD,
        )
        return

    if user_text == "\U0001f4e6 Track Batch":
        context.user_data["state"] = "awaiting_track_id"
        await update.message.reply_text(
            "Please enter your batch number:",
            reply_markup=MENU_KEYBOARD,
        )
        return

    if user_text == "\u2753 Help":
        await update.message.reply_text(
            "\U0001f4ac TRACE helps Caribbean farmers get harvests to market.\n\n"
            "\U0001f3d7\ufe0f *Build a Trace* — start a new harvest batch and get a photo link.\n"
            "\U0001f4e6 *Track Batch* — check the status of an existing batch.\n\n"
            "No app needed — everything happens right here in Telegram.",
            reply_markup=MENU_KEYBOARD,
        )
        return

    # -- Step 1 of "Build a Trace": user just sent the crop name ------------------
    if state == "awaiting_crop":
        context.user_data["crop"] = user_text
        context.user_data["state"] = "awaiting_kg"
        await update.message.reply_text(
            f"How many kilograms of *{user_text}*?",
            reply_markup=MENU_KEYBOARD,
        )
        return

    # -- Fallback -----------------------------------------------------------------
    await update.message.reply_text(
        "I didn't quite catch that. Please use one of the buttons below.",
        reply_markup=MENU_KEYBOARD,
    )


# ---------------------------------------------------------------------------
# Backend calls (HTTP to the FastAPI app)
# ---------------------------------------------------------------------------


async def _create_batch(update: Update, chat_id: str, crop: str, kg: float) -> None:
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                f"{BACKEND_URL}/telegram/intent",
                json={"telegram_chat_id": chat_id, "crop": crop, "kg": kg},
                timeout=10,
            )
            resp.raise_for_status()
            data = resp.json()

            await update.message.reply_text(
                f"\u2705 Batch #{data['batch_id']} created!\n\n"
                f"\U0001f33e {data['kg']} kg of *{data['crop']}*\n\n"
                f"\U0001f4f7 *Next step:* tap the link below and take a photo of "
                f"your harvest with a coin in the frame for scale.\n\n"
                f"http://localhost:8000/capture/{data['capture_token']}",
                reply_markup=MENU_KEYBOARD,
            )
        except httpx.HTTPError:
            await update.message.reply_text(
                "\u26a0\ufe0f Couldn't reach TRACE. Please try again in a moment.",
                reply_markup=MENU_KEYBOARD,
            )


async def _track_batch(update: Update, lookup: str) -> None:
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(
                f"{BACKEND_URL}/telegram/batch/{lookup}",
                timeout=10,
            )
            if resp.status_code == 404:
                await update.message.reply_text(
                    "\U0001f50d No batch found. Double-check the number and try again.",
                    reply_markup=MENU_KEYBOARD,
                )
                return
            resp.raise_for_status()
            data = resp.json()

            grade = data["farm_grade"] or "not yet graded"
            await update.message.reply_text(
                f"\U0001f4e6 Batch #{data['id']}\n"
                f"\U0001f33e {data['kg']} kg of *{data['crop']}*\n"
                f"\U0001f4ca Status: *{data['status']}*\n"
                f"\u2b50 Farm grade: *{grade}*",
                reply_markup=MENU_KEYBOARD,
            )
        except httpx.HTTPError:
            await update.message.reply_text(
                "\u26a0\ufe0f Couldn't reach TRACE. Please try again later.",
                reply_markup=MENU_KEYBOARD,
            )


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    if not TELEGRAM_TOKEN:
        print("TELEGRAM_BOT_TOKEN is not set. Export it or put it in .env")
        exit(1)

    app = Application.builder().token(TELEGRAM_TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    print(f"TRACE bot polling …  (backend: {BACKEND_URL})")
    app.run_polling()
