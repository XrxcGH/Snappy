/**
 * The one size limit for the built page, in bytes. The web build (build.test.ts) and the desktop build (the shell tests
 * in apps/app/test) both stay under it, so there is a single number to raise and a single place that explains why: see
 * the measurement under "the commands live in the helper" in build.test.ts. It is the desktop page, the larger of the
 * two, at its measured size of 1,354,446 bytes plus about two percent.
 */
export const PAGE_SIZE_LIMIT = 1_380_000;
