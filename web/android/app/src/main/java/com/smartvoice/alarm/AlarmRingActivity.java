package com.smartvoice.alarm;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Lock / home ringing UI styled to match the in-app RingingModal.
 */
public class AlarmRingActivity extends Activity {
    public static final String ACTION_FINISH = "com.smartvoice.alarm.ACTION_FINISH_RING_UI";

    private int notificationId;
    private String payload = "{}";
    private boolean finishingByUser;
    private final BroadcastReceiver finishReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            finishingByUser = true;
            finish();
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applyLockScreenFlags();
        bindIntent(getIntent());
        buildUi();

        if (!AlarmTonePlayer.isPlaying()) {
            AlarmRingService.start(this, notificationId, payload);
        }

        IntentFilter filter = new IntentFilter(ACTION_FINISH);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(finishReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(finishReceiver, filter);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        applyLockScreenFlags();
        bindIntent(intent);
        if (!AlarmTonePlayer.isPlaying()) {
            AlarmRingService.start(this, notificationId, payload);
        }
    }

    @Override
    public void onBackPressed() {
        /* require Stop / Snooze */
    }

    private void applyLockScreenFlags() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            );
        }
        getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON
        );
    }

    private void bindIntent(Intent intent) {
        if (intent == null) return;
        notificationId = intent.getIntExtra("notificationId", 0);
        String p = intent.getStringExtra(AlarmFullScreenHelper.EXTRA_PAYLOAD);
        if (p != null) payload = p;
    }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()
        ));
    }

    private GradientDrawable roundRect(String color, float radiusDp) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(Color.parseColor(color));
        d.setCornerRadius(dp((int) radiusDp));
        return d;
    }

    private void buildUi() {
        String title = "Alarm";
        try {
            org.json.JSONObject json = new org.json.JSONObject(payload);
            title = json.optString("title", "Alarm");
        } catch (Exception ignored) {
        }
        if (title == null || title.trim().isEmpty() || title.trim().equalsIgnoreCase("Alarm")) {
            title = "Playing ringtone";
        } else {
            title = "\u201C" + title.trim() + "\u201D";
        }

        String soundLabel = AlarmTonePlayer.getSoundLabel(this);
        try {
            org.json.JSONObject json = new org.json.JSONObject(payload);
            if (json.has("soundLabel") && json.optString("soundLabel").length() > 0) {
                soundLabel = json.optString("soundLabel");
            }
        } catch (Exception ignored) {
        }

        // Dimmed full-bleed backdrop (matches bg-black/70 + blur feel)
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(dp(20), dp(20), dp(20), dp(20));
        root.setBackgroundColor(Color.parseColor("#B30A1628"));

        // Card — surface panel like RingingModal
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setGravity(Gravity.CENTER_HORIZONTAL);
        card.setPadding(dp(28), dp(32), dp(28), dp(28));
        GradientDrawable cardBg = roundRect("#F4F1EA", 28);
        cardBg.setStroke(dp(1), Color.parseColor("#33C4A35A"));
        card.setBackground(cardBg);
        LinearLayout.LayoutParams cardLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        cardLp.setMargins(dp(8), 0, dp(8), 0);
        root.addView(card, cardLp);

        // Brand bell circle
        LinearLayout bellWrap = new LinearLayout(this);
        bellWrap.setGravity(Gravity.CENTER);
        GradientDrawable bellBg = new GradientDrawable();
        bellBg.setShape(GradientDrawable.OVAL);
        bellBg.setColor(Color.parseColor("#E8C47C"));
        bellWrap.setBackground(bellBg);
        int bellSize = dp(72);
        LinearLayout.LayoutParams bellLp = new LinearLayout.LayoutParams(bellSize, bellSize);
        bellLp.bottomMargin = dp(18);
        card.addView(bellWrap, bellLp);

        ImageView bell = new ImageView(this);
        bell.setImageResource(R.drawable.ic_bell_ring);
        bell.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        bellWrap.addView(bell, new LinearLayout.LayoutParams(dp(34), dp(34)));

        TextView eyebrow = new TextView(this);
        eyebrow.setText("ALARM");
        eyebrow.setTextColor(Color.parseColor("#8A7350"));
        eyebrow.setTextSize(11f);
        eyebrow.setTypeface(Typeface.DEFAULT_BOLD);
        eyebrow.setLetterSpacing(0.12f);
        eyebrow.setGravity(Gravity.CENTER);
        card.addView(eyebrow);

        TextView titleView = new TextView(this);
        titleView.setText(title);
        titleView.setTextColor(Color.parseColor("#1A1520"));
        titleView.setTextSize(24f);
        titleView.setTypeface(Typeface.DEFAULT_BOLD);
        titleView.setGravity(Gravity.CENTER);
        titleView.setPadding(dp(4), dp(6), dp(4), dp(4));
        card.addView(titleView);

        TextView subtitle = new TextView(this);
        subtitle.setText(soundLabel);
        subtitle.setTextColor(Color.parseColor("#6B5E4E"));
        subtitle.setTextSize(14f);
        subtitle.setGravity(Gravity.CENTER);
        subtitle.setPadding(0, 0, 0, dp(28));
        card.addView(subtitle);

        // Buttons row (stacked on narrow — Snooze then Dismiss like modal)
        Button snooze = new Button(this);
        snooze.setText("Snooze (5m)");
        snooze.setAllCaps(false);
        snooze.setTextSize(15f);
        snooze.setTypeface(Typeface.DEFAULT_BOLD);
        snooze.setTextColor(Color.parseColor("#8B6914"));
        snooze.setBackground(roundRect("#F0E2C4", 18));
        snooze.setPadding(dp(12), dp(16), dp(12), dp(16));
        snooze.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finishingByUser = true;
                AlarmFullScreenHelper.scheduleSnoozeFromPayload(AlarmRingActivity.this, payload);
                AlarmFullScreenHelper.savePendingEvent(
                    AlarmRingActivity.this, "alarmSnoozed", notificationId, payload
                );
                AlarmFullScreenPlugin.emitFromNative("alarmSnoozed", notificationId, payload);
                AlarmRingService.stop(AlarmRingActivity.this);
                dismissNotification();
                finish();
            }
        });
        LinearLayout.LayoutParams snoozeLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        snoozeLp.bottomMargin = dp(12);
        card.addView(snooze, snoozeLp);

        Button dismiss = new Button(this);
        dismiss.setText("Dismiss");
        dismiss.setAllCaps(false);
        dismiss.setTextSize(15f);
        dismiss.setTypeface(Typeface.DEFAULT_BOLD);
        dismiss.setTextColor(Color.parseColor("#0A1628"));
        dismiss.setBackground(roundRect("#E8C47C", 18));
        dismiss.setPadding(dp(12), dp(16), dp(12), dp(16));
        dismiss.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finishingByUser = true;
                AlarmFullScreenHelper.savePendingEvent(
                    AlarmRingActivity.this, "alarmStopped", notificationId, payload
                );
                AlarmFullScreenPlugin.emitFromNative("alarmStopped", notificationId, payload);
                AlarmRingService.stop(AlarmRingActivity.this);
                dismissNotification();
                finish();
            }
        });
        card.addView(dismiss, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ));

        TextView brand = new TextView(this);
        brand.setText("Sharebook");
        brand.setTextColor(Color.parseColor("#A89060"));
        brand.setTextSize(12f);
        brand.setTypeface(Typeface.DEFAULT_BOLD);
        brand.setGravity(Gravity.CENTER);
        brand.setPadding(0, dp(20), 0, 0);
        card.addView(brand);

        setContentView(root);
    }

    private void dismissNotification() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.cancel(notificationId);
    }

    @Override
    protected void onDestroy() {
        try {
            unregisterReceiver(finishReceiver);
        } catch (Exception ignored) {
        }
        super.onDestroy();
    }
}
