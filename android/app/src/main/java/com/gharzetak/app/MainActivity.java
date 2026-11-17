package com.gharzetak.app;

import android.content.res.Configuration;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ImmersivePlugin.class);
        super.onCreate(savedInstanceState);
        ImmersiveMode.apply(this); // before the WebView paints: no flash of the navigation bar at launch
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Focus returns after resume, dialogs, the keyboard, Recents or split-screen: restore immersive once (no polling).
        if (hasFocus) ImmersiveMode.apply(this);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        ImmersiveMode.apply(this); // rotation / density / screen-reader changes
    }
}
