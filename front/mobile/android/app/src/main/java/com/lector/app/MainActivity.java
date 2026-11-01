package com.lector.app;

import android.os.Bundle;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FilePickerPlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        registerPlugin(CredentialsPlugin.class);
        super.onCreate(savedInstanceState);
        // The config sets one background for both modes: use the theme one
        // (values / values-night) so dark mode never flashes cream at launch.
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setBackgroundColor(ContextCompat.getColor(this, R.color.lector_fond));
        }
    }
}
