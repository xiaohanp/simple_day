package dev.simpleday.widget;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.Base64;

/** App-private settings + the last plan we fetched (the widget renders from this cache). */
final class Store {
    private final SharedPreferences p;

    Store(Context ctx) { p = ctx.getSharedPreferences("simpleday", Context.MODE_PRIVATE); }

    boolean configured() { return !url().isEmpty() && !auth().isEmpty() && encKey() != null; }

    String url() { return p.getString("url", ""); }
    String auth() { return p.getString("auth", ""); }
    byte[] encKey() {
        String s = p.getString("enc", "");
        return s.isEmpty() ? null : Base64.getDecoder().decode(s);
    }

    /** Only derived keys are kept: the secret itself is never stored on the phone. */
    void saveCredentials(String url, String auth, byte[] enc) {
        p.edit().putString("url", url.trim().replaceAll("/+$", ""))
                .putString("auth", auth)
                .putString("enc", Base64.getEncoder().encodeToString(enc))
                .apply();
    }

    String text() { return p.getString("text", null); }
    String tz() { return p.getString("tz", "Europe/Paris"); }
    long syncedAt() { return p.getLong("syncedAt", 0); }
    String error() { return p.getString("error", null); }

    void savePlan(String text, String tz) {
        p.edit().putString("text", text).putString("tz", tz)
                .putLong("syncedAt", System.currentTimeMillis()).remove("error").commit();
    }

    void saveError(String msg) { p.edit().putString("error", msg).commit(); }
}
