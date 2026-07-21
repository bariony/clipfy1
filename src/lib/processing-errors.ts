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
    return "A tentativa anterior falhou porque o YouTube bloqueou o IP do worker. O worker foi atualizado; tente gerar os cortes novamente.";
  }
  return message;
}

export function sanitizeStoredProcessingError(message: string | null | undefined) {
  if (!message) return null;
  return formatProcessingError(message)?.slice(0, 500) ?? null;
}