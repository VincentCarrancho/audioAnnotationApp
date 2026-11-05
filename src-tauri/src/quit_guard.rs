use tauri::{AppHandle, Manager, Runtime};

/// Always prevent the original quit while a main window exists, including when
/// scheduling its close fails. With no main window, allow normal final exit.
fn should_prevent_exit(has_main_window: bool, close: impl FnOnce() -> Result<(), String>) -> bool {
    if !has_main_window {
        return false;
    }
    if let Err(error) = close() {
        eprintln!("Cannot request a safe window close: {error}");
    }
    true
}

pub fn route_to_close<R: Runtime>(app: &AppHandle<R>) -> bool {
    let window = app.get_webview_window("main");
    should_prevent_exit(window.is_some(), || {
        window
            .expect("checked main window")
            .close()
            .map_err(|e| e.to_string())
    })
}

#[cfg(not(target_os = "macos"))]
pub fn install<R: Runtime>(_app: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

// Tao's installed macOS delegate has no applicationShouldTerminate: method,
// and its predefined Quit menu sends NSApplication terminate: directly. That
// path does not first produce Tauri's ExitRequested or CloseRequested events.
// Add the missing delegate method, without replacing any existing implementation.
// Refuse to start if a future runtime already implements it or installation fails.
#[cfg(target_os = "macos")]
mod macos {
    use super::route_to_close;
    use objc2::{
        class, ffi, msg_send,
        runtime::{AnyClass, AnyObject, Imp, Sel},
        sel,
    };
    use std::sync::OnceLock;
    use tauri::{AppHandle, Wry};

    static APP: OnceLock<AppHandle<Wry>> = OnceLock::new();

    // NSApplicationTerminateReply is NSUInteger: 0 = cancel, 1 = terminate now.
    unsafe extern "C-unwind" fn should_terminate(
        _delegate: *mut AnyObject,
        _selector: Sel,
        _application: *mut AnyObject,
    ) -> usize {
        // Never let a Rust panic unwind into AppKit or turn a failure into data loss.
        match std::panic::catch_unwind(|| APP.get().map(route_to_close)) {
            Ok(Some(false)) => 1,
            _ => 0,
        }
    }

    pub fn install(app: &AppHandle<Wry>) -> Result<(), Box<dyn std::error::Error>> {
        APP.set(app.clone())
            .map_err(|_| "Quit guard is already installed")?;
        // Tauri calls setup on the AppKit main thread after Tao sets its delegate.
        // The signature matches applicationShouldTerminate: (NSUInteger, object).
        unsafe {
            let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let delegate: *mut AnyObject = msg_send![ns_app, delegate];
            install_on_delegate(delegate)?;
            // Refresh AppKit's cached delegate capabilities. Tao owns a strong
            // reference to this delegate for the lifetime of its event loop.
            let _: () = msg_send![ns_app, setDelegate: std::ptr::null_mut::<AnyObject>()];
            let _: () = msg_send![ns_app, setDelegate: delegate];
        }
        #[cfg(debug_assertions)]
        eprintln!("wavNotes: macOS quit guard installed");
        Ok(())
    }

    // Safety: caller supplies the live AppKit delegate on the main thread (or a
    // test-owned object), and the installed implementation has the stated ABI.
    unsafe fn install_on_delegate(
        delegate: *mut AnyObject,
    ) -> Result<(), Box<dyn std::error::Error>> {
        if delegate.is_null() {
            return Err("Cannot protect quitting: macOS application delegate is missing".into());
        }
        let class = ffi::object_getClass(delegate) as *mut AnyClass;
        let selector = sel!(applicationShouldTerminate:);
        if class.is_null() || !ffi::class_getInstanceMethod(class, selector).is_null() {
            return Err("Cannot protect quitting: unsupported macOS application delegate".into());
        }
        let implementation: Imp = std::mem::transmute(
            should_terminate
                as unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> usize,
        );
        if !ffi::class_addMethod(class, selector, implementation, c"Q@:@".as_ptr()).as_bool() {
            return Err("Cannot install macOS quit protection".into());
        }
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use objc2::{
            rc::Retained,
            runtime::{ClassBuilder, NSObject},
            ClassType,
        };

        #[test]
        fn delegate_method_uses_appkit_abi_and_fails_closed_before_setup() {
            let cls = ClassBuilder::new(c"WavNotesQuitGuardTestDelegate", NSObject::class())
                .unwrap()
                .register();
            let delegate: Retained<NSObject> = unsafe { msg_send![cls, new] };
            let ptr = Retained::as_ptr(&delegate) as *mut AnyObject;
            unsafe {
                install_on_delegate(ptr).unwrap();
                let reply: usize = msg_send![&*delegate, applicationShouldTerminate: std::ptr::null_mut::<AnyObject>()];
                assert_eq!(reply, 0);
                assert!(install_on_delegate(ptr).is_err());
            }
        }
    }
}

#[cfg(target_os = "macos")]
pub use macos::install;

#[cfg(test)]
mod tests {
    use super::should_prevent_exit;
    use std::cell::Cell;

    #[test]
    fn quit_with_window_routes_to_close_and_stays_prevented_on_error() {
        let calls = Cell::new(0);
        assert!(should_prevent_exit(true, || {
            calls.set(calls.get() + 1);
            Ok(())
        }));
        assert!(should_prevent_exit(true, || {
            calls.set(calls.get() + 1);
            Err("dispatcher failed".into())
        }));
        assert_eq!(calls.get(), 2);
    }

    #[test]
    fn last_window_already_destroyed_allows_exit_without_routing_again() {
        assert!(!should_prevent_exit(false, || panic!(
            "must not request another close"
        )));
    }
}
