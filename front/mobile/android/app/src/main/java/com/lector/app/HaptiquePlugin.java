package com.lector.app;

import android.os.Build;
import android.view.HapticFeedbackConstants;
import android.view.View;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Haptic feedback through the view, so the system "Touch feedback" setting is
 * respected and no VIBRATE permission is needed.
 */
@CapacitorPlugin(name = "Haptique")
public class HaptiquePlugin extends Plugin {

    @PluginMethod
    public void jouer(PluginCall call) {
        String type = call.getString("type", "confirm");
        getActivity().runOnUiThread(() -> {
            View vue = getBridge().getWebView();
            int effet;
            if ("tick".equals(type)) {
                effet = HapticFeedbackConstants.CLOCK_TICK;
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                effet = HapticFeedbackConstants.CONFIRM;
            } else {
                effet = HapticFeedbackConstants.CONTEXT_CLICK;
            }
            if (vue != null) vue.performHapticFeedback(effet);
            call.resolve();
        });
    }
}
