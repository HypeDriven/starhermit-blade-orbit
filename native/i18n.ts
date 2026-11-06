// Localization: assets/strings.json (the nine StarHermit locales) on the
// engine's string tables, in the interface language the runtime reports
// (Options › Language, else the account's or the device's); account lines the
// engine has are its `starhermit.*`.
import { strings } from "starhermit:engine";
import * as ui from "starhermit:ui";

strings.load("assets/strings.json");
strings.defaultLocale = "en-US";
ui.setLanguage(strings.locale);
strings.onChange((locale) => ui.setLanguage(locale));

export function currentLocale(): string { return strings.locale; }

type Vars = Record<string, string | number>;
/** A game string by key in the player's language; `{name}` placeholders from vars. */
export function t(key: string, vars?: Vars | null, fallback?: string): string {
  if (fallback !== undefined && !strings.has(key)) return fallback;
  return strings.t(key, vars ?? undefined);
}
