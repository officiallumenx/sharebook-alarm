package com.smartvoice.alarm;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

/**
 * Schedules exact AlarmManager wakes that post a high-priority notification
 * with full-screen intent to {@link AlarmRingActivity}.
 */
public final class AlarmFullScreenHelper {
    /** Bump when channel audio attributes / importance must change (channels are immutable). */
    public static final String CHANNEL_ID = "smart_voice_alarms_v4";
    public static final String PREFS = "alarm_fullscreen_prefs";
    public static final String KEY_IDS = "scheduled_ids";
    public static final String KEY_PENDING_EVENT = "pending_event";
    public static final String KEY_PENDING_PAYLOAD = "pending_payload";
    public static final String KEY_PENDING_ID = "pending_notification_id";
    public static final String EXTRA_PAYLOAD = "alarm_payload_json";
    public static final String ACTION_FIRE = "com.smartvoice.alarm.ACTION_ALARM_FIRE";
    public static final String ACTION_STOP = "com.smartvoice.alarm.ACTION_ALARM_STOP";
    public static final String ACTION_SNOOZE = "com.smartvoice.alarm.ACTION_ALARM_SNOOZE";
    public static final long SNOOZE_MS = 5L * 60L * 1000L;

    private AlarmFullScreenHelper() {}

    public static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm == null) return;

        // Drop legacy channels that may have been created without USAGE_ALARM
        try {
            nm.deleteNotificationChannel("smart_voice_alarms");
            nm.deleteNotificationChannel("smart_voice_alarms_v2");
            nm.deleteNotificationChannel("smart_voice_alarms_v3");
        } catch (Exception ignored) {
        }

        NotificationChannel existing = nm.getNotificationChannel(CHANNEL_ID);
        if (existing != null) return;

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Alarms",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Sharebook alarm and reminder alerts");
        channel.enableVibration(true);
        channel.enableLights(true);
        channel.setBypassDnd(true);
        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        // Tone is played by AlarmTonePlayer on STREAM_ALARM; keep channel silent to avoid double audio.
        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        channel.setSound(null, attrs);
        nm.createNotificationChannel(channel);
    }

    /**
     * Cancel pending AlarmManager schedules only.
     * Never stops an active ringing session — resync after a fire must not kill the tone.
     */
    public static void cancelAll(Context context) {
        cancelAllPending(context, false);
    }

    public static void cancelAllPending(Context context, boolean alsoStopRinging) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        Set<String> ids = prefs.getStringSet(KEY_IDS, new HashSet<>());
        if (ids != null) {
            for (String idStr : new HashSet<>(ids)) {
                try {
                    cancelOne(context, Integer.parseInt(idStr), false);
                } catch (Exception ignored) {
                }
            }
        }
        prefs.edit().remove(KEY_IDS).apply();
        if (alsoStopRinging) {
            AlarmRingService.stop(context);
            AlarmTonePlayer.stop();
        }
    }

    public static void cancelOne(Context context, int id) {
        cancelOne(context, id, false);
    }

    public static void cancelOne(Context context, int id, boolean cancelNotification) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am != null) {
            PendingIntent pi = firePendingIntent(context, id, "{}", PendingIntent.FLAG_NO_CREATE);
            if (pi != null) {
                am.cancel(pi);
                pi.cancel();
            }
            PendingIntent show = showPendingIntent(context, id, "{}", PendingIntent.FLAG_NO_CREATE);
            if (show != null) {
                show.cancel();
            }
        }
        // Do not cancel notifications while ringing — FGS uses a stable id, but be safe
        if (cancelNotification && !AlarmTonePlayer.isPlaying()) {
            NotificationManager nm = context.getSystemService(NotificationManager.class);
            if (nm != null) nm.cancel(id);
        }
    }

    public static void scheduleAll(Context context, JSONArray alarms) throws Exception {
        ensureChannel(context);
        // Reschedule upcoming alarms without stopping a ringtone already playing
        cancelAllPending(context, false);
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        Set<String> ids = new HashSet<>();
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;

        long now = System.currentTimeMillis();
        for (int i = 0; i < alarms.length(); i++) {
            JSONObject alarm = alarms.getJSONObject(i);
            int id = alarm.getInt("id");
            long at = alarm.getLong("at");
            if (at <= now + 1500) continue;

            String payload = alarm.toString();
            PendingIntent pi = firePendingIntent(context, id, payload, 0);
            if (pi == null) continue;

            // setAlarmClock is the reliable path for lock-screen / Doze wake + FSI
            PendingIntent show = showPendingIntent(context, id, payload, 0);
            AlarmManager.AlarmClockInfo info = new AlarmManager.AlarmClockInfo(at, show);
            am.setAlarmClock(info, pi);

            ids.add(String.valueOf(id));
            prefs.edit().putString("payload_" + id, payload).apply();
        }
        prefs.edit().putStringSet(KEY_IDS, ids).apply();
    }

    public static PendingIntent firePendingIntent(Context context, int id, String payload, int extraFlags) {
        Intent intent = new Intent(context, AlarmRingReceiver.class);
        intent.setAction(ACTION_FIRE + "." + id);
        intent.putExtra("notificationId", id);
        intent.putExtra(EXTRA_PAYLOAD, payload);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE | extraFlags;
        try {
            return PendingIntent.getBroadcast(context, id, intent, flags);
        } catch (Exception e) {
            return null;
        }
    }

    public static PendingIntent showPendingIntent(Context context, int id, String payload, int extraFlags) {
        Intent intent = new Intent(context, AlarmRingActivity.class);
        intent.setAction("com.smartvoice.alarm.SHOW_ALARM." + id);
        intent.setFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_NO_USER_ACTION
        );
        intent.putExtra("notificationId", id);
        intent.putExtra(EXTRA_PAYLOAD, payload);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE | extraFlags;
        try {
            return PendingIntent.getActivity(context, id + 50_000, intent, flags);
        } catch (Exception e) {
            return null;
        }
    }

    public static PendingIntent activityPendingIntent(Context context, int id, String payload) {
        Intent intent = new Intent(context, AlarmRingActivity.class);
        intent.setAction("com.smartvoice.alarm.RING_UI." + id);
        intent.setFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP
                | Intent.FLAG_ACTIVITY_NO_USER_ACTION
        );
        intent.putExtra("notificationId", id);
        intent.putExtra(EXTRA_PAYLOAD, payload);
        return PendingIntent.getActivity(
            context,
            id + 100_000,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    public static PendingIntent fullScreenPendingIntent(Context context, int id, String payload) {
        Intent intent = new Intent(context, AlarmRingActivity.class);
        intent.setAction("com.smartvoice.alarm.FSI." + id);
        intent.setFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_NO_USER_ACTION
        );
        intent.putExtra("notificationId", id);
        intent.putExtra(EXTRA_PAYLOAD, payload);
        return PendingIntent.getActivity(
            context,
            id + 150_000,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    public static PendingIntent actionPendingIntent(Context context, String action, int id, String payload) {
        Intent intent = new Intent(context, AlarmActionReceiver.class);
        intent.setAction(action + "." + id);
        intent.putExtra("alarmAction", action);
        intent.putExtra("notificationId", id);
        intent.putExtra(EXTRA_PAYLOAD, payload);
        int req = action.equals(ACTION_SNOOZE) ? id + 200_000 : id + 300_000;
        return PendingIntent.getBroadcast(
            context,
            req,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    public static boolean canUseFullScreenIntent(Context context) {
        if (Build.VERSION.SDK_INT < 34) return true;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        return nm != null && nm.canUseFullScreenIntent();
    }

    public static void openFullScreenSettings(Context context) {
        if (Build.VERSION.SDK_INT < 34) return;
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
            intent.setData(Uri.parse("package:" + context.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        } catch (Exception ignored) {
        }
    }

    public static void requestIgnoreBatteryOptimizations(Context context) {
        try {
            String pkg = context.getPackageName();
            android.os.PowerManager pm =
                (android.os.PowerManager) context.getSystemService(Context.POWER_SERVICE);
            if (pm != null && pm.isIgnoringBatteryOptimizations(pkg)) return;
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + pkg));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        } catch (Exception ignored) {
        }
    }

    public static void savePendingEvent(Context context, String event, int id, String payload) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_PENDING_EVENT, event)
            .putString(KEY_PENDING_PAYLOAD, payload)
            .putInt(KEY_PENDING_ID, id)
            .apply();
    }

    public static JSONObject consumePendingEvent(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String event = prefs.getString(KEY_PENDING_EVENT, null);
        if (event == null) return null;
        String payload = prefs.getString(KEY_PENDING_PAYLOAD, "{}");
        int id = prefs.getInt(KEY_PENDING_ID, 0);
        prefs.edit()
            .remove(KEY_PENDING_EVENT)
            .remove(KEY_PENDING_PAYLOAD)
            .remove(KEY_PENDING_ID)
            .apply();
        try {
            JSONObject out = new JSONObject();
            out.put("event", event);
            out.put("notificationId", id);
            out.put("payload", payload);
            return out;
        } catch (Exception e) {
            return null;
        }
    }

    /** Schedule a one-shot snooze alarm natively so it works if JS is dead. */
    public static void scheduleSnoozeFromPayload(Context context, String payloadJson) {
        try {
            ensureChannel(context);
            JSONObject src = new JSONObject(payloadJson != null ? payloadJson : "{}");
            long at = System.currentTimeMillis() + SNOOZE_MS;
            int id = 90_000 + (int) (at % 9_000);
            JSONObject alarm = new JSONObject();
            alarm.put("id", id);
            alarm.put("at", at);
            alarm.put("key", "snooze-" + at);
            alarm.put("type", "snooze");
            alarm.put("fireId", "snooze");
            alarm.put("title", src.optString("title", "Snoozed alarm"));
            alarm.put("speakText", src.optString("speakText", ""));
            alarm.put("voiceType", src.optString("voiceType", "female"));
            if (src.has("voiceURI")) alarm.put("voiceURI", src.optString("voiceURI"));
            if (src.has("recordingId")) alarm.put("recordingId", src.optString("recordingId"));
            if (src.has("soundType")) alarm.put("soundType", src.optString("soundType"));
            if (src.has("customRingtoneId")) {
                alarm.put("customRingtoneId", src.optString("customRingtoneId"));
            }

            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            PendingIntent pi = firePendingIntent(context, id, alarm.toString(), 0);
            if (pi == null) return;
            PendingIntent show = showPendingIntent(context, id, alarm.toString(), 0);
            am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, show), pi);
            SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            Set<String> ids = new HashSet<>(prefs.getStringSet(KEY_IDS, new HashSet<>()));
            ids.add(String.valueOf(id));
            prefs.edit().putStringSet(KEY_IDS, ids).putString("payload_" + id, alarm.toString()).apply();
        } catch (Exception ignored) {
        }
    }
}
