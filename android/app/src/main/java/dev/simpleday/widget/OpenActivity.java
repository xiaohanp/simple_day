package dev.simpleday.widget;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

/**
 * Invisible trampoline for taps on widget rows. List rows need a mutable PendingIntent
 * template, and Android 14+ only allows those for explicit intents, so rows open this
 * activity, which opens the site and finishes.
 */
public class OpenActivity extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(PlanWidget.SITE)));
        } catch (Exception ignored) { /* no browser */ }
        finish();
    }
}
