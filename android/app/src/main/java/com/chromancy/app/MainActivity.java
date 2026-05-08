package com.chromancy.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    private static final int CHROMANCY_MEDIA_PERMISSION_REQUEST = 1204;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeMediaStorePlugin.class);
        registerPlugin(BeamScreenPlugin.class);
        super.onCreate(savedInstanceState);
        requestChromancyMediaPermissions();
    }

    private void requestChromancyMediaPermissions() {
        List<String> permissionsToRequest = new ArrayList<>();

        addIfMissing(permissionsToRequest, Manifest.permission.CAMERA);
        addIfMissing(permissionsToRequest, Manifest.permission.RECORD_AUDIO);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            addIfMissing(permissionsToRequest, Manifest.permission.READ_MEDIA_IMAGES);
            addIfMissing(permissionsToRequest, Manifest.permission.READ_MEDIA_VIDEO);
            addIfMissing(permissionsToRequest, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            addIfMissing(permissionsToRequest, Manifest.permission.READ_MEDIA_IMAGES);
            addIfMissing(permissionsToRequest, Manifest.permission.READ_MEDIA_VIDEO);
        } else {
            addIfMissing(permissionsToRequest, Manifest.permission.READ_EXTERNAL_STORAGE);
            addIfMissing(permissionsToRequest, Manifest.permission.WRITE_EXTERNAL_STORAGE);
        }

        if (!permissionsToRequest.isEmpty()) {
            ActivityCompat.requestPermissions(
                this,
                permissionsToRequest.toArray(new String[0]),
                CHROMANCY_MEDIA_PERMISSION_REQUEST
            );
        }
    }

    private void addIfMissing(List<String> permissions, String permission) {
        if (ContextCompat.checkSelfPermission(this, permission) != PackageManager.PERMISSION_GRANTED) {
            permissions.add(permission);
        }
    }
}
