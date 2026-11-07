/**
 * Names of the known export layout, shared by the masking code in parse.ts and inspect.ts.
 * A file or folder name outside this vocabulary may carry personal text (a username, a group
 * title), so it is replaced by a placeholder wherever names are reported. Kept in its own
 * module so parse.ts, zip-reader.ts and inspect.ts can all use it without import cycles.
 */

/** Directory names of the known export layout. */
export const KNOWN_DIRS: ReadonlySet<string> = new Set(["json", "html", "memories", "chat_media", "shared_story", "assets"]);

/**
 * File extensions that count as media (photos, videos, audio). One list for the parser and the
 * inspector, so a file the parser treats as media is never reported by the inspector with an
 * exact byte size.
 */
export const MEDIA_EXTENSIONS: ReadonlySet<string> = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp",
  "mp4", "mov", "m4v", "webm", "3gp", "avi", "mkv",
  "mp3", "m4a", "aac", "wav", "ogg", "opus",
]);

/** File stems (without extension) of the known export layout, optionally followed by _N / -N. */
export const KNOWN_STEMS: ReadonlySet<string> = new Set([
  "account", "account_history", "bitmoji", "chat_history", "community_lenses", "connected_apps",
  "email_campaign_history", "friends", "in_app_surveys", "index", "location_history", "memories_history",
  "official_stories", "orders", "ranking", "search_history", "shopping_history", "snap_ai",
  "snap_history", "snap_map_places", "spotlight_history", "story_history", "subscriptions",
  "support_notes", "talk_history", "terms_history", "user_profile", "web_interactions",
  "friends_and_bitmoji", "chat_history_all", "memories", "profile", "account_info",
]);
