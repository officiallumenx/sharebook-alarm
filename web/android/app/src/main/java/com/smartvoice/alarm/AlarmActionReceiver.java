package com.smartvoice.alarm;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Handles Snooze / Stop actions from the system notification.
 */
public class AlarmActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        int id = intent.getIntExtra("notificationId", 0);
        String payload = intent.getStringExtra(AlarmFullScreenHelper.EXTRA_PAYLOAD);
        if (payload == null) payload = "{}";

        String action = intent.getStringExtra("alarmAction");
        if (action == null && intent.getAction() != null) {
            String raw = intent.getAction();
            if (raw.startsWith(AlarmFullScreenHelper.ACTION_SNOOZE)) {
                action = AlarmFullScreenHelper.ACTION_SNOOZE;
            } else if (raw.startsWith(AlarmFullScreenHelper.ACTION_STOP)) {
                action = AlarmFullScreenHelper.ACTION_STOP;
            }
        }

        // Stop ringing session first
        AlarmRingService.stop(context);
        AlarmTonePlayer.stop();

        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm != null) nm.cancel(id);

        context.sendBroadcast(new Intent(AlarmRingActivity.ACTION_FINISH));

        if (AlarmFullScreenHelper.ACTION_SNOOZE.equals(action)) {
            AlarmFullScreenHelper.scheduleSnoozeFromPayload(context, payload);
            AlarmFullScreenHelper.savePendingEvent(context, "alarmSnoozed", id, payload);
            AlarmFullScreenPlugin.emitFromNative("alarmSnoozed", id, payload);
        } else if (AlarmFullScreenHelper.ACTION_STOP.equals(action)) {
            AlarmFullScreenHelper.savePendingEvent(context, "alarmStopped", id, payload);
            AlarmFullScreenPlugin.emitFromNative("alarmStopped", id, payload);
        }
    }
}
