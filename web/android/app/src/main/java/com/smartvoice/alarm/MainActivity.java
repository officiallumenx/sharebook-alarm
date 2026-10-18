package com.smartvoice.alarm;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AlarmFullScreenPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
