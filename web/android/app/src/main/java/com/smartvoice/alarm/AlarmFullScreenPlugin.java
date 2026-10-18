package com.smartvoice.alarm;

import android.app.NotificationManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "AlarmFullScreen")
public class AlarmFullScreenPlugin extends Plugin {
    private static AlarmFullScreenPlugin instance;

    @Override
    public void load() {
        super.load();
        instance = this;
        AlarmFullScreenHelper.ensureChannel(getContext());
    }

    @PluginMethod
    public void schedule(PluginCall call) {
        try {
            JSArray alarms = call.getArray("alarms");
            if (alarms == null) {
                call.reject("alarms required");
                return;
            }
            JSONArray arr = new JSONArray();
            for (int i = 0; i < alarms.length(); i++) {
                arr.put(alarms.getJSONObject(i));
            }
            AlarmFullScreenHelper.scheduleAll(getContext(), arr);
            call.resolve();
        } catch (Exception e) {
            call.reject("schedule failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void cancelAll(PluginCall call) {
        AlarmFullScreenHelper.cancelAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        try {
            JSArray ids = call.getArray("ids");
            if (ids != null) {
                for (int i = 0; i < ids.length(); i++) {
                    AlarmFullScreenHelper.cancelOne(getContext(), ids.getInt(i));
                }
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("cancel failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void dismissNotification(PluginCall call) {
        Integer id = call.getInt("id");
        if (id != null) {
            NotificationManager nm = getContext().getSystemService(NotificationManager.class);
            if (nm != null) nm.cancel(id);
        }
        call.resolve();
    }

    @PluginMethod
    public void setRingtone(PluginCall call) {
        try {
            Boolean useBuiltIn = call.getBoolean("useBuiltIn", false);
            String soundType = call.getString("soundType", "digital");
            String label = call.getString("label", "Alarm");
            if (Boolean.TRUE.equals(useBuiltIn)) {
                AlarmTonePlayer.useBuiltInTone(getContext(), soundType, label);
            } else {
                String base64 = call.getString("base64");
                if (base64 == null || base64.isEmpty()) {
                    call.reject("base64 required");
                    return;
                }
                String mime = call.getString("mimeType", "audio/mpeg");
                AlarmTonePlayer.saveRingtoneBase64(getContext(), base64, mime, soundType, label);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("setRingtone failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void startAlarmTone(PluginCall call) {
        try {
            org.json.JSONObject payload = new org.json.JSONObject();
            payload.put("title", "Alarm");
            payload.put("key", "tone-" + System.currentTimeMillis());
            AlarmRingService.start(getContext(), 424241, payload.toString());
            call.resolve();
        } catch (Exception e) {
            AlarmTonePlayer.start(getContext());
            call.resolve();
        }
    }

    @PluginMethod
    public void stopAlarmTone(PluginCall call) {
        AlarmRingService.stop(getContext());
        AlarmTonePlayer.stop();
        call.resolve();
    }

    @PluginMethod
    public void isRinging(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ringing", AlarmTonePlayer.isActiveSession() || AlarmTonePlayer.isPlaying());
        call.resolve(ret);
    }

    @PluginMethod
    public void presentRingingUi(PluginCall call) {
        try {
            Integer idObj = call.getInt("notificationId");
            int id = idObj != null ? idObj : 424240;
            String title = call.getString("title", "Alarm");
            JSObject extra = call.getObject("extra");
            org.json.JSONObject payload = extra != null
                ? new org.json.JSONObject(extra.toString())
                : new org.json.JSONObject();
            if (!payload.has("title")) payload.put("title", title);
            AlarmFullScreenHelper.ensureChannel(getContext());
            // Service owns tone + notification + lock/home UI
            AlarmRingService.start(getContext(), id, payload.toString());
            call.resolve();
        } catch (Exception e) {
            call.reject("presentRingingUi failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void checkFullScreenPermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", AlarmFullScreenHelper.canUseFullScreenIntent(getContext()));
        call.resolve(ret);
    }

    @PluginMethod
    public void requestFullScreenPermission(PluginCall call) {
        boolean granted = AlarmFullScreenHelper.canUseFullScreenIntent(getContext());
        if (!granted) {
            AlarmFullScreenHelper.openFullScreenSettings(getContext());
        }
        JSObject ret = new JSObject();
        ret.put("granted", AlarmFullScreenHelper.canUseFullScreenIntent(getContext()));
        call.resolve(ret);
    }

    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        AlarmFullScreenHelper.requestIgnoreBatteryOptimizations(getContext());
        JSObject ret = new JSObject();
        ret.put("requested", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void consumePendingEvent(PluginCall call) {
        try {
            org.json.JSONObject pending = AlarmFullScreenHelper.consumePendingEvent(getContext());
            JSObject ret = new JSObject();
            if (pending == null) {
                ret.put("hasEvent", false);
                call.resolve(ret);
                return;
            }
            String event = pending.optString("event", "");
            int id = pending.optInt("notificationId", 0);
            String payload = pending.optString("payload", "{}");
            JSObject data = payloadToJs(id, payload);
            ret.put("hasEvent", true);
            ret.put("event", event);
            ret.put("data", data);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("consumePendingEvent failed: " + e.getMessage(), e);
        }
    }

    /** Emit to JS from receivers / activity (bridge may be null if process was dead). */
    public static void emitFromNative(String event, int notificationId, String payloadJson) {
        AlarmFullScreenPlugin plugin = instance;
        JSObject data = payloadToJs(notificationId, payloadJson);
        if (plugin != null) {
            plugin.notifyListeners(event, data, true);
        }
    }

    private static JSObject payloadToJs(int notificationId, String payloadJson) {
        JSObject data = new JSObject();
        data.put("notificationId", notificationId);
        try {
            JSONObject json = new JSONObject(payloadJson != null ? payloadJson : "{}");
            data.put("key", json.optString("key", ""));
            data.put("type", json.optString("type", "alarm"));
            data.put("fireId", json.optString("fireId", ""));
            data.put("title", json.optString("title", "Alarm"));
            data.put("speakText", json.optString("speakText", ""));
            data.put("voiceType", json.optString("voiceType", "female"));
            if (json.has("voiceURI") && json.optString("voiceURI").length() > 0) {
                data.put("voiceURI", json.optString("voiceURI"));
            }
            if (json.has("recordingId") && json.optString("recordingId").length() > 0) {
                data.put("recordingId", json.optString("recordingId"));
            }
            if (json.has("soundType")) data.put("soundType", json.optString("soundType"));
            if (json.has("customRingtoneId") && json.optString("customRingtoneId").length() > 0) {
                data.put("customRingtoneId", json.optString("customRingtoneId"));
            }
            if (json.has("at")) data.put("at", json.optLong("at"));
        } catch (Exception e) {
            data.put("key", "");
            data.put("title", "Alarm");
            data.put("type", "alarm");
            data.put("fireId", "");
            data.put("speakText", "");
            data.put("voiceType", "female");
        }
        return data;
    }
}
