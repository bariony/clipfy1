const YOUTUBE_BOT_PATTERNS = [
  /sign in to confirm.*not a bot/i,
  /use --cookies-from-browser/i,
  /use --cookies for the authentication/i,
  /youtube.*not a bot/i,
  /po token/i,
];

export function isYoutubeBotCheckError(message: string | null | undefined) {
  if (!message) return false;
  return YOUTUBE_BOT_PATTERNS.some((pattern) => pattern.test(message));
}

export function formatProcessingError(message: string | null | undefined) {
  if (!message) return null;
  if (isYoutubeBotCheckError(message)) {
    return "O YouTube bloqueou o IP do worker. Para processar links sem depender do cliente, configure no EasyPanel um proxy residencial/ISP ou cookies server-side de uma conta operacional do Clipfy.";
  }
  return message;
}

export function sanitizeStoredProcessingError(message: string | null | undefined) {
  if (!message) return null;
  return formatProcessingError(message)?.slice(0, 500) ?? null;
}
