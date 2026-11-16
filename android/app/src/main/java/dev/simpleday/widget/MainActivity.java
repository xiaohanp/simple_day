package dev.simpleday.widget;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.time.LocalDate;
import java.time.ZoneId;

import dev.simpleday.widget.core.Api;
import dev.simpleday.widget.core.Crypto;
import dev.simpleday.widget.core.Plan;

/** One-time setup: worker URL + secret key. Only keys derived from the secret are stored. */
public class MainActivity extends Activity {
    private EditText url, key;
    private TextView status;
    private Button save;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Store s = new Store(this);
        int pad = dp(20);

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(pad, pad + dp(24), pad, pad);

        col.addView(text("SimpleDay widget", 24, true));
        col.addView(text("Shows today\u2019s plan from your SimpleDay worker on the home screen. "
                + "Use the same worker URL and secret key as in the web app\u2019s Settings.", 14, false));

        url = new EditText(this);
        url.setHint("Worker URL (https://\u2026workers.dev)");
        url.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        url.setSingleLine(true);
        url.setText(s.url());
        col.addView(url, wide(dp(16)));

        key = new EditText(this);
        key.setHint(s.configured() ? "Secret key (saved \u2014 re-enter only to change)" : "Secret key");
        key.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        key.setSingleLine(true);
        col.addView(key, wide(dp(8)));

        save = new Button(this);
        save.setText(s.configured() ? "Save & test again" : "Save & test");
        save.setOnClickListener(x -> saveAndTest());
        col.addView(save, wide(dp(12)));

        status = text(s.configured() ? "Set up. Long-press the home screen \u2192 Widgets \u2192 SimpleDay to add it." : "", 14, false);
        col.addView(status, wide(dp(12)));

        col.addView(text("Xiaomi / HyperOS", 16, true), wide(dp(28)));
        col.addView(text("HyperOS stops background apps, which freezes the widget. Open app settings and:\n"
                + "\u2022 turn on Autostart\n"
                + "\u2022 Battery saver \u2192 No restrictions\n"
                + "The widget fetches every 15 minutes; tap \u21bb on it to refresh immediately.", 14, false));
        Button settings = new Button(this);
        settings.setText("Open app settings");
        settings.setOnClickListener(x -> startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", getPackageName(), null))));
        col.addView(settings, wide(dp(8)));

        Button pin = new Button(this);
        pin.setText("Add widget to home screen");
        pin.setOnClickListener(x -> {
            AppWidgetManager m = AppWidgetManager.getInstance(this);
            if (m.isRequestPinAppWidgetSupported()) m.requestPinAppWidget(new ComponentName(this, PlanWidget.class), null, null);
            else status.setText("Long-press the home screen \u2192 Widgets \u2192 SimpleDay.");
        });
        col.addView(pin, wide(dp(8)));

        ScrollView sv = new ScrollView(this);
        sv.addView(col);
        setContentView(sv);
    }

    private void saveAndTest() {
        Store s = new Store(this);
        String u = url.getText().toString().trim();
        String k = key.getText().toString().trim();
        if (u.isEmpty()) { status.setText("Enter the worker URL."); return; }
        if (k.isEmpty() && !s.configured()) { status.setText("Enter the secret key."); return; }
        save.setEnabled(false);
        status.setText(k.isEmpty() ? "Testing\u2026" : "Deriving keys (a few seconds)\u2026");
        new Thread(() -> {
            String msg;
            try {
                String auth = s.auth();
                byte[] enc = s.encKey();
                if (!k.isEmpty()) {
                    Crypto.Keys keys = Crypto.derive(k);
                    auth = keys.auth;
                    enc = keys.enc;
                }
                Api.State st = Api.fetch(u, auth, enc);
                s.saveCredentials(u, auth, enc);
                s.savePlan(st.text, st.tz);
                LocalDate today = LocalDate.now(ZoneId.of(st.tz));
                Plan.Day d = Plan.parse(st.text, today).day(today);
                int n = d == null ? 0 : d.items.size();
                SyncWorker.schedule(this);
                PlanWidget.renderAll(this);
                msg = "\u2713 Connected \u2014 " + n + " item" + (n == 1 ? "" : "s") + " today.\n"
                        + "Now add the widget: long-press the home screen \u2192 Widgets \u2192 SimpleDay (3\u00d74), "
                        + "or tap \u201cAdd widget to home screen\u201d below.";
            } catch (Exception e) {
                msg = "\u2717 " + (e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName())
                        + (e instanceof javax.crypto.AEADBadTagException ? " (wrong key: could not decrypt)" : "");
            }
            String m = msg;
            runOnUiThread(() -> {
                status.setText(m);
                save.setEnabled(true);
                if (m.startsWith("\u2713")) key.setText("");
            });
        }).start();
    }

    private TextView text(String s, int sp, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sp);
        if (bold) t.setTypeface(t.getTypeface(), android.graphics.Typeface.BOLD);
        t.setPadding(0, dp(4), 0, dp(4));
        return t;
    }

    private LinearLayout.LayoutParams wide(int top) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = top;
        return lp;
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
}
