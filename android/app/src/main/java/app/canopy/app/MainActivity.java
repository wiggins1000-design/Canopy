package app.canopy.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must be registered before super.onCreate() -- that's where
        // BridgeActivity actually builds the plugin bridge.
        registerPlugin(CanopySharePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
