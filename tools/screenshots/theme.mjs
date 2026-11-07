/**
 * Shared by the capture tools: put the dashboard in a theme the way a person does, and PROVE it took effect.
 *
 * Dark is the dashboard's default whatever the browser's color scheme or the device says, so a "light" capture is not
 * made with colorScheme alone: the header toggle is pressed (only when the page is not already in the wanted theme,
 * because the choice is remembered in this browser and a remembered light theme would otherwise be flipped back to
 * dark), and then both the data-theme attribute AND the real rendered background are checked. A picture named
 * "...-light.png" is therefore light, or the tool stops with an error.
 */

/** Average of the page background's red, green and blue (0 to 255), as rendered. */
export async function pageBrightness(page) {
  return page.evaluate(() => {
    const m = /rgba?\((\d+), (\d+), (\d+)/.exec(getComputedStyle(document.body).backgroundColor);
    return m ? (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3 : null;
  });
}

/** Switch the page to "light" or "dark" with the header toggle and verify it. Throws when the page did not change. */
export async function showTheme(page, scheme) {
  const read = () => page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  if ((await read()) !== scheme) {
    await page.locator("header button[aria-pressed]").first().click();
    await page.waitForTimeout(250);
  }
  const attr = await read();
  if (attr !== scheme) throw new Error(`The header toggle did not switch the page to the ${scheme} theme (data-theme is ${attr}).`);
  const brightness = await pageBrightness(page);
  const looksLight = brightness !== null && brightness > 150;
  const looksDark = brightness !== null && brightness < 110;
  if ((scheme === "light" && !looksLight) || (scheme === "dark" && !looksDark)) {
    throw new Error(`The page says data-theme="${scheme}" but its background renders ${looksLight ? "light" : looksDark ? "dark" : "mid-tone"} (brightness ${brightness}).`);
  }
  return brightness;
}
