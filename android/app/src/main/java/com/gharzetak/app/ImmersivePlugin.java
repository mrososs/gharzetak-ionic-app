package com.gharzetak.app;

import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** JS bridge for the "Immersive display" setting (see ImmersiveMode). */
@CapacitorPlugin(name = "Immersive")
public class ImmersivePlugin extends Plugin {

    private JSObject state() {
        JSObject o = new JSObject();
        o.put("preferred", ImmersiveMode.preferred(getContext()));
        o.put("active", ImmersiveMode.effective(getContext()));
        o.put("touchExploration", ImmersiveMode.touchExploration(getContext()));
        o.put("sdk", Build.VERSION.SDK_INT);
        return o;
    }

    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(state());
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", true));
        ImmersiveMode.setPreferred(getContext(), enabled);
        getActivity().runOnUiThread(() -> {
            ImmersiveMode.apply(getActivity());
            call.resolve(state());
        });
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        // The user may have switched TalkBack on/off while the app was in the background.
        notifyListeners("state", state());
    }
}
