package com.microsoft.codepush.react;

import com.facebook.react.ReactHost;

/**
 * Provides access to a {@link ReactHost}.
 *
 * ReactNativeHost already implements this interface, if you make use of that react-native
 * component (just add `implements ReactInstanceHolder`).
 */
public interface ReactInstanceHolder {

  /**
   * Get the current {@link ReactHost} instance. May return null.
   */
  ReactHost getReactHost();
}
