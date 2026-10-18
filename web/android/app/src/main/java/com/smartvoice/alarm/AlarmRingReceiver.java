package com.smartvoice.alarm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.PowerManager;

/**
 * AlarmManager fire → start {@link AlarmRingService} (tone + lock UI + notification).
 */
public class AlarmRingReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        final PendingResult pending = goAsync();
        int id = intent.getIntExtra("notificationId", 0);
        String payload = intent.getStringExtra(AlarmFullScreenHelper.EXTRA_PAYLOAD);
        if (payload == null) payload = "{}";

        PowerManager.WakeLock wakeLock = null;
        try {
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "sharebook:alarm_fire");
                wakeLock.acquire(15_000L);
            }
        } catch (Exception ignored) {
        }

        try {
            AlarmRingService.start(context, id, payload);
        } finally {
            if (wakeLock != null && wakeLock.isHeld()) {
                try {
                    wakeLock.release();
                } catch (Exception ignored) {
                }
            }
            pending.finish();
        }
    }
}
