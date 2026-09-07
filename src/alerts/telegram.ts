/**
 * Alerts carry information. They never carry a key.
 *
 * This is the only outbound network call in novamp that is not a chain read, and
 * it is deliberately the dumbest possible one: a POST to Telegram's bot API with
 * a text string. There is no webhook to receive, no command handler, nothing on
 * the other end that could ask novamp to do something.
 *
 * A bot token in `.env` can post messages to your chat. That is all it can do,
 * and it is worth saying out loud because "connect your Telegram" has been the
 * opening move of enough drainers that the reflex to refuse is a good one.
 */

const API = "https://api.telegram.org";

export interface TelegramConfig {
  token: string;
  chatId: string;
}

export function telegramFromEnv(env = process.env): TelegramConfig | null {
  const token = env["TELEGRAM_BOT_TOKEN"];
  const chatId = env["TELEGRAM_CHAT_ID"];
  if (!token || !chatId) return null;
  return { token, chatId };
}

/**
 * Send one message. Failures are reported, never thrown.
 *
 * A watcher that dies because Telegram had a bad minute is worse than one that
 * misses a message and says so, because the thing it is watching keeps moving
 * either way.
 */
export async function sendTelegram(
  config: TelegramConfig,
  text: string,
  timeoutMs = 10_000,
): Promise<{ ok: boolean; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API}/bot${config.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, error: `telegram returned ${response.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/** Strip the handful of characters Telegram's HTML mode treats as markup. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
