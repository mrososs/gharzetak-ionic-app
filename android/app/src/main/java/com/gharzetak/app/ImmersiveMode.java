package com.gharzetak.app;

import android.app.Activity;
import android.content.Context;
import android.view.Window;
import android.view.accessibility.AccessibilityManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

/**
 * Immersive display for Gharzetak: hides ONLY the Android system navigation bar (Back / Home / Recents or the gesture pill).
 * The status bar stays visible and the app's own bottom tabs are web content, so they are untouched.
 *
 * Behaviour (WindowInsetsControllerCompat, works from API 24 via the compat fallback):
 *  - BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE: a swipe from the bottom system edge reveals the bars temporarily and the
 *    system hides them again by itself (no polling, no flashing). System Back / Home / Recents gestures keep working.
 *  - Re-applied only when the window regains focus (resume, dialogs, keyboard, split-screen, rotation) — never in a loop.
 *  - Turned OFF automatically while a touch-exploration screen reader (TalkBack) is running, and can be turned off by the
 *    user in Settings → "Immersive display". The preference is stored natively so it is applied before the WebView loads.
 */
final class ImmersiveMode {
    static final String PREFS = "gharzetak_display";
    static final String KEY = "immersive";

    private ImmersiveMode() {}

    /** The user's choice (default: on). */
    static boolean preferred(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY, true);
    }

    static void setPreferred(Context c, boolean enabled) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY, enabled).apply();
    }

    /** True while TalkBack / another touch-exploration service is on: system navigation stays visible for them. */
    static boolean touchExploration(Context c) {
        AccessibilityManager am = (AccessibilityManager) c.getSystemService(Context.ACCESSIBILITY_SERVICE);
        return am != null && am.isEnabled() && am.isTouchExplorationEnabled();
    }

    /** Whether the navigation bar is actually being hidden right now. */
    static boolean effective(Context c) {
        return preferred(c) && !touchExploration(c);
    }

    /** Applies the current state to the window. Returns true when the navigation bar is hidden (immersive). */
    static boolean apply(Activity activity) {
        Window window = activity.getWindow();
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        if (controller == null) return false;
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        boolean active = effective(activity);
        if (active) controller.hide(WindowInsetsCompat.Type.navigationBars());
        else controller.show(WindowInsetsCompat.Type.navigationBars());
        return active;
    }
}
