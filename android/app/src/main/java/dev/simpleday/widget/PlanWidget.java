package dev.simpleday.widget;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.RelativeSizeSpan;
import android.view.View;
import android.widget.RemoteViews;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

import dev.simpleday.widget.core.Plan;

/** Home-screen widget: today's plan, the current item highlighted (or the next one). */
public class PlanWidget extends AppWidgetProvider {
    static final String ACTION_REFRESH = "dev.simpleday.widget.REFRESH";
    static final String ACTION_RENDER = "dev.simpleday.widget.RENDER";
    static final String SITE = "https://simpleday.pages.dev";

    private static final int C_TEXT = Color.parseColor("#F7F7F9");
    private static final int C_TIME = Color.parseColor("#B0B0B6");
    private static final int C_SUB = Color.parseColor("#A8A8AE");
    private static final int C_GREEN_SOFT = Color.parseColor("#9DF5B4");
    private static final int C_PAST_TEXT = Color.parseColor("#9A9AA0");
    private static final int C_PAST_TIME = Color.parseColor("#77777D");
    private static final int C_WARN = Color.parseColor("#FFB340");

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        SyncWorker.schedule(ctx);
        renderAll(ctx);
        SyncWorker.syncSoon(ctx);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        super.onReceive(ctx, intent);
        String a = intent.getAction();
        if (ACTION_REFRESH.equals(a)) {
            new Store(ctx).saveError(null);
            renderAll(ctx, "refreshing\u2026");
            SyncWorker.syncSoon(ctx);
        } else if (ACTION_RENDER.equals(a)) {
            renderAll(ctx);
        }
    }

    static void renderAll(Context ctx) { renderAll(ctx, null); }

    static void renderAll(Context ctx, String status) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, PlanWidget.class));
        if (ids.length == 0) return;
        RemoteViews views = build(ctx, status);
        for (int id : ids) mgr.updateAppWidget(id, views);
    }

    private static PendingIntent broadcast(Context ctx, String action, int code) {
        Intent i = new Intent(ctx, PlanWidget.class).setAction(action);
        return PendingIntent.getBroadcast(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static RemoteViews build(Context ctx, String status) {
        Store s = new Store(ctx);
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget);
        v.setOnClickPendingIntent(R.id.refresh, broadcast(ctx, ACTION_REFRESH, 1));

        if (!s.configured()) {
            PendingIntent setup = PendingIntent.getActivity(ctx, 3, new Intent(ctx, MainActivity.class),
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            v.setOnClickPendingIntent(R.id.root, setup);
            v.setOnClickPendingIntent(R.id.empty, setup);
            v.setTextViewText(R.id.empty, "Tap to set up SimpleDay");
            v.setViewVisibility(R.id.empty, View.VISIBLE);
            v.setViewVisibility(R.id.list, View.GONE);
            return v;
        }

        PendingIntent site = PendingIntent.getActivity(ctx, 2, new Intent(Intent.ACTION_VIEW, Uri.parse(SITE)),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        v.setOnClickPendingIntent(R.id.root, site);
        v.setOnClickPendingIntent(R.id.empty, site);
        // list rows: template + per-row fill-in. The template must be mutable, and Android 14+
        // only allows mutable PendingIntents for explicit intents -> trampoline activity.
        v.setPendingIntentTemplate(R.id.list, PendingIntent.getActivity(ctx, 4,
                new Intent(ctx, OpenActivity.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE));

        ZoneId zone;
        try { zone = ZoneId.of(s.tz()); } catch (Exception e) { zone = ZoneId.systemDefault(); }
        ZonedDateTime now = ZonedDateTime.now(zone);
        LocalDate today = now.toLocalDate();
        int nowMin = now.getHour() * 60 + now.getMinute();

        v.setTextViewText(R.id.day, today.format(DateTimeFormatter.ofPattern("EEEE d MMM", Locale.ENGLISH)).toUpperCase(Locale.ENGLISH));
        v.setString(R.id.clock, "setTimeZone", zone.getId());

        String text = s.text();
        Plan.Day day = text == null ? null : Plan.parse(text, today).day(today);
        if (day != null && day.label != null && !day.label.isEmpty()) {
            v.setTextViewText(R.id.label, day.label.replaceFirst("^[\u2014\u2013-]\\s*", ""));
            v.setViewVisibility(R.id.label, View.VISIBLE);
        } else {
            v.setViewVisibility(R.id.label, View.GONE);
        }

        List<Plan.Item> timed = new ArrayList<>();
        List<String> anytime = new ArrayList<>();
        if (day != null) {
            for (Plan.Item it : day.items) {
                if (it.start == null) anytime.add(it.title); else timed.add(it);
            }
        }
        timed.sort(Comparator.comparingInt(it -> it.start)); // stable: same start keeps text order

        // which rows are "now", which one is "next"
        boolean anyActive = false;
        for (Plan.Item it : timed) if (active(it, nowMin)) anyActive = true;
        int nextIdx = -1;
        if (!anyActive) {
            for (int i = 0; i < timed.size(); i++) if (timed.get(i).start > nowMin) { nextIdx = i; break; }
        }

        RemoteViews.RemoteCollectionItems.Builder items = new RemoteViews.RemoteCollectionItems.Builder()
                .setHasStableIds(true).setViewTypeCount(1);
        int focus = -1;
        for (int i = 0; i < timed.size(); i++) {
            Plan.Item it = timed.get(i);
            int s0 = it.start, e0 = it.end != null ? it.end : it.start;
            boolean act = active(it, nowMin);
            boolean next = i == nextIdx;
            boolean past = !act && e0 <= nowMin && !(e0 == s0 && s0 == nowMin);
            if ((act || next) && focus < 0) focus = i;

            RemoteViews row = new RemoteViews(ctx.getPackageName(), R.layout.row);
            row.setTextViewText(R.id.time, e0 > s0 ? Plan.hhmm(s0) + "\u2013" + Plan.hhmm(e0) : Plan.hhmm(s0));

            String sub;
            if (act) sub = e0 > nowMin ? "now \u00b7 " + Plan.dur(e0 - nowMin) + " left" : "now";
            else if (next) sub = "next \u00b7 in " + Plan.dur(Math.max(1, s0 - nowMin));
            else sub = Plan.dur(it.dur);
            if (it.loc != null) sub = sub.isEmpty() ? "@ " + it.loc : sub + " \u00b7 @ " + it.loc;

            int titleColor = past ? C_PAST_TEXT : C_TEXT;
            int subColor = act || next ? C_GREEN_SOFT : C_SUB;
            row.setTextViewText(R.id.title, titleWithSub(it.title, sub, titleColor, subColor));
            row.setTextColor(R.id.title, titleColor);
            row.setTextColor(R.id.time, act ? C_GREEN_SOFT : past ? C_PAST_TIME : C_TIME);
            row.setInt(R.id.row, "setBackgroundResource",
                    act ? R.drawable.bg_active : next ? R.drawable.bg_next : R.drawable.bg_none);
            row.setOnClickFillInIntent(R.id.row, new Intent());
            items.addItem(i, row);
        }
        if (!anytime.isEmpty()) {
            RemoteViews row = new RemoteViews(ctx.getPackageName(), R.layout.row);
            row.setTextViewText(R.id.time, "Anytime");
            row.setTextViewText(R.id.title, String.join(" \u00b7 ", anytime));
            row.setOnClickFillInIntent(R.id.row, new Intent());
            items.addItem(10000, row);
        }

        boolean empty = timed.isEmpty() && anytime.isEmpty();
        v.setRemoteAdapter(R.id.list, items.build());
        v.setViewVisibility(R.id.list, empty ? View.GONE : View.VISIBLE);
        v.setViewVisibility(R.id.empty, empty ? View.VISIBLE : View.GONE);
        v.setTextViewText(R.id.empty, text == null ? "Loading\u2026" : "Nothing planned today.");
        if (focus > 0) v.setScrollPosition(R.id.list, Math.max(0, focus - 1));

        // footer: freshness or the last error
        String err = s.error();
        String foot;
        if (status != null) foot = status;
        else if (err != null && !err.isEmpty()) foot = "\u26a0 " + err + (s.syncedAt() > 0 ? " \u00b7 showing " + time(s.syncedAt(), zone) : "");
        else foot = s.syncedAt() > 0 ? "SimpleDay \u00b7 updated " + time(s.syncedAt(), zone) : "SimpleDay";
        v.setTextViewText(R.id.foot, foot);
        v.setTextColor(R.id.foot, err != null && !err.isEmpty() && status == null ? C_WARN : Color.parseColor("#8E8E93"));

        scheduleNextRender(ctx, timed, now);
        return v;
    }

    private static boolean active(Plan.Item it, int nowMin) {
        int s0 = it.start, e0 = it.end != null ? it.end : it.start;
        return nowMin >= s0 && nowMin < Math.max(e0, s0 + 1);
    }

    private static CharSequence titleWithSub(String title, String sub, int titleColor, int subColor) {
        SpannableStringBuilder b = new SpannableStringBuilder(title);
        if (sub != null && !sub.isEmpty()) {
            int at = b.length();
            b.append("  ").append(sub);
            b.setSpan(new ForegroundColorSpan(subColor), at, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            b.setSpan(new RelativeSizeSpan(0.85f), at, b.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        return b;
    }

    private static String time(long ms, ZoneId zone) {
        return java.time.Instant.ofEpochMilli(ms).atZone(zone).format(DateTimeFormatter.ofPattern("HH:mm"));
    }

    /** Redraw when the highlight should move: next item start/end, or midnight. Inexact (no special permission). */
    private static void scheduleNextRender(Context ctx, List<Plan.Item> timed, ZonedDateTime now) {
        int nowMin = now.getHour() * 60 + now.getMinute();
        int best = 1440; // midnight
        for (Plan.Item it : timed) {
            int s0 = it.start, e0 = it.end != null ? it.end : it.start;
            if (s0 > nowMin) best = Math.min(best, s0);
            if (e0 > nowMin) best = Math.min(best, e0);
        }
        ZonedDateTime at = now.toLocalDate().atStartOfDay(now.getZone()).plusMinutes(best).plusSeconds(5);
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        am.setWindow(AlarmManager.RTC, at.toInstant().toEpochMilli(), 60_000, broadcast(ctx, ACTION_RENDER, 5));
    }
}
