import { useEffect, useState } from "react";
import { DEFAULT_PREFS, prefsFrom, type DisplayPrefs } from "../home/prefs";
import { settingsService } from "../../services/settingsService";

/** The user's display preferences, read from the Settings API. Safe defaults until (or unless) they load. */
export function useSettingsPrefs(): { prefs: DisplayPrefs; ready: boolean } {
  const [state, setState] = useState<{ prefs: DisplayPrefs; ready: boolean }>({ prefs: DEFAULT_PREFS, ready: false });
  useEffect(() => {
    const controller = new AbortController();
    settingsService.get(controller.signal)
      .then((s) => setState({ prefs: prefsFrom(s), ready: true }))
      .catch(() => { if (!controller.signal.aborted) setState({ prefs: DEFAULT_PREFS, ready: true }); });
    return () => controller.abort();
  }, []);
  return state;
}
