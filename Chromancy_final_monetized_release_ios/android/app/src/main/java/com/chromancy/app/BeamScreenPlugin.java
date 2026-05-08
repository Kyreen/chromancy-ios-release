package com.chromancy.app;

import android.view.Window;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BeamScreen")
public class BeamScreenPlugin extends Plugin {
    private Float originalBrightness = null;

    @PluginMethod
    public void captureOriginalBrightness(PluginCall call) {
        Window window = getActivity().getWindow();
        if (window == null) {
            call.reject("Window is unavailable.");
            return;
        }

        window.getDecorView().post(() -> {
            WindowManager.LayoutParams params = window.getAttributes();
            if (originalBrightness == null) {
                originalBrightness = params.screenBrightness;
            }
            JSObject result = new JSObject();
            result.put("brightness", originalBrightness != null ? originalBrightness : WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void setBrightness(PluginCall call) {
        Float requestedBrightness = call.getFloat("brightness");
        if (requestedBrightness == null) {
            call.reject("Missing brightness.");
            return;
        }

        Window window = getActivity().getWindow();
        if (window == null) {
            call.reject("Window is unavailable.");
            return;
        }

        final float clampedBrightness = Math.max(0.08f, Math.min(1.0f, requestedBrightness));
        window.getDecorView().post(() -> {
            WindowManager.LayoutParams params = window.getAttributes();
            if (originalBrightness == null) {
                originalBrightness = params.screenBrightness;
            }
            params.screenBrightness = clampedBrightness;
            window.setAttributes(params);

            JSObject result = new JSObject();
            result.put("brightness", clampedBrightness);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void restoreBrightness(PluginCall call) {
        Window window = getActivity().getWindow();
        if (window == null) {
            call.reject("Window is unavailable.");
            return;
        }

        window.getDecorView().post(() -> {
            WindowManager.LayoutParams params = window.getAttributes();
            float restoredBrightness = originalBrightness != null
                ? originalBrightness
                : WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE;
            params.screenBrightness = restoredBrightness;
            window.setAttributes(params);
            originalBrightness = null;

            JSObject result = new JSObject();
            result.put("brightness", restoredBrightness);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void setKeepAwake(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null) {
            call.reject("Missing keep awake state.");
            return;
        }

        Window window = getActivity().getWindow();
        if (window == null) {
            call.reject("Window is unavailable.");
            return;
        }

        window.getDecorView().post(() -> {
            if (enabled) {
                window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            } else {
                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
            call.resolve();
        });
    }
}
