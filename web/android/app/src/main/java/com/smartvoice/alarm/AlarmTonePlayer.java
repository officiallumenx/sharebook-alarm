package com.smartvoice.alarm;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

import java.io.File;
import java.io.FileOutputStream;

/**
 * Looping alarm tone on {@link AudioManager#STREAM_ALARM}.
 * Prefers the ringtone the user set in Sharebook, then app bundled tone,
 * then the device default alarm — never Music stream.
 */
public final class AlarmTonePlayer {
    public static final String PREFS = "sharebook_ringtone_prefs";
    public static final String KEY_PATH = "ringtone_path";
    public static final String KEY_SOUND_TYPE = "sound_type";
    public static final String KEY_LABEL = "sound_label";
    public static final String FILE_PREFIX = "sharebook_alarm_ringtone";

    private static MediaPlayer player;
    private static Vibrator vibrator;
    private static AudioManager audioManager;
    private static AudioFocusRequest focusRequest;
    private static final Handler handler = new Handler(Looper.getMainLooper());
    private static Runnable watchdog;
    private static boolean active;
    private static Context appContext;

    private AlarmTonePlayer() {}

    private static AudioAttributes alarmAttrs() {
        return new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .setLegacyStreamType(AudioManager.STREAM_ALARM)
            .build();
    }

    public static void saveRingtoneBase64(Context context, String base64, String mimeType, String soundType, String label) {
        Context app = context.getApplicationContext();
        // Never rewrite the file while an alarm is actively playing
        if (active && isPlaying()) return;
        try {
            clearRingtoneFile(app);
            String ext = extForMime(mimeType);
            File out = new File(app.getFilesDir(), FILE_PREFIX + ext);
            byte[] data = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
            if (data == null || data.length < 32) {
                clearRingtoneFile(app);
                return;
            }
            FileOutputStream fos = new FileOutputStream(out);
            fos.write(data);
            fos.flush();
            fos.close();
            app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_PATH, out.getAbsolutePath())
                .putString(KEY_SOUND_TYPE, soundType != null ? soundType : "custom")
                .putString(KEY_LABEL, label != null ? label : "Custom ringtone")
                .apply();
        } catch (Exception e) {
            clearRingtoneFile(app);
        }
    }

    public static void useBuiltInTone(Context context, String soundType, String label) {
        Context app = context.getApplicationContext();
        if (active && isPlaying()) {
            // Still update label/type prefs, but don't delete a file in use
            app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_SOUND_TYPE, soundType != null ? soundType : "digital")
                .putString(KEY_LABEL, label != null ? label : "Alarm")
                .apply();
            return;
        }
        clearRingtoneFile(app);
        app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY_PATH)
            .putString(KEY_SOUND_TYPE, soundType != null ? soundType : "digital")
            .putString(KEY_LABEL, label != null ? label : "Alarm")
            .apply();
    }

    public static String getSoundLabel(Context context) {
        return context.getApplicationContext()
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_LABEL, "Alarm");
    }

    private static void clearRingtoneFile(Context app) {
        SharedPreferences prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String path = prefs.getString(KEY_PATH, null);
        if (path != null) {
            try {
                //noinspection ResultOfMethodCallIgnored
                new File(path).delete();
            } catch (Exception ignored) {
            }
        }
        File dir = app.getFilesDir();
        File[] files = dir.listFiles();
        if (files != null) {
            for (File f : files) {
                if (f.getName().startsWith(FILE_PREFIX)) {
                    //noinspection ResultOfMethodCallIgnored
                    f.delete();
                }
            }
        }
        prefs.edit().remove(KEY_PATH).apply();
    }

    private static String extForMime(String mime) {
        if (mime == null) return ".mp3";
        String m = mime.toLowerCase();
        if (m.contains("mpeg") || m.contains("mp3")) return ".mp3";
        if (m.contains("wav")) return ".wav";
        if (m.contains("ogg")) return ".ogg";
        if (m.contains("mp4") || m.contains("m4a") || m.contains("aac")) return ".m4a";
        if (m.contains("3gp")) return ".3gp";
        return ".bin";
    }

    public static synchronized void start(Context context) {
        Context app = context.getApplicationContext();
        appContext = app;
        if (active && isPlaying()) return;
        stopInternal(false);
        active = true;
        audioManager = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);

        try {
            if (audioManager != null) {
                int max = audioManager.getStreamMaxVolume(AudioManager.STREAM_ALARM);
                int cur = audioManager.getStreamVolume(AudioManager.STREAM_ALARM);
                if (max > 0 && cur <= 0) {
                    audioManager.setStreamVolume(AudioManager.STREAM_ALARM, Math.max(1, (max * 3) / 5), 0);
                }
                requestAlarmFocus(audioManager);
            }
        } catch (Exception ignored) {
        }

        boolean started =
            startFromUserFile(app)
                || startFromUri(app, Uri.parse("android.resource://" + app.getPackageName() + "/raw/alarm_loop"))
                || startFromUri(app, Uri.parse("android.resource://" + app.getPackageName() + "/raw/beep"))
                || startFromUri(app, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM));

        if (!started) {
            active = false;
            abandonFocus();
            return;
        }
        startVibrate(app);
        startWatchdog();
    }

    private static void requestAlarmFocus(AudioManager am) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                    .setAudioAttributes(alarmAttrs())
                    .setOnAudioFocusChangeListener(new AudioManager.OnAudioFocusChangeListener() {
                        @Override
                        public void onAudioFocusChange(int focusChange) {
                            // Keep alarm playing through focus loss — alarms must continue
                            if (focusChange == AudioManager.AUDIOFOCUS_LOSS
                                || focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                                handler.post(new Runnable() {
                                    @Override
                                    public void run() {
                                        if (active && player != null) {
                                            try {
                                                if (!player.isPlaying()) player.start();
                                            } catch (Exception ignored) {
                                            }
                                        }
                                    }
                                });
                            }
                        }
                    })
                    .build();
                am.requestAudioFocus(focusRequest);
            } else {
                am.requestAudioFocus(
                    null,
                    AudioManager.STREAM_ALARM,
                    AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
                );
            }
        } catch (Exception ignored) {
        }
    }

    private static void abandonFocus() {
        try {
            if (audioManager == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && focusRequest != null) {
                audioManager.abandonAudioFocusRequest(focusRequest);
            }
        } catch (Exception ignored) {
        }
        focusRequest = null;
    }

    private static boolean startFromUserFile(Context app) {
        String path = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_PATH, null);
        if (path == null || path.isEmpty()) return false;
        File f = new File(path);
        if (!f.exists() || f.length() < 32) return false;
        return startFromPath(path);
    }

    private static boolean startFromPath(String path) {
        try {
            MediaPlayer mp = new MediaPlayer();
            mp.setAudioAttributes(alarmAttrs());
            mp.setDataSource(path);
            return prepareAndStart(mp);
        } catch (Exception e) {
            return false;
        }
    }

    private static boolean startFromUri(Context app, Uri uri) {
        if (uri == null) return false;
        try {
            MediaPlayer mp = new MediaPlayer();
            mp.setAudioAttributes(alarmAttrs());
            mp.setDataSource(app, uri);
            return prepareAndStart(mp);
        } catch (Exception e) {
            return false;
        }
    }

    private static boolean prepareAndStart(MediaPlayer mp) {
        try {
            mp.setOnPreparedListener(new MediaPlayer.OnPreparedListener() {
                @Override
                public void onPrepared(MediaPlayer mediaPlayer) {
                    try {
                        mediaPlayer.setLooping(true);
                        mediaPlayer.setVolume(1f, 1f);
                        mediaPlayer.start();
                    } catch (Exception ignored) {
                    }
                }
            });
            mp.setOnCompletionListener(new MediaPlayer.OnCompletionListener() {
                @Override
                public void onCompletion(MediaPlayer mediaPlayer) {
                    if (!active) return;
                    // Looping failed on this device — restart manually
                    try {
                        mediaPlayer.seekTo(0);
                        mediaPlayer.setLooping(true);
                        mediaPlayer.start();
                    } catch (Exception e) {
                        // Rebuild player from the same source if needed
                        if (appContext != null) {
                            handler.post(new Runnable() {
                                @Override
                                public void run() {
                                    if (active) start(appContext);
                                }
                            });
                        }
                    }
                }
            });
            mp.setOnErrorListener(new MediaPlayer.OnErrorListener() {
                @Override
                public boolean onError(MediaPlayer mediaPlayer, int what, int extra) {
                    if (!active || appContext == null) return true;
                    handler.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            if (active) start(appContext);
                        }
                    }, 300);
                    return true;
                }
            });
            // setLooping before + after prepare for OEM quirks
            mp.setLooping(true);
            mp.setVolume(1f, 1f);
            mp.prepare();
            mp.setLooping(true);
            mp.start();
            player = mp;
            return true;
        } catch (Exception e) {
            try {
                mp.release();
            } catch (Exception ignored) {
            }
            return false;
        }
    }

    private static void startWatchdog() {
        if (watchdog != null) handler.removeCallbacks(watchdog);
        watchdog = new Runnable() {
            @Override
            public void run() {
                if (!active) return;
                try {
                    if (player == null || !player.isPlaying()) {
                        if (appContext != null) {
                            // Restart full pipeline if player died
                            start(appContext);
                        }
                    }
                } catch (Exception e) {
                    if (appContext != null) start(appContext);
                }
                handler.postDelayed(this, 1500);
            }
        };
        handler.postDelayed(watchdog, 1500);
    }

    public static synchronized void stop() {
        stopInternal(true);
    }

    private static void stopInternal(boolean clearActive) {
        if (clearActive) active = false;
        if (watchdog != null) {
            handler.removeCallbacks(watchdog);
            watchdog = null;
        }
        if (player != null) {
            try {
                player.setOnCompletionListener(null);
                player.setOnErrorListener(null);
                player.setOnPreparedListener(null);
                if (player.isPlaying()) player.stop();
            } catch (Exception ignored) {
            }
            try {
                player.release();
            } catch (Exception ignored) {
            }
            player = null;
        }
        if (vibrator != null) {
            try {
                vibrator.cancel();
            } catch (Exception ignored) {
            }
            vibrator = null;
        }
        if (clearActive) abandonFocus();
    }

    public static synchronized boolean isPlaying() {
        try {
            return player != null && player.isPlaying();
        } catch (Exception e) {
            return false;
        }
    }

    public static synchronized boolean isActiveSession() {
        return active;
    }

    private static void startVibrate(Context context) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager vm =
                    (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                vibrator = vm != null ? vm.getDefaultVibrator() : null;
            } else {
                vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            }
            if (vibrator == null || !vibrator.hasVibrator()) return;
            long[] pattern = new long[] {0, 700, 500, 700, 500};
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
            } else {
                vibrator.vibrate(pattern, 0);
            }
        } catch (Exception ignored) {
            vibrator = null;
        }
    }
}
