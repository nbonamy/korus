package com.nabocorp.korus.companion;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CompanionVaultPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
