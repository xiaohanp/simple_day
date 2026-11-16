package dev.simpleday.widget;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.concurrent.TimeUnit;

import dev.simpleday.widget.core.Api;

/** Fetches the plan from the worker and redraws every widget. */
public class SyncWorker extends Worker {
    public SyncWorker(@NonNull Context ctx, @NonNull WorkerParameters params) { super(ctx, params); }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        syncNow(ctx);
        PlanWidget.renderAll(ctx);
        return Result.success();
    }

    /** Blocking fetch; returns null on success or an error message. */
    static String syncNow(Context ctx) {
        Store s = new Store(ctx);
        if (!s.configured()) return "Not set up";
        try {
            Api.State st = Api.fetch(s.url(), s.auth(), s.encKey());
            s.savePlan(st.text, st.tz);
            return null;
        } catch (Exception e) {
            String msg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
            s.saveError(msg);
            return msg;
        }
    }

    private static Constraints net() {
        return new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
    }

    /** Every 15 minutes (Android's minimum for background work). */
    static void schedule(Context ctx) {
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(SyncWorker.class, 15, TimeUnit.MINUTES)
                .setConstraints(net()).build();
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("sync", ExistingPeriodicWorkPolicy.KEEP, req);
    }

    static void syncSoon(Context ctx) {
        OneTimeWorkRequest req = new OneTimeWorkRequest.Builder(SyncWorker.class).setConstraints(net()).build();
        WorkManager.getInstance(ctx).enqueueUniqueWork("sync-now", ExistingWorkPolicy.REPLACE, req);
    }
}
