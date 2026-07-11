from telegram import Update, ReplyKeyboardMarkup
from telegram.ext import Application, ContextTypes, CommandHandler, MessageHandler, filters

token = ''

# Create the menu layout once so we can reuse it everywhere
HACKATHON_KEYBOARD = ReplyKeyboardMarkup(
    [['🏗️ Build a Trace', '📦 Track Ackee'], ['❓ Help']],
    resize_keyboard=True
)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await context.bot.send_message(
        chat_id=update.effective_chat.id,
        text='Hello and welcome to the Trace bot! How may I help?',
        reply_markup=HACKATHON_KEYBOARD  # Shows buttons on /start
    )

async def handle_buttons(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_text = update.message.text
    chat_id = update.effective_chat.id

    if user_text == '🏗️ Build a Trace':
        await context.bot.send_message(
            chat_id=chat_id,
            text="Let's build a new trace! Please enter the item name:",
            reply_markup=HACKATHON_KEYBOARD
        )

    elif user_text == '📦 Track Ackee':
        await context.bot.send_message(
            chat_id=chat_id,
            text="Please enter your tracking batch number:",
            reply_markup=HACKATHON_KEYBOARD
        )

    elif user_text == '❓ Help':
        await context.bot.send_message(
            chat_id=chat_id,
            text="This hackathon project tracks supply chains. Use the buttons below to navigate.",
            reply_markup=HACKATHON_KEYBOARD
        )

    else:
        # FALLBACK: If they type a completely random message,
        # we reply nicely AND force the buttons to appear on their screen!
        await context.bot.send_message(
            chat_id=chat_id,
            text="I didn't quite catch that. Please use one of the options below:",
            reply_markup=HACKATHON_KEYBOARD
        )

if __name__ == '__main__':
    application = Application.builder().token(token).build()

    application.add_handler(CommandHandler('start', start))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_buttons))

    application.run_polling()
