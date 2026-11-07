/**
 * Pure safety checks for anything that can reach the DOM from export data or from a URL.
 * Usernames are attacker-influenced strings (a friend picks their own), so they are validated
 * here before being used in a link and are otherwise only ever written with textContent.
 */
import { normUser } from "@snappy-export/core";

/** Snapchat usernames are ASCII letters, digits, ".", "-" and "_". Anything else is shown but never linked. */
const USERNAME = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

export const PROFILE_URL_PREFIX = "https://www.snapchat.com/add/";

/** True for an already-normalised (lower-case) username that is safe to put in a link. */
export function isSafeUsername(value: unknown): value is string {
  return typeof value === "string" && USERNAME.test(value);
}

/**
 * The one external link the dashboard ever creates. Returns null for anything that does not
 * look like a plain username, so a crafted name can never alter the path, query or scheme.
 */
export function safeProfileUrl(username: string): string | null {
  const name = normUser(username);
  return isSafeUsername(name) ? PROFILE_URL_PREFIX + encodeURIComponent(name) : null;
}

// Control characters and bidi overrides could reorder or hide text when a username is displayed.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;

/** Invisible and direction-changing characters become "?". Used wherever export text is shown or exported. */
export function hideInvisible(text: string): string {
  return text.replace(INVISIBLE, "?");
}

/** Text form of a username for display: invisible and direction-changing characters become "?". */
export function displayUsername(username: string): string {
  return hideInvisible(String(username));
}

const PROFILE_LINK = /^https:\/\/www\.snapchat\.com\/add\/[A-Za-z0-9._%-]{1,200}$/;
const ROUTE_LINK = /^#(?:\/[a-z-]*|\/tools\/[a-z][a-z0-9-]*)?$/;

/** Links the DOM helper accepts: in-page routes (a tool is #/tools/<id>) and Snapchat profile links, nothing else. */
export function isAllowedHref(href: string): boolean {
  return ROUTE_LINK.test(href) || href === "#main" || PROFILE_LINK.test(href);
}

/** Attribute names the DOM helper refuses: inline styles (CSP), event-handler attributes, frames. */
export function isSafeAttribute(name: string): boolean {
  const n = name.toLowerCase();
  return /^[a-z][a-z0-9:_-]*$/.test(n) && n !== "style" && n !== "srcdoc" && n !== "formaction" && !n.startsWith("on") && !n.startsWith("xlink");
}
