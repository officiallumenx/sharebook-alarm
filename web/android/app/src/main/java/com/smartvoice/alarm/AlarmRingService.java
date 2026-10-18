package com.smartvoice.alarm;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/**
 * Owns the ringing session: foreground notification + STREAM_ALARM tone + full-screen UI.
 * Survives Activity teardown so the alarm keeps ringing until Stop / Snooze.
 */
public class AlarmRingService extends Service {
    public static final String EXTRA_ID = "notificationId";
    public static final String EXTRA_PAYLOAD = AlarmFullScreenHelper.EXTRA_PAYLOAD;
    public static final String ACTION_START = "com.smartvoice.alarm.RING_SERVICE_START";
    public static final String ACTION_STOP = "com.smartvoice.alarm.RING_SERVICE_STOP";

    private static final int FALLBACK_NOTIF_ID = 424242;
    private PowerManager.WakeLock wakeLock;
    private int notificationId = FALLBACK_NOTIF_ID;
    private String payload = "{}";
    private String title = "Alarm";
    private String soundLabel = "Alarm";

    public static void start(Context context, int notificationId, String payload) {
        Intent i = new Intent(context, AlarmRingService.class);
        i.setAction(ACTION_START);
        i.putExtra(EXTRA_ID, notificationId);
        i.putExtra(EXTRA_PAYLOAD, payload != null ? payload : "{}");
        ContextCompat.startForegroundService(context, i);
    }

    public static void stop(Context context) {
        try {
            Intent i = new Intent(context, AlarmRingService.class);
            i.setAction(ACTION_STOP);
            context.startService(i);
        } catch (Exception e) {
            try {
                context.stopService(new Intent(context, AlarmRingService.class));
            } catch (Exception ignored) {
            }
            AlarmTonePlayer.stop();
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            endSession(true);
            return START_NOT_STICKY;
        }

        if (intent != null) {
            notificationId = intent.getIntExtra(EXTRA_ID, FALLBACK_NOTIF_ID);
            String p = intent.getStringExtra(EXTRA_PAYLOAD);
            if (p != null) payload = p;
        }
        try {
            org.json.JSONObject json = new org.json.JSONObject(payload);
            title = json.optString("title", "Alarm");
            if (title == null || title.trim().isEmpty()) title = "Alarm";
        } catch (Exception ignored) {
            title = "Alarm";
        }
        soundLabel = AlarmTonePlayer.getSoundLabel(this);
        try {
            org.json.JSONObject json = new org.json.JSONObject(payload);
            if (json.optString("soundLabel").length() > 0) {
                soundLabel = json.optString("soundLabel");
            }
        } catch (Exception ignored) {
        }

        AlarmFullScreenHelper.ensureChannel(this);
        acquireWakeLock();

        Notification notification = buildNotification();
        // Stable FGS notification id — must not collide with scheduled alarm ids that get cancelled on resync
        final int fgsId = FALLBACK_NOTIF_ID;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                fgsId,
                notification,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            );
        } else {
            startForeground(fgsId, notification);
        }

        // Only (re)start tone if not already looping — avoid cutting the ringtone on duplicate starts
        if (!AlarmTonePlayer.isPlaying()) {
            AlarmTonePlayer.start(this);
        }
        launchRingActivity();
        // Soft JS signal — app state only; must not relaunch UI from JS
        AlarmFullScreenPlugin.emitFromNative("alarmFired", notificationId, payload);
        return START_STICKY;
    }

    private Notification buildNotification() {
        String body = soundLabel != null && !soundLabel.isEmpty()
            ? soundLabel + " — Snooze or Dismiss"
            : "Alarm is ringing — Snooze or Dismiss";
        return new NotificationCompat.Builder(this, AlarmFullScreenHelper.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_alarm_notif)
            .setContentTitle(title)
            .setContentText(body)
            .setSubText("Sharebook")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .setContentIntent(AlarmFullScreenHelper.activityPendingIntent(this, notificationId, payload))
            .setFullScreenIntent(
                AlarmFullScreenHelper.fullScreenPendingIntent(this, notificationId, payload),
                true
            )
            .addAction(
                0,
                "Snooze 5m",
                AlarmFullScreenHelper.actionPendingIntent(
                    this, AlarmFullScreenHelper.ACTION_SNOOZE, notificationId, payload
                )
            )
            .addAction(
                0,
                "Stop",
                AlarmFullScreenHelper.actionPendingIntent(
                    this, AlarmFullScreenHelper.ACTION_STOP, notificationId, payload
                )
            )
            .build();
    }

    private void launchRingActivity() {
        try {
            Intent act = new Intent(this, AlarmRingActivity.class);
            act.setAction("com.smartvoice.alarm.RING_UI." + notificationId);
            act.addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK
                    | Intent.FLAG_ACTIVITY_CLEAR_TOP
                    | Intent.FLAG_ACTIVITY_SINGLE_TOP
                    | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                    | Intent.FLAG_ACTIVITY_NO_USER_ACTION
            );
            act.putExtra("notificationId", notificationId);
            act.putExtra(EXTRA_PAYLOAD, payload);
            startActivity(act);
        } catch (Exception ignored) {
        }
    }

    private void acquireWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) return;
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm == null) return;
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "sharebook:ring_service");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(30 * 60 * 1000L);
        } catch (Exception ignored) {
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
            } catch (Exception ignored) {
            }
        }
        wakeLock = null;
    }

    private void endSession(boolean stopSelf) {
        AlarmTonePlayer.stop();
        releaseWakeLock();
        try {
            sendBroadcast(new Intent(AlarmRingActivity.ACTION_FINISH));
        } catch (Exception ignored) {
        }
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) {
            nm.cancel(notificationId);
            nm.cancel(FALLBACK_NOTIF_ID);
        }
        try {
            stopForeground(true);
        } catch (Exception ignored) {
        }
        if (stopSelf) stopSelf();
    }

    @Override
    public void onDestroy() {
        endSession(false);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
