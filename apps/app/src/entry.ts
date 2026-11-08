/**
 * Entry point of the desktop build (the default). It tells the dashboard it runs in the desktop app
 * (desktop-platform.ts, imported first on purpose) and then starts it exactly as the web build does:
 * "Choose ZIP files" is the page's own file input (the system's file dialog, opened by the web engine)
 * and the zip is read by the dashboard's background worker. That needs no shell command, no file path
 * and no IPC, which is why it is the default: measured faster and leaner than the shell reader, and the
 * page never learns where the file lives.
 *
 * The shell reader is a fallback behind a build switch: see entry-native-reader.ts.
 */
import "./desktop-platform.ts"; // sets the platform; must come before the dashboard starts
import "../../dashboard/src/main.ts"; // starts the dashboard when loaded
import "./update-entry.ts"; // the update banner, card and notice (Windows); added to the page from outside
