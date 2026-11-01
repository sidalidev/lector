package com.lector.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Build;
import android.util.Log;

/** Status of a PackageInstaller session started by AppUpdatePlugin (not exported, explicit PendingIntent). */
public class AppUpdateInstallReceiver extends BroadcastReceiver {

    private static final String TAG = "LectorUpdate";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!AppUpdatePlugin.ACTION_RESULT.equals(intent.getAction())) return;
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        switch (status) {
            case PackageInstaller.STATUS_PENDING_USER_ACTION: {
                Intent confirm = confirmationIntent(intent);
                if (confirm != null) {
                    // The user just tapped Install, Lector is in the foreground: show the system screen.
                    confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    try {
                        context.startActivity(confirm);
                    } catch (Exception e) {
                        Log.w(TAG, "Cannot show the install confirmation: " + e.getMessage());
                    }
                }
                break;
            }
            case PackageInstaller.STATUS_SUCCESS:
                Log.i(TAG, "Update installed");
                AppUpdatePlugin.onInstallFinished(false);
                break;
            case PackageInstaller.STATUS_FAILURE_ABORTED:
                // Cancelled by the user: keep the verified APK, the banner can offer it again.
                Log.i(TAG, "Install cancelled by the user");
                AppUpdatePlugin.onInstallFinished(true);
                break;
            default:
                Log.w(TAG, "Install refused (" + status + "): " + intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE));
                AppUpdatePlugin.onInstallFinished(false);
                break;
        }
    }

    @SuppressWarnings("deprecation")
    private static Intent confirmationIntent(Intent intent) {
        if (Build.VERSION.SDK_INT >= 33) return intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class);
        return intent.getParcelableExtra(Intent.EXTRA_INTENT);
    }
}
