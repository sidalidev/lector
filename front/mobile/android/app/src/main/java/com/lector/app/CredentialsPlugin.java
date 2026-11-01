package com.lector.app;

import android.app.Activity;
import android.os.CancellationSignal;
import android.util.Log;
import androidx.core.content.ContextCompat;
import androidx.credentials.CreateCredentialResponse;
import androidx.credentials.CreatePasswordRequest;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.GetPasswordOption;
import androidx.credentials.PasswordCredential;
import androidx.credentials.exceptions.CreateCredentialCancellationException;
import androidx.credentials.exceptions.CreateCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.NoCredentialException;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Collections;

/**
 * The 12 words of the sync chain in the user's password manager (Proton Pass, Bitwarden...),
 * through the Android Credential Manager. Only androidx.credentials: no Google library, the
 * system routes the request to whichever manager the user picked (Android 14 and later).
 *
 * The entry always uses the same id, "lector-sync-chain", so every device finds it again.
 * The words never go through the clipboard and are never logged.
 */
@CapacitorPlugin(name = "Credentials")
public class CredentialsPlugin extends Plugin {

    private static final String TAG = "LectorCredentials";
    private static final String CHAIN_ID = "lector-sync-chain";

    private CredentialManager manager() {
        return CredentialManager.create(getContext());
    }

    /** Offers to save the words. Resolves {saved}, plus {cancelled} when the user dismissed the sheet. */
    @PluginMethod
    public void store(PluginCall call) {
        String password = call.getString("password");
        Activity activity = getActivity();
        if (password == null || password.isEmpty() || activity == null) {
            call.reject("missing password");
            return;
        }
        CreatePasswordRequest request = new CreatePasswordRequest(CHAIN_ID, password);
        manager().createCredentialAsync(
            activity,
            request,
            new CancellationSignal(),
            ContextCompat.getMainExecutor(getContext()),
            new CredentialManagerCallback<CreateCredentialResponse, CreateCredentialException>() {
                @Override
                public void onResult(CreateCredentialResponse response) {
                    JSObject ret = new JSObject();
                    ret.put("saved", true);
                    call.resolve(ret);
                }

                @Override
                public void onError(CreateCredentialException e) {
                    JSObject ret = new JSObject();
                    ret.put("saved", false);
                    if (e instanceof CreateCredentialCancellationException) {
                        ret.put("cancelled", true);
                    } else {
                        Log.w(TAG, "Save unavailable: " + e.getType());
                    }
                    call.resolve(ret);
                }
            }
        );
    }

    /** Asks the password manager for the words. Resolves {password}, {cancelled}, or nothing found. */
    @PluginMethod
    public void get(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("no activity");
            return;
        }
        GetCredentialRequest request = new GetCredentialRequest.Builder()
            .addCredentialOption(new GetPasswordOption(Collections.singleton(CHAIN_ID)))
            .build();
        manager().getCredentialAsync(
            activity,
            request,
            new CancellationSignal(),
            ContextCompat.getMainExecutor(getContext()),
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse response) {
                    JSObject ret = new JSObject();
                    Credential c = response.getCredential();
                    if (c instanceof PasswordCredential) {
                        String pw = ((PasswordCredential) c).getPassword();
                        if (!pw.isEmpty()) ret.put("password", pw);
                    }
                    call.resolve(ret);
                }

                @Override
                public void onError(GetCredentialException e) {
                    JSObject ret = new JSObject();
                    if (e instanceof GetCredentialCancellationException) {
                        ret.put("cancelled", true);
                    } else if (!(e instanceof NoCredentialException)) {
                        Log.w(TAG, "Retrieval unavailable: " + e.getType());
                    }
                    call.resolve(ret);
                }
            }
        );
    }
}
